// Road details Google doesn't give to websites: lane arrows, speed limits,
// traffic lights, crossings and so on. They come from OpenStreetMap, a free
// map made by volunteers, so coverage varies from road to road.
// Data © OpenStreetMap contributors (openstreetmap.org/copyright).

import { project, headingAt, bearing, haversine, angleDiff } from './geo.js';
import { roundaboutTurn } from './checkpoints.js';

const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const ROADS =
  'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|' +
  'motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const SPOTS = 'traffic_signals|crossing|give_way|stop|mini_roundabout|speed_camera';

// Fewer points, so the question sent to OpenStreetMap stays short.
export function thin(path, gap = 25) {
  const out = [path[0]];
  for (const p of path) if (haversine(out[out.length - 1], p) >= gap) out.push(p);
  const last = path[path.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export function buildQuery(path) {
  const line = thin(path)
    .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join(',');
  return (
    `[out:json][timeout:25];` +
    `way(around:14,${line})[highway~"^(${ROADS})$"]->.w;` +
    `node(w.w)[highway~"^(${SPOTS})$"]->.n;` +
    `node(around:25,${line})[highway=speed_camera]->.c;` +
    `(.w;.n;.c;);out body geom;`
  );
}

export async function fetchRoadData(path) {
  const body = 'data=' + encodeURIComponent(buildQuery(path));
  let lastErr;
  for (const url of SERVERS) {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 30000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: stop.signal,
      });
      if (!res.ok) throw new Error(`OpenStreetMap server said ${res.status}`);
      return (await res.json()).elements || [];
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// "30 mph" -> 30. Plain numbers are km/h.
export function parseMph(v) {
  if (!v) return null;
  const mph = /^(\d+)\s*mph$/i.exec(v.trim());
  if (mph) return +mph[1];
  const kmh = /^(\d+)$/.exec(v.trim());
  return kmh ? Math.round((+kmh[1] * 0.621371) / 5) * 5 : null;
}

// "left|through|through;right" -> [['left'], ['through'], ['through','right']]
// Lanes are listed left to right, as the driver sees them.
export function parseLanes(v) {
  if (!v) return null;
  const lanes = v.split('|').map((l) =>
    l
      .split(';')
      .map((t) => t.trim() || 'none')
      .filter((t, i, a) => a.indexOf(t) === i)
  );
  if (lanes.length < 2 || lanes.every((l) => l.every((t) => t === 'none'))) return null;
  return lanes;
}

// Which arrows suit a turn of this many degrees (- left, + right), best first.
function wanted(turn) {
  if (turn <= -35) return ['left', 'sharp_left', 'slight_left'];
  if (turn <= -12) return ['slight_left', 'left', 'through', 'none'];
  if (turn < 12) return ['through', 'none', 'slight_left', 'slight_right'];
  if (turn < 35) return ['slight_right', 'right', 'through', 'none'];
  return ['right', 'sharp_right', 'slight_right'];
}

// Marks the lanes to use: true for each lane whose arrow matches the turn.
export function lanesToUse(lanes, turn) {
  for (const want of wanted(turn)) {
    const use = lanes.map((l) => l.includes(want));
    if (use.some(Boolean)) return use;
  }
  return lanes.map(() => false);
}

const signedTurn = (a, b) => ((b - a + 540) % 360) - 180;

function spotLabel(tags) {
  switch (tags.highway) {
    case 'traffic_signals':
      return { type: 'lights', icon: '🚦', label: 'Traffic lights' };
    case 'crossing':
      if (tags.crossing === 'traffic_signals' || tags['crossing:signals'] === 'yes')
        return { type: 'crossing', icon: '🚶', label: 'Signal crossing' };
      if (tags.crossing === 'zebra' || tags.crossing_ref === 'zebra' || tags['crossing:markings'] === 'zebra')
        return { type: 'crossing', icon: '🚶', label: 'Zebra crossing' };
      return { type: 'crossing', icon: '🚶', label: 'Crossing' };
    case 'give_way':
      return { type: 'giveway', icon: '▽', label: 'Give way' };
    case 'stop':
      return { type: 'stop', icon: '🛑', label: 'Stop sign' };
    case 'mini_roundabout':
      return { type: 'mini', icon: '⟳', label: 'Mini-roundabout' };
    case 'speed_camera':
      return { type: 'camera', icon: '📷', label: 'Speed camera' };
  }
  return null;
}

// Joins neighbouring stretches that say the same thing.
function join(list, same, gap = 30) {
  list.sort((a, b) => a.from - b.from);
  const out = [];
  for (const s of list) {
    const last = out[out.length - 1];
    if (last && same(last, s) && s.from - last.to < gap) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

// Fits OpenStreetMap's roads onto our route.
//   g: route geometry, elements: OpenStreetMap's answer, moves: manoeuvres
// Returns { limits: [{from,to,mph}], lanes: [{from,to,lanes,use}], spots: [{d,type,icon,label}] }
export function analyse(g, elements, moves = []) {
  const ll = (p) => ({ lat: p.lat, lng: p.lon });
  const limits = [];
  const laneBits = [];
  const onRoute = new Map(); // node id -> [{ dir, way }] for nodes on roads we drive along

  for (const w of elements) {
    if (w.type !== 'way' || !w.geometry || !w.tags) continue;
    const t = w.tags;
    const oneway = t.oneway === 'yes' || t.oneway === '-1' || t.junction === 'roundabout' || t.highway === 'motorway';
    const pts = w.geometry.map(ll);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (haversine(a, b) < 0.5) continue;
      const mid = project(g, { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
      if (!mid || mid.dist > 7) continue;
      const diff = angleDiff(bearing(a, b), headingAt(g, mid.d, 8));
      let dir = diff < 25 ? 'forward' : diff > 155 ? 'backward' : null;
      if (!dir) continue; // a road crossing ours, not one we drive along
      // One-way roads can only be driven their own way; the other way means
      // this is the opposite carriageway.
      if (oneway && dir !== (t.oneway === '-1' ? 'backward' : 'forward')) continue;
      // Look for each end near the middle, so a route that passes the same
      // spot twice can't mix up the two passes.
      const reach = haversine(a, b) / 2 + 30;
      const pa = project(g, a, mid.d - reach, mid.d + reach);
      const pb = project(g, b, mid.d - reach, mid.d + reach);
      if (!pa || !pb) continue;
      const from = Math.min(pa.d, pb.d);
      const to = Math.max(pa.d, pb.d);
      if (to - from < 0.5) continue;
      for (const id of [w.nodes?.[i], w.nodes?.[i + 1]]) {
        if (id == null) continue;
        const seen = onRoute.get(id) || [];
        if (!seen.some((x) => x.way === w)) onRoute.set(id, [...seen, { dir, way: w }]);
      }

      const mph = parseMph(t[`maxspeed:${dir}`] || t.maxspeed);
      if (mph) limits.push({ from, to, mph });
      const lanes = parseLanes(t[`turn:lanes:${dir}`] || (oneway ? t['turn:lanes'] : null));
      if (lanes) laneBits.push({ from, to, lanes, key: lanes.map((l) => l.join(';')).join('|') });
    }
  }

  const lanes = join(laneBits, (a, b) => a.key === b.key).map(({ from, to, lanes }) => {
    // What does the route do where these lanes end? At a roundabout, use the
    // overall direction of the exit; otherwise the turn right there.
    const rb = moves.find((m) => m.type === 'roundabout' && m.d > to - 30 && m.d < to + 80);
    const turn = rb
      ? roundaboutTurn(g, rb.d)
      : signedTurn(headingAt(g, Math.max(0, to - 20), 12), headingAt(g, Math.min(g.total, to + 30), 12));
    return { from, to, lanes, use: lanesToUse(lanes, turn) };
  });

  const spots = [];
  for (const n of elements) {
    if (n.type !== 'node' || !n.tags) continue;
    const info = spotLabel(n.tags);
    if (!info) continue;
    const pr = project(g, ll(n));
    if (!pr) continue;
    if (info.type === 'camera') {
      if (pr.dist > 25) continue;
    } else {
      const on = onRoute.get(n.id);
      if (!on || pr.dist > 8) continue;
      if (info.type === 'giveway' || info.type === 'stop') {
        // These only apply to traffic reaching the end of a road. Count it if
        // it's marked for our direction, or sits near the end we're heading to.
        const marked = n.tags.direction;
        const applies = on.some(({ dir, way }) => {
          if (marked) return marked === dir;
          const geo = way.geometry.map(ll);
          return haversine(ll(n), dir === 'forward' ? geo[geo.length - 1] : geo[0]) <= 30;
        });
        if (!applies) continue;
      }
    }
    if (spots.some((s) => s.type === info.type && Math.abs(s.d - pr.d) < 15)) continue;
    spots.push({ d: pr.d, ...info });
  }
  spots.sort((a, b) => a.d - b.d);

  return { limits: join(limits, (a, b) => a.mph === b.mph), lanes, spots };
}

export const limitAt = (osm, d) => osm?.limits.find((s) => d >= s.from - 2 && d <= s.to + 2)?.mph ?? null;

// Lane arrows to show: the stretch we're in, or one starting within 120 m.
export const lanesAt = (osm, d) => osm?.lanes.find((s) => d >= s.from - 120 && d <= s.to) ?? null;

export const nextSpot = (osm, d, within = 150) => osm?.spots.find((s) => s.d > d - 5 && s.d - d <= within) ?? null;
