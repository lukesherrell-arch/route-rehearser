// Route Rehearser: build a route, then step along it in Street View.

import * as G from './google.js';
import { buildGeom, project, pointAt } from './geo.js';
import { buildImageList, laneTrack, SETTINGS as IMG } from './imagery.js';
import * as store from './store.js';
import * as CP from './checkpoints.js';
import { ribbon } from './overlay.js';
import * as OSM from './osm.js';
import * as U from './units.js';

const VERSION = 'Round 4 (sat-nav) · 10 Nov 2026';
import { METERS, count, thisMonth, thisSession, onChange } from './usage.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const dist = (m) => U.dist(m);

const state = {
  map: null,
  pano: null,
  route: null, // { id, name, from, to, vias, path, steps, metres, millis, checkpoints }
  geom: null,
  moves: [], // manoeuvres along the route, for the banner
  mini: null,
  miniLine: null,
  editing: null, // checkpoint open in the pin dialog
  line: null,
  markers: [],
  tapMode: null, // 'via' | 'start' | 'end': what the next tap on the map sets
  imagery: null, // { key, images, gaps }
  idx: 0,
  playing: false,
  timer: null,
};

// ---------- messages ----------

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function hint(msg) {
  $('mapHint').textContent = msg || '';
  $('mapHint').hidden = !msg;
}

// ---------- usage meter ----------

function renderUsage() {
  const m = thisMonth();
  const show = store.getSettings().showUsage;
  $('usageStrip').textContent = show
    ? 'This month: ' +
      ['streetview', 'maps', 'routes']
        .map((k) => `${METERS[k].short} ${(m[k] || 0).toLocaleString()}/${METERS[k].free / 1000}k`)
        .join(' · ')
    : '';
  $('usageTable').innerHTML = Object.entries(METERS)
    .map(
      ([k, v]) =>
        `<tr><td>${v.label}</td><td>${(m[k] || 0).toLocaleString()} ${
          v.billed ? `/ ${v.free.toLocaleString()} free` : '(not charged)'
        }</td></tr>`
    )
    .join('');
  const s = thisSession();
  $('sessionUsage').textContent =
    `Street View loads: ${s.streetview} · Steps taken: ${s.steps} · ` +
    `Map loads: ${s.maps} · Routes worked out: ${s.routes} · Image look-ups: ${s.metadata}`;
}

// ---------- route building ----------

async function findRoute(e) {
  e?.preventDefault();
  const from = $('from').value.trim();
  const to = $('to').value.trim();
  if (!from || !to || !state.map) return;
  const keep = state.route && state.route.from === from && state.route.to === to;
  await recompute({
    id: keep ? state.route.id : null,
    name: keep ? state.route.name : '',
    from,
    to,
    vias: keep ? state.route.vias : [],
    fromPoint: keep ? state.route.fromPoint : null,
    toPoint: keep ? state.route.toPoint : null,
  });
}

async function recompute(base) {
  hint('Working out the route…');
  try {
    const r = await G.computeRoute(base);
    setRoute({ ...base, ...r }, true);
    hint('');
  } catch (err) {
    console.error(err);
    hint('');
    toast(
      err.safety
        ? err.message
        : /PERMISSION_DENIED|referer|API key/i.test(err.message)
        ? 'Google blocked the route request. Check the key\'s website restriction and that Routes API is allowed.'
        : base.vias.length
        ? "Couldn't route through that via point. Try putting it right on a road."
        : "Couldn't find that route. Try adding the town, e.g. 'High Street, Newport'.",
      6000
    );
  }
}

// fresh = the line has just been worked out, so re-make the auto checkpoints.
function setRoute(route, fresh = false) {
  state.route = route;
  state.geom = buildGeom(route.path);
  state.moves = CP.manoeuvres(state.geom, route.steps);
  if (fresh || !route.checkpoints) {
    route.checkpoints = CP.mergeCheckpoints(state.geom, route.checkpoints, CP.seedCheckpoints(state.moves));
    if (fresh) persist();
  }
  if (fresh) route.osm = null; // road details belong to the old line
  state.imagery = null;
  drawRoute();
  updateSummary();
  $('routeInfo').hidden = false;
  renderVias();
}

function updateSummary() {
  const r = state.route;
  const mins = Math.round((r.millis || 0) / 60000);
  $('routeSummary').textContent =
    dist(r.metres || state.geom.total) + (mins ? ` · about ${mins} min` : '') + (r.name ? ` · ${r.name}` : '');
}

function drawRoute() {
  const { map, route } = state;
  state.line?.setMap(null);
  state.markers.forEach((m) => m.setMap(null));
  state.line = new G.lib.Polyline({
    map,
    path: route.path,
    strokeColor: '#2a7de1',
    strokeOpacity: 0.9,
    strokeWeight: 6,
    clickable: false,
  });
  state.markers = route.vias.map((v, i) => {
    const m = new G.lib.Marker({ map, position: v, label: String(i + 1), draggable: true });
    m.addListener('dragend', (e) => {
      const vias = [...state.route.vias];
      vias[i] = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      recompute({ ...state.route, vias });
    });
    return m;
  });
  // Start / end spots tapped on the map (drag to adjust).
  for (const [key, label] of [['fromPoint', 'A'], ['toPoint', 'B']]) {
    if (!route[key]) continue;
    const m = new G.lib.Marker({ map, position: route[key], label, draggable: true });
    m.addListener('dragend', (e) => recompute({ ...state.route, [key]: { lat: e.latLng.lat(), lng: e.latLng.lng() } }));
    state.markers.push(m);
  }
  const b = new G.lib.LatLngBounds();
  route.path.forEach((p) => b.extend(p));
  map.fitBounds(b, 40);
}

function renderVias() {
  const vias = state.route?.vias || [];
  $('viaList').innerHTML = vias
    .map((_, i) => `<li>Via ${i + 1} <button type="button" data-i="${i}" aria-label="Remove via ${i + 1}">✕</button></li>`)
    .join('');
}

function addVia(latLng) {
  const p = { lat: latLng.lat(), lng: latLng.lng() };
  // Put the new point in order along the current route.
  const along = (v) => project(state.geom, v)?.d ?? 0;
  const vias = [...state.route.vias, p].sort((a, b) => along(a) - along(b));
  recompute({ ...state.route, vias });
}

const TAP_HINTS = {
  via: 'Tap the road you want the route to use',
  start: 'Tap exactly where you want to start',
  end: 'Tap exactly where you want to finish',
};

function setTapMode(mode) {
  state.tapMode = state.tapMode === mode ? null : mode;
  $('btnAddVia').classList.toggle('on', state.tapMode === 'via');
  $('btnSetStart').classList.toggle('on', state.tapMode === 'start');
  $('btnSetEnd').classList.toggle('on', state.tapMode === 'end');
  hint(TAP_HINTS[state.tapMode] || '');
}

function mapTapped(latLng) {
  const mode = state.tapMode;
  if (!mode || !state.route) return;
  setTapMode(null);
  if (mode === 'via') return addVia(latLng);
  const p = { lat: latLng.lat(), lng: latLng.lng() };
  recompute({ ...state.route, [mode === 'start' ? 'fromPoint' : 'toPoint']: p });
}

// ---------- address suggestions ----------

function wireSuggestions(input) {
  const list = input.parentElement.querySelector('.suggest');
  let timer;
  let latest = 0;
  const close = () => ((list.hidden = true), (list.innerHTML = ''));
  const pick = (li) => {
    input.value = li.textContent;
    close();
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const text = input.value.trim();
    if (text.length < 3 || !state.map) return close();
    // Wait for a pause in typing, so each word isn't a separate request.
    timer = setTimeout(async () => {
      const id = ++latest;
      const c = state.map.getCenter?.();
      const found = await G.suggest(text, c ? { lat: c.lat(), lng: c.lng() } : null);
      if (id !== latest || document.activeElement !== input) return;
      list.innerHTML = found.map((t) => `<li>${esc(t)}</li>`).join('');
      list.hidden = !found.length;
    }, 450);
  });
  input.addEventListener('keydown', (e) => {
    const items = [...list.children];
    if (list.hidden || !items.length) return;
    const at = items.findIndex((li) => li.classList.contains('on'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[at]?.classList.remove('on');
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length + (at < 0 && e.key === 'ArrowUp' ? 1 : 0)) % items.length].classList.add('on');
    } else if (e.key === 'Enter' && at >= 0) {
      e.preventDefault(); // choose the suggestion rather than sending the form
      pick(items[at]);
    } else if (e.key === 'Escape') close();
  });
  // mousedown fires before the box loses focus, so the click isn't lost.
  list.addEventListener('mousedown', (e) => e.target.tagName === 'LI' && (e.preventDefault(), pick(e.target)));
  input.addEventListener('blur', () => setTimeout(close, 150));
}

// ---------- saving ----------

const newRouteId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function serialise(r) {
  const round = (p) => ({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) });
  return {
    id: r.id,
    name: r.name,
    from: r.from,
    to: r.to,
    vias: r.vias.map(round),
    fromPoint: r.fromPoint ? round(r.fromPoint) : null,
    toPoint: r.toPoint ? round(r.toPoint) : null,
    path: r.path.map(round),
    steps: r.steps,
    metres: r.metres,
    millis: r.millis,
    checkpoints: r.checkpoints,
    osm: r.osm || null,
  };
}

function saveCurrent() {
  const r = state.route;
  if (!r) return;
  const name = prompt('Name this route', r.name || `${r.from} → ${r.to}`);
  if (name === null) return;
  r.name = name.trim() || `${r.from} → ${r.to}`;
  r.id ||= newRouteId();
  const ok = store.saveRoute(serialise(r));
  toast(ok ? `Saved "${r.name}"` : "Couldn't save – this browser's storage may be full or blocked.");
  updateSummary();
}

// Quietly keeps an already-saved route up to date (e.g. after editing a pin).
function persist() {
  const r = state.route;
  if (r?.id && store.getRoute(r.id)) store.saveRoute(serialise(r));
}

function renderRouteList() {
  const list = store.listRoutes();
  $('routeList').innerHTML = list.length
    ? list
        .map(
          (r) => `<li><b>${esc(r.name)}</b>
            <span class="small">${esc(r.from)} → ${esc(r.to)} · ${dist(r.metres)} ·
              ${(r.checkpoints || []).filter((c) => !c.hidden).length} checkpoints ·
              ${new Date(r.savedAt).toLocaleDateString('en-GB')}</span>
            <div class="row"><button type="button" class="primary" data-open="${esc(r.id)}">Open</button>
            <button type="button" data-rename="${esc(r.id)}">Rename</button>
            <button type="button" data-copy="${esc(r.id)}">Copy</button>
            <button type="button" data-del="${esc(r.id)}">Delete</button></div></li>`
        )
        .join('')
    : '<li class="small">No saved routes yet. Find a route, then press "Save route".</li>';
}

function libraryAction(e) {
  const { open, rename, copy, del } = e.target.dataset || {};
  if (open) return openSaved(open);
  const id = rename || copy || del;
  const r = id && store.getRoute(id);
  if (!r) return;
  if (rename) {
    const name = prompt('New name', r.name);
    if (!name?.trim()) return;
    store.saveRoute({ ...r, name: name.trim() });
    if (state.route?.id === id) (state.route.name = name.trim()), updateSummary();
  }
  if (copy) store.saveRoute({ ...structuredClone(r), id: newRouteId(), name: `${r.name} (copy)` });
  if (del && confirm(`Delete "${r.name}"?`)) store.deleteRoute(id);
  renderRouteList();
}

function exportRoutes() {
  const data = store.exportAll();
  if (!data.routes.length) return toast('No saved routes to export yet.');
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `route-rehearser-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Exported ${data.routes.length} route${data.routes.length === 1 ? '' : 's'}.`);
}

async function importRoutes(file) {
  try {
    const res = store.importRoutes(JSON.parse(await file.text()));
    if (!res.ok) throw new Error('storage');
    toast(`Imported: ${res.added} new, ${res.updated} updated` + (res.skipped ? `, ${res.skipped} already up to date` : '') + '.', 5000);
  } catch {
    toast("That file couldn't be imported. Pick a Route Rehearser backup (.json).", 5000);
  }
  renderRouteList();
}

function openSaved(id) {
  const r = store.getRoute(id);
  if (!r || !state.map) return;
  $('from').value = r.from;
  $('to').value = r.to;
  showView('plan');
  setRoute(r); // no Google route call: uses the saved line
  $('dlgRoutes').close();
}

// ---------- rehearsing ----------

function showView(name) {
  $('plan').hidden = name !== 'plan';
  $('drive').hidden = name !== 'drive';
  if (name !== 'drive') stop();
}

function routeKey(r) {
  const a = r.path[0];
  const b = r.path[r.path.length - 1];
  return `${r.path.length}:${a.lat},${a.lng}:${b.lat},${b.lng}:${JSON.stringify(r.vias)}`;
}

async function rehearse() {
  if (!state.route) return;
  setTapMode(null);
  showView('drive');
  applyNavLayout();
  try {
    if (!state.pano) {
      state.pano = await G.getPanorama($('pano'));
      // Keep the route line in place as the view is dragged or zoomed.
      for (const ev of ['pov_changed', 'zoom_changed']) state.pano.addListener(ev, drawRibbon);
    }
  } catch (err) {
    toast(err.message, 6000);
    return showView('plan');
  }
  await setUpMiniMap();
  const key = routeKey(state.route);
  if (state.imagery?.key !== key) {
    $('loading').hidden = false;
    $('loadBar').value = 0;
    const res = await buildImageList(state.geom, {
      lookupNear: G.lookupNear,
      lookupById: G.lookupById,
      onProgress: (done, total) => ($('loadBar').value = done / total),
    });
    $('loading').hidden = true;
    state.imagery = { key, ...res, sideAt: laneTrack(res.images) };
    state.idx = 0;
    drawTrack();
    // Carry on from where this saved route was left last time.
    const left = state.route.id ? store.getPos(state.route.id) : null;
    if (left > 30 && left < state.geom.total - 30 && res.images.length) {
      state.idx = nearestIndex(left);
      toast('Carried on from where you stopped. Drag the slider left to start again.', 5000);
    }
  }
  loadRoadData(); // in the background; the banner updates when it arrives
  if (!state.imagery.images.length) {
    toast('No Street View images found along this route.', 6000);
    return;
  }
  const covered = state.geom.total - state.imagery.gaps.reduce((t, g) => t + g.to - g.from, 0);
  if (covered / state.geom.total < 0.9 && state.idx === 0) {
    toast(`Street View covers about ${Math.round((100 * covered) / state.geom.total)}% of this route. Grey = no images.`, 5000);
  }
  show(state.idx);
}

function drawTrack() {
  const total = state.geom.total;
  $('scrub').max = Math.round(total);
  $('track').innerHTML = state.imagery.gaps
    .map((g) => `<i style="left:${(100 * g.from) / total}%;width:${(100 * (g.to - g.from)) / total}%"></i>`)
    .join('');
  drawTicks();
}

function drawTicks() {
  const total = state.geom.total;
  $('ticks').innerHTML = state.route.checkpoints
    .filter((c) => !c.hidden)
    .map((c) => `<b style="left:${(100 * c.d) / total}%"></b>`)
    .join('');
}

async function setUpMiniMap() {
  try {
    state.mini ||= await G.createMiniMap($('miniMap'), window.RR_CONFIG?.mapId);
  } catch {
    $('miniWrap').hidden = true; // daily limit reached: carry on without it
    return;
  }
  if (state.miniLine?.route !== state.route) {
    state.miniLine?.setMap(null);
    state.miniLine = new G.lib.Polyline({
      map: state.mini,
      path: state.route.path,
      strokeColor: '#1a73e8',
      strokeOpacity: 0.9,
      strokeWeight: 9,
      clickable: false,
    });
    state.miniLine.route = state.route;
  }
  state.puck ||= new G.lib.Marker({ map: state.mini, clickable: false, zIndex: 9 });
}

// Heading-up only when the map really is a vector map: a device without 3D
// graphics falls back to a flat north-up map, and then the arrow turns instead.
const headingUp = () => state.mini?.getRenderingType?.() === 'VECTOR';

// A point some metres further on in a given direction.
function ahead(p, heading, metres) {
  const h = (heading * Math.PI) / 180;
  return {
    lat: p.lat + (metres * Math.cos(h)) / 110574,
    lng: p.lng + (metres * Math.sin(h)) / (111320 * Math.cos((p.lat * Math.PI) / 180)),
  };
}

function updateMiniMap(img) {
  if (!state.mini) return;
  const big = isSide() || $('miniWrap').classList.contains('big');
  const up = headingUp();
  // Like a car sat-nav: turned to face the way we're going, tilted, and
  // looking a little ahead so our arrow sits in the lower part of the map.
  state.mini.moveCamera(
    up
      ? { center: ahead(img, img.heading, big ? 45 : 20), heading: img.heading, tilt: big ? 58 : 45, zoom: big ? 18.5 : 18 }
      : { center: { lat: img.lat, lng: img.lng }, heading: 0, zoom: 17 }
  );
  state.puck.setPosition({ lat: img.lat, lng: img.lng });
  state.puck.setIcon({
    path: 'M 0,-12 L 9,9 L 0,4 L -9,9 Z', // navigation arrow
    fillColor: '#1a73e8',
    fillOpacity: 1,
    strokeColor: '#fff',
    strokeWeight: 2.5,
    scale: big ? 1.6 : 1.1,
    rotation: up ? 0 : img.heading,
  });
}

// ---------- sat-nav panel ----------

const wide = window.matchMedia('(min-width: 900px)');
const isSide = () => wide.matches && store.getSettings().navSide;

function applyNavLayout() {
  $('drive').classList.toggle('side', isSide());
  $('miniWrap').classList.remove('big');
  // Let Street View and the map notice their new size.
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    if (state.imagery?.images.length && !$('drive').hidden) updateMiniMap(state.imagery.images[state.idx]);
  });
}

function miniClicked(e) {
  if (e.target.id === 'btnNavSize') return;
  if (wide.matches && !isSide()) {
    store.setSettings({ navSide: true });
    return applyNavLayout();
  }
  if (isSide()) return;
  $('miniWrap').classList.toggle('big');
  if (state.imagery?.images.length) updateMiniMap(state.imagery.images[state.idx]);
}

const ARROWS = {
  left: '↰', slight_left: '↖', sharp_left: '↲', through: '↑', none: '↑',
  right: '↱', slight_right: '↗', sharp_right: '↳', merge_to_left: '↖', merge_to_right: '↗', reverse: '↶',
};

function updateBanner(d) {
  const b = CP.bannerAt(state.moves, d);
  $('banner').hidden = !b;
  if (!b) return;
  const osm = state.route.osm;
  $('bnIcon').textContent = CP.iconFor(b);
  const dist = U.ahead(b.inMetres);
  $('bnDist').textContent = dist === 'Now' ? dist : `In ${dist}`;
  $('bnText').textContent = b.text;

  // Lane arrows from OpenStreetMap, where that road has them.
  const lanes = OSM.lanesAt(osm, d);
  $('laneStrip').hidden = !lanes;
  if (lanes) {
    $('laneStrip').innerHTML = lanes.lanes
      .map((l, i) => `<span class="${lanes.use[i] ? 'use' : ''}">${l.map((t) => ARROWS[t] || '↑').join('')}</span>`)
      .join('');
  }
  // With real lane arrows showing, drop the general "usually left lane" guess.
  const exact = lanes?.use.some(Boolean);
  $('bnLane').textContent = exact ? b.lane.replace(/^Usually (left|right) lane( \(.*?\))? · /, '') : b.lane;

  const spot = OSM.nextSpot(osm, d);
  $('spotChip').hidden = !spot;
  if (spot) {
    const away = U.ahead(Math.max(0, spot.d - d));
    $('spotChip').textContent = `${spot.icon} ${spot.label} ${away === 'Now' ? 'here' : `in ${away}`}`;
  }

  const mph = OSM.limitAt(osm, d);
  $('speedSign').hidden = !mph;
  $('speedSign').textContent = mph || '';
  $('toGo').textContent = `${U.dist(Math.max(0, state.geom.total - d))} to go`;
}

// Fetches lanes, speed limits and signals for the route from OpenStreetMap
// (free, no key). Kept with the route, so it's only fetched once.
const OSM_VERSION = 1;

async function loadRoadData(force = false) {
  const route = state.route;
  if (!force && route.osm?.v === OSM_VERSION) return;
  if (route.osmLoading) return;
  route.osmLoading = true;
  try {
    const elements = await OSM.fetchRoadData(route.path);
    route.osm = { v: OSM_VERSION, at: Date.now(), ...OSM.analyse(buildGeom(route.path), elements, CP.manoeuvres(buildGeom(route.path), route.steps)) };
    if (route === state.route) {
      persist();
      if (state.imagery?.images.length) updateBanner(state.imagery.images[state.idx].d);
    }
  } catch (err) {
    console.warn('Road details not loaded:', err.message);
    route.osmFailed = true;
  } finally {
    route.osmLoading = false;
    if ($('dlgCps').open) renderRoadStatus();
  }
}

function renderRoadStatus() {
  const r = state.route;
  const o = r.osm;
  $('osmStatus').textContent = r.osmLoading
    ? 'Fetching road details from OpenStreetMap…'
    : o
    ? `Found on OpenStreetMap for this route — stretches with lane arrows: ${o.lanes.length} · ` +
      `speed-limit stretches: ${o.limits.length} · lights, crossings and signs: ${o.spots.length}.`
    : r.osmFailed
    ? "Couldn't reach OpenStreetMap just now. Lane arrows and speed limits are off; everything else works."
    : 'Not fetched yet.';
}

function updateCheckpointCard(d) {
  const c = CP.checkpointNear(state.route.checkpoints, d);
  $('cpCard').hidden = !c;
  if (!c) return;
  if ($('cpCard').dataset.id !== c.id) $('cpCard').classList.remove('open'); // new one starts small
  $('cpCard').dataset.id = c.id;
  $('cpIcon').textContent = CP.PIN_TYPES[c.type]?.icon || '•';
  $('cpTitle').textContent = c.title;
  $('cpDist').textContent = c.d - d < 10 ? 'here' : `in ${U.ahead(c.d - d)}`;
  $('cpNote').textContent = c.note;
}

function monthName(ym) {
  const [y, m] = (ym || '').split('-').map(Number);
  if (!y || !m) return '';
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function show(i) {
  const imgs = state.imagery.images;
  i = Math.max(0, Math.min(imgs.length - 1, i));
  const prev = imgs[state.idx];
  const img = imgs[i];
  state.idx = i;
  state.pano.setPano(img.pano);
  facePath();
  count('steps');
  const date = monthName(img.date);
  const years = img.date ? (Date.now() - new Date(`${img.date}-01`).getTime()) / 3.156e10 : 0;
  $('imgDate').textContent = date ? `Image: ${date}` + (years >= 4 ? ' – old picture, the road may have changed' : '') : '';
  $('imgDate').classList.toggle('old', years >= 4);
  if (state.route.id) store.setPos(state.route.id, img.d);
  $('posText').textContent = `${dist(img.d)} of ${dist(state.geom.total)}`;
  // Hide the line for a moment while the new picture arrives, then fade it in.
  $('ribbon').classList.add('fade');
  requestAnimationFrame(() => requestAnimationFrame(() => $('ribbon').classList.remove('fade')));
  drawRibbon();
  updateBanner(img.d);
  updateCheckpointCard(img.d);
  updateMiniMap(img);
  $('scrub').value = Math.round(img.d);
  $('btnBack').disabled = i === 0;
  $('btnFwd').disabled = i === imgs.length - 1;
  $('btnPrevCp').disabled = jumpTarget(-1) == null;
  $('btnNextCp').disabled = jumpTarget(1) == null;
  if (prev && img.d - prev.d > IMG.gapMin) {
    toast(`No Street View for ${Math.round(img.d - prev.d)} m here – skipped ahead`);
  }
}

// Face down the road: route direction, eyes slightly down.
function facePath() {
  const img = state.imagery.images[state.idx];
  state.pano.setPov({ heading: img.heading, pitch: -8 });
}

function recentre() {
  facePath();
  state.pano.setZoom(1);
}

function step(n) {
  show(state.idx + n);
}

// ---------- route line over the picture ----------

function drawRibbon() {
  const cv = $('ribbon');
  const ctx = cv.getContext('2d');
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  const scale = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * scale) || cv.height !== Math.round(h * scale)) {
    cv.width = Math.round(w * scale);
    cv.height = Math.round(h * scale);
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const img = state.imagery?.images[state.idx];
  if (!img || !state.pano || !store.getSettings().showLine) return;
  const slices = ribbon(state.geom, img, img.d, state.pano.getPov(), state.pano.getZoom() ?? 1, w, h, state.imagery.sideAt);
  for (let i = 0; i < slices.length - 1; i++) {
    const a = slices[i];
    const b = slices[i + 1];
    // Don't draw wild shapes from points that are far off-screen.
    if ([a.L, a.R, b.L, b.R].some((p) => Math.abs(p.x) > 6 * w || Math.abs(p.y) > 6 * h)) continue;
    const fade = Math.max(0, 1 - a.ahead / 150);
    ctx.fillStyle = `rgba(42, 125, 225, ${0.15 + 0.4 * fade})`;
    ctx.beginPath();
    ctx.moveTo(a.L.x, a.L.y);
    ctx.lineTo(b.L.x, b.L.y);
    ctx.lineTo(b.R.x, b.R.y);
    ctx.lineTo(a.R.x, a.R.y);
    ctx.fill();
  }
}

function toggleLine() {
  store.setSettings({ showLine: !store.getSettings().showLine });
  $('btnLine').setAttribute('aria-pressed', store.getSettings().showLine);
  drawRibbon();
}

// ---------- jumping between checkpoints ----------

const LEAD_IN = 40; // stop this far before a checkpoint, to see it coming

// Index of the picture to jump to for the next (dir 1) or previous (dir -1)
// checkpoint, or null if there isn't one.
function jumpTarget(dir) {
  const imgs = state.imagery?.images;
  if (!imgs?.length) return null;
  const here = imgs[state.idx].d;
  const stops = state.route.checkpoints.filter((c) => !c.hidden).map((c) => Math.max(0, c.d - LEAD_IN));
  const want = dir > 0 ? stops.find((d) => d > here + 15) : stops.reverse().find((d) => d < here - 15);
  if (want == null) return null;
  const i = nearestIndex(want);
  return (dir > 0 ? i > state.idx : i < state.idx) ? i : null;
}

function jumpCheckpoint(dir) {
  stop();
  const i = jumpTarget(dir);
  if (i == null) return;
  state.idx = i; // so the jump doesn't announce a gap
  show(i);
}

function nearestIndex(d) {
  const imgs = state.imagery.images;
  let best = 0;
  imgs.forEach((img, i) => {
    if (Math.abs(img.d - d) < Math.abs(imgs[best].d - d)) best = i;
  });
  return best;
}

// ---------- playing ----------

// 1x shows every picture. Faster speeds take bigger jumps instead of shorter
// looks, so each picture still has time to sharpen; near a checkpoint play
// drops back to every picture so nothing important is skipped.
const PLAY = { metresPerSec: 6, look1x: 1600, lookFast: 1300, slowBefore: 60, slowAfter: 15 };

function nextPlayIndex(speed) {
  const imgs = state.imagery.images;
  const here = imgs[state.idx].d;
  const nearCheckpoint = state.route.checkpoints.some(
    (c) => !c.hidden && c.d - here < PLAY.slowBefore && here - c.d < PLAY.slowAfter
  );
  let i = state.idx + 1;
  if (speed > 1 && !nearCheckpoint) {
    const reach = here + (PLAY.metresPerSec * speed * PLAY.lookFast) / 1000;
    // Never jump over a checkpoint's lead-in or across a gap in one go.
    while (
      i + 1 < imgs.length &&
      imgs[i + 1].d <= reach &&
      imgs[i + 1].d - imgs[i].d < IMG.gapMin &&
      !state.route.checkpoints.some((c) => !c.hidden && c.d - PLAY.slowBefore > here && c.d - PLAY.slowBefore <= imgs[i + 1].d)
    ) i++;
  }
  return i;
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on) wakeLock ||= await navigator.wakeLock?.request('screen');
    else (await wakeLock?.release(), (wakeLock = null));
  } catch {
    wakeLock = null; // not supported or not allowed: carry on without it
  }
}

function play() {
  if (state.playing) return stop();
  const imgs = state.imagery?.images;
  if (!imgs?.length) return;
  if (state.idx >= imgs.length - 1) show(0);
  state.playing = true;
  $('btnPlay').textContent = '⏸';
  $('btnPlay').setAttribute('aria-label', 'Pause');
  keepAwake(true); // stop the phone screen dimming while it plays
  const tick = () => {
    if (state.idx >= imgs.length - 1) return stop();
    const speed = +$('speed').value;
    show(nextPlayIndex(speed));
    state.timer = setTimeout(tick, speed > 1 ? PLAY.lookFast : PLAY.look1x);
  };
  state.timer = setTimeout(tick, 300);
}

function stop() {
  if (state.playing) keepAwake(false);
  state.playing = false;
  clearTimeout(state.timer);
  $('btnPlay').textContent = '▶';
  $('btnPlay').setAttribute('aria-label', 'Play');
}

function scrubTo(d) {
  stop();
  const imgs = state.imagery?.images;
  if (!imgs?.length) return;
  const best = nearestIndex(d);
  state.idx = best; // so jumping along the slider doesn't announce a gap
  show(best);
}

// ---------- checkpoints and pins ----------

function renderCheckpointList() {
  const list = [...state.route.checkpoints].sort((a, b) => a.d - b.d);
  $('cpList').innerHTML = list.length
    ? list
        .map(
          (c) => `<li class="${c.hidden ? 'dim' : ''}"><b>${CP.PIN_TYPES[c.type]?.icon || '•'} ${esc(c.title)}</b>
            <span class="tag">at ${dist(c.d)}${c.auto ? ' · auto' : ''}${c.hidden ? ' · hidden' : ''}</span>
            <div class="row"><button type="button" class="primary" data-go="${esc(c.id)}">Go</button>
            <button type="button" data-edit="${esc(c.id)}">Edit</button></div></li>`
        )
        .join('')
    : '<li class="small">No checkpoints yet. Use "📍 Pin here" to add one.</li>';
}

function openPin(cp) {
  stop();
  state.editing = cp;
  $('pinHeading').textContent = cp ? 'Edit checkpoint' : 'Pin here';
  $('pinType').innerHTML = Object.entries(CP.PIN_TYPES)
    .filter(([k]) => CP.OWN_TYPES.includes(k) || k === cp?.type)
    .map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`)
    .join('');
  $('pinType').value = cp?.type || 'tricky';
  $('pinTitle').value = cp?.title || '';
  $('pinNote').value = cp?.note || '';
  $('pinHidden').checked = !!cp?.hidden;
  $('pinDelete').hidden = !cp;
  $('dlgPin').returnValue = '';
  $('dlgPin').showModal();
}

function closePin() {
  const action = $('dlgPin').returnValue;
  const r = state.route;
  const cp = state.editing;
  state.editing = null;
  if (action === 'delete' && cp) {
    if (!confirm('Delete this checkpoint?')) return;
    r.checkpoints = r.checkpoints.filter((c) => c !== cp);
  } else if (action === 'save') {
    const type = $('pinType').value;
    const fields = {
      type,
      title: $('pinTitle').value.trim() || CP.PIN_TYPES[type].label,
      note: $('pinNote').value.trim(),
      hidden: $('pinHidden').checked,
    };
    if (cp) Object.assign(cp, fields);
    else {
      const d = state.imagery.images[state.idx].d;
      const at = pointAt(state.geom, d);
      if (!fields.note) fields.note = CP.tipFor(type);
      r.checkpoints.push({ id: CP.newId(), d, lat: at.lat, lng: at.lng, auto: false, ...fields });
      r.checkpoints.sort((a, b) => a.d - b.d);
      if (!store.getRoute(r.id || '')) toast('Pin added. Press Save to keep this route and its pins.');
    }
  } else return;
  persist();
  if (state.imagery) {
    drawTicks();
    updateCheckpointCard(state.imagery.images[state.idx].d);
    $('btnPrevCp').disabled = jumpTarget(-1) == null;
    $('btnNextCp').disabled = jumpTarget(1) == null;
  }
  if ($('dlgCps').open) renderCheckpointList();
}

// Re-makes the automatic checkpoints with the app's newest advice and
// fetches the road details again. Own pins are kept.
function refreshTips() {
  const r = state.route;
  if (!confirm('Refresh the automatic tips and road details? Your own pins are kept; edits to "auto" checkpoints are reset.')) return;
  r.checkpoints = CP.mergeCheckpoints(state.geom, r.checkpoints, CP.seedCheckpoints(state.moves));
  persist();
  renderCheckpointList();
  if (state.imagery) {
    drawTicks();
    show(state.idx);
  }
  loadRoadData(true);
  renderRoadStatus();
}

function checkpointAction(e) {
  const { go, edit } = e.target.dataset || {};
  const cp = state.route.checkpoints.find((c) => c.id === (go || edit));
  if (!cp) return;
  if (edit) return openPin(cp);
  $('dlgCps').close();
  scrubTo(Math.max(0, cp.d - LEAD_IN));
}

// ---------- start-up ----------

function wire() {
  $('routeForm').addEventListener('submit', findRoute);
  $('btnAddVia').onclick = () => setTapMode('via');
  $('btnSetStart').onclick = () => setTapMode('start');
  $('btnSetEnd').onclick = () => setTapMode('end');
  $('viaList').onclick = (e) => {
    const i = e.target.dataset?.i;
    if (i === undefined) return;
    recompute({ ...state.route, vias: state.route.vias.filter((_, k) => k !== +i) });
  };
  $('btnSave').onclick = saveCurrent;
  $('btnRehearse').onclick = rehearse;
  $('btnExit').onclick = () => showView('plan');
  $('btnSave2').onclick = () => (stop(), saveCurrent());
  $('btnBack').onclick = () => (stop(), step(-1));
  $('btnFwd').onclick = () => (stop(), step(1));
  $('btnPlay').onclick = play;
  $('btnPrevCp').onclick = () => jumpCheckpoint(-1);
  $('btnNextCp').onclick = () => jumpCheckpoint(1);
  $('btnLine').onclick = toggleLine;
  $('btnLine').setAttribute('aria-pressed', store.getSettings().showLine);
  $('version').textContent = `Version: ${VERSION}`;
  window.addEventListener('resize', drawRibbon);
  $('btnRecentre').onclick = recentre;
  $('scrub').oninput = (e) => scrubTo(+e.target.value);

  $('btnRoutes').onclick = () => (renderRouteList(), $('dlgRoutes').showModal());
  $('routeList').onclick = libraryAction;
  $('btnExport').onclick = exportRoutes;
  $('btnImport').onclick = () => $('importFile').click();
  $('importFile').onchange = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) importRoutes(f);
  };
  $('btnPin').onclick = () => state.imagery?.images.length && openPin(null);
  $('btnCps').onclick = () => (stop(), renderCheckpointList(), renderRoadStatus(), $('dlgCps').showModal());
  $('cpList').onclick = checkpointAction;
  $('cpCard').onclick = (e) => e.target.id !== 'cpEdit' && $('cpCard').classList.toggle('open');
  $('cpEdit').onclick = () => openPin(state.route.checkpoints.find((c) => c.id === $('cpCard').dataset.id));
  $('dlgPin').addEventListener('close', closePin);
  $('miniWrap').onclick = miniClicked;
  $('btnNavSize').onclick = () => (store.setSettings({ navSide: false }), applyNavLayout());
  wide.addEventListener('change', applyNavLayout);
  $('btnRefresh').onclick = refreshTips;
  $('useImperial').checked = store.getSettings().imperial;
  $('useImperial').onchange = (e) => {
    store.setSettings({ imperial: e.target.checked });
    U.setImperial(e.target.checked);
    if (state.route) updateSummary();
    if (state.imagery?.images.length && !$('drive').hidden) show(state.idx);
  };
  wireSuggestions($('from'));
  wireSuggestions($('to'));
  $('btnUsage').onclick = () => (renderUsage(), $('dlgUsage').showModal());
  $('showUsage').checked = store.getSettings().showUsage;
  $('showUsage').onchange = (e) => (store.setSettings({ showUsage: e.target.checked }), renderUsage());
  $('btnHelp').onclick = () => $('dlgHelp').showModal();
  $('apiKey').value = store.getSettings().apiKey;
  $('dlgHelp').addEventListener('close', () => {
    if ($('dlgHelp').returnValue !== 'save') return;
    store.setSettings({ apiKey: $('apiKey').value.trim() });
    location.reload();
  });

  document.addEventListener('keydown', (e) => {
    // Leave keys alone while typing or while a box (e.g. Pin here) is open.
    if ($('drive').hidden || !state.imagery || e.target.matches('input, select, textarea')) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'ArrowRight') (stop(), step(1));
    else if (e.key === 'ArrowLeft') (stop(), step(-1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), jumpCheckpoint(1));
    else if (e.key === 'ArrowDown') (e.preventDefault(), jumpCheckpoint(-1));
    else if (e.key === ' ') (e.preventDefault(), play());
  });

  onChange(renderUsage);
  renderUsage();
}

async function start() {
  U.setImperial(store.getSettings().imperial);
  wire();
  const key = store.getSettings().apiKey || window.RR_CONFIG?.apiKey;
  if (!key) {
    hint('No Google key yet. Open Help to add one.');
    $('dlgHelp').showModal();
    return;
  }
  G.onAuthFailure(() =>
    hint("Google didn't accept the key. Check its website restriction includes this address.")
  );
  try {
    await G.loadGoogle(key);
    state.map = await G.createMap($('map'));
    state.map.addListener('click', (e) => {
      mapTapped(e.latLng);
    });
  } catch (err) {
    console.error(err);
    hint(err.message);
  }
}

start();
