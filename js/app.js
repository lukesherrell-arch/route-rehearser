// Route Rehearser, round 1: build a route, then step along it in Street View.

import * as G from './google.js';
import { buildGeom, project } from './geo.js';
import { buildImageList, SETTINGS as IMG } from './imagery.js';
import * as store from './store.js';
import { METERS, count, thisMonth, thisSession, onChange } from './usage.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const km = (m) => (m / 1000).toFixed(m < 10000 ? 1 : 0);
const dist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${km(m)} km`);

const state = {
  map: null,
  pano: null,
  route: null, // { id, name, from, to, vias, path, steps, metres, millis }
  geom: null,
  line: null,
  markers: [],
  addingVia: false,
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
        .map((k) => `${METERS[k].short} ${(m[k] || 0).toLocaleString()}/${METERS[k].free.toLocaleString()}`)
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
  });
}

async function recompute(base) {
  hint('Working out the route…');
  try {
    const r = await G.computeRoute(base);
    setRoute({ ...base, ...r });
    hint('');
  } catch (err) {
    console.error(err);
    hint('');
    toast(
      base.vias.length
        ? "Couldn't route through that via point. Try putting it right on a road."
        : "Couldn't find that route. Try adding the town, e.g. 'High Street, Newport'.",
      6000
    );
  }
}

function setRoute(route) {
  state.route = route;
  state.geom = buildGeom(route.path);
  state.imagery = null;
  drawRoute();
  const mins = Math.round((route.millis || 0) / 60000);
  $('routeSummary').textContent =
    `${km(route.metres || state.geom.total)} km` + (mins ? ` · about ${mins} min` : '') +
    (route.name ? ` · ${route.name}` : '');
  $('routeInfo').hidden = false;
  renderVias();
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

function toggleAddVia(on = !state.addingVia) {
  state.addingVia = on;
  $('btnAddVia').classList.toggle('on', on);
  hint(on ? 'Tap the road you want the route to use' : '');
}

// ---------- saving ----------

function saveCurrent() {
  const r = state.route;
  if (!r) return;
  const name = prompt('Name this route', r.name || `${r.from} → ${r.to}`);
  if (name === null) return;
  r.name = name.trim() || `${r.from} → ${r.to}`;
  r.id ||= Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const round = (p) => ({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) });
  const ok = store.saveRoute({
    id: r.id,
    name: r.name,
    from: r.from,
    to: r.to,
    vias: r.vias.map(round),
    path: r.path.map(round),
    steps: r.steps,
    metres: r.metres,
    millis: r.millis,
  });
  toast(ok ? `Saved "${r.name}"` : "Couldn't save – this browser's storage may be full or blocked.");
  setRoute(r);
}

function renderRouteList() {
  const list = store.listRoutes();
  $('routeList').innerHTML = list.length
    ? list
        .map(
          (r) => `<li><b>${esc(r.name)}</b>
            <span class="small">${esc(r.from)} → ${esc(r.to)} · ${km(r.metres)} km · ${new Date(r.savedAt).toLocaleDateString('en-GB')}</span>
            <div class="row"><button type="button" class="primary" data-open="${esc(r.id)}">Open</button>
            <button type="button" data-del="${esc(r.id)}">Delete</button></div></li>`
        )
        .join('')
    : '<li class="small">No saved routes yet. Find a route, then press "Save route".</li>';
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
  toggleAddVia(false);
  showView('drive');
  state.pano ||= await G.getPanorama($('pano'));
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
    state.imagery = { key, ...res };
    state.idx = 0;
    drawTrack();
  }
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
  $('imgDate').textContent = date ? `Image: ${date}` : '';
  $('posText').textContent = `${dist(img.d)} of ${dist(state.geom.total)}`;
  $('scrub').value = Math.round(img.d);
  $('btnBack').disabled = i === 0;
  $('btnFwd').disabled = i === imgs.length - 1;
  if (prev && img.d - prev.d > IMG.gapMin) {
    toast(`No Street View for ${Math.round(img.d - prev.d)} m here – skipped ahead`);
  }
}

// Face down the road: route direction, eyes slightly down.
function facePath() {
  const img = state.imagery.images[state.idx];
  state.pano.setPov({ heading: img.heading, pitch: -8 });
  state.pano.setZoom(1);
}

function step(n) {
  show(state.idx + n);
}

function play() {
  if (state.playing) return stop();
  const imgs = state.imagery?.images;
  if (!imgs?.length) return;
  if (state.idx >= imgs.length - 1) show(0);
  state.playing = true;
  $('btnPlay').textContent = '⏸';
  $('btnPlay').setAttribute('aria-label', 'Pause');
  const tick = () => {
    const speed = +$('speed').value;
    const stride = speed >= 8 ? 2 : 1;
    if (state.idx >= imgs.length - 1) return stop();
    show(state.idx + stride);
    state.timer = setTimeout(tick, Math.max(350, 1600 / speed));
  };
  state.timer = setTimeout(tick, 300);
}

function stop() {
  state.playing = false;
  clearTimeout(state.timer);
  $('btnPlay').textContent = '▶';
  $('btnPlay').setAttribute('aria-label', 'Play');
}

function scrubTo(d) {
  stop();
  const imgs = state.imagery?.images;
  if (!imgs?.length) return;
  let best = 0;
  imgs.forEach((img, i) => {
    if (Math.abs(img.d - d) < Math.abs(imgs[best].d - d)) best = i;
  });
  state.idx = best; // so jumping along the slider doesn't announce a gap
  show(best);
}

// ---------- start-up ----------

function wire() {
  $('routeForm').addEventListener('submit', findRoute);
  $('btnAddVia').onclick = () => toggleAddVia();
  $('viaList').onclick = (e) => {
    const i = e.target.dataset?.i;
    if (i === undefined) return;
    recompute({ ...state.route, vias: state.route.vias.filter((_, k) => k !== +i) });
  };
  $('btnSave').onclick = saveCurrent;
  $('btnRehearse').onclick = rehearse;
  $('btnExit').onclick = () => showView('plan');
  $('btnBack').onclick = () => (stop(), step(-1));
  $('btnFwd').onclick = () => (stop(), step(1));
  $('btnPlay').onclick = play;
  $('btnRecentre').onclick = facePath;
  $('scrub').oninput = (e) => scrubTo(+e.target.value);

  $('btnRoutes').onclick = () => (renderRouteList(), $('dlgRoutes').showModal());
  $('routeList').onclick = (e) => {
    const { open, del } = e.target.dataset || {};
    if (open) openSaved(open);
    if (del && confirm('Delete this saved route?')) {
      store.deleteRoute(del);
      renderRouteList();
    }
  };
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
    if ($('drive').hidden || !state.imagery || e.target.matches('input, select')) return;
    if (e.key === 'ArrowRight') (stop(), step(1));
    else if (e.key === 'ArrowLeft') (stop(), step(-1));
    else if (e.key === ' ') (e.preventDefault(), play());
  });

  onChange(renderUsage);
  renderUsage();
}

async function start() {
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
      if (!state.addingVia || !state.route) return;
      toggleAddVia(false);
      addVia(e.latLng);
    });
  } catch (err) {
    console.error(err);
    hint(err.message);
  }
}

start();
