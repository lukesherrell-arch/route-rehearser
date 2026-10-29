// Pure geometry helpers. No Google code here, so it can be tested on its own.
// Distances are in metres. Bearings are degrees clockwise from north.

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Smallest difference between two bearings, 0..180.
export function angleDiff(a, b) {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

// Builds a route object from [{lat, lng}, ...]. Uses a flat local grid
// (x east, y north) centred on the first point, which is accurate enough
// for routes of a few tens of km.
export function buildGeom(path) {
  const clean = [];
  for (const p of path) {
    const last = clean[clean.length - 1];
    if (!last || haversine(last, p) > 0.3) clean.push({ lat: p.lat, lng: p.lng });
  }
  const o = clean[0];
  const kx = R * Math.cos(rad(o.lat)) * (Math.PI / 180);
  const ky = R * (Math.PI / 180);
  let d = 0;
  const pts = clean.map((p, i) => {
    if (i > 0) d += haversine(clean[i - 1], p);
    return { lat: p.lat, lng: p.lng, x: (p.lng - o.lng) * kx, y: (p.lat - o.lat) * ky, d };
  });
  return { pts, total: d, kx, ky, o };
}

function toXY(g, p) {
  return { x: (p.lng - g.o.lng) * g.kx, y: (p.lat - g.o.lat) * g.ky };
}

// Index of the segment containing distance d.
function segIndex(g, d) {
  const pts = g.pts;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].d <= d) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function pointAt(g, d) {
  const pts = g.pts;
  if (pts.length === 1) return { lat: pts[0].lat, lng: pts[0].lng };
  d = Math.max(0, Math.min(g.total, d));
  const i = Math.min(segIndex(g, d), pts.length - 2);
  const a = pts[i];
  const b = pts[i + 1];
  const t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

// Direction of travel at distance d, looking a little ahead so the camera
// starts turning just before a bend, as a driver's eyes would.
export function headingAt(g, d, ahead = 12) {
  const from = Math.min(d, g.total - 1);
  const to = Math.min(g.total, from + ahead);
  if (to - from < 0.5) return bearing(pointAt(g, Math.max(0, g.total - ahead)), pointAt(g, g.total));
  return bearing(pointAt(g, from), pointAt(g, to));
}

export function sampleDistances(g, step) {
  const out = [];
  for (let d = 0; d < g.total; d += step) out.push(d);
  out.push(g.total);
  return out;
}

// Finds the closest point on the route to p, only looking between dMin and
// dMax along the route (so a route that loops back near itself can't confuse it).
// Returns { d, dist, side } where side > 0 means p is to the RIGHT of the
// direction of travel, side < 0 to the LEFT.
export function project(g, p, dMin = 0, dMax = Infinity) {
  const q = toXY(g, p);
  const pts = g.pts;
  let best = null;
  const start = segIndex(g, Math.max(0, dMin));
  for (let i = start; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.d > dMax) break;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;
    const dist = Math.hypot(q.x - cx, q.y - cy);
    const along = a.d + (b.d - a.d) * t;
    if (along < dMin - 0.01 || along > dMax + 0.01) continue;
    if (!best || dist < best.dist) {
      const len = Math.sqrt(len2) || 1;
      const cross = (dx * (q.y - a.y) - dy * (q.x - a.x)) / len; // + = left
      best = { d: along, dist, side: -cross };
    }
  }
  return best;
}
