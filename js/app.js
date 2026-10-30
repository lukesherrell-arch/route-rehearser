// Route Rehearser: build a route, then step along it in Street View.

import * as G from './google.js';
import { buildGeom, project, pointAt } from './geo.js';
import { buildImageList, SETTINGS as IMG } from './imagery.js';
import * as store from './store.js';
import * as CP from './checkpoints.js';
import { METERS, count, thisMonth, thisSession, onChange } from './usage.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const km = (m) => (m / 1000).toFixed(m < 10000 ? 1 : 0);
const dist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${km(m)} km`);

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
    `${km(r.metres || state.geom.total)} km` + (mins ? ` · about ${mins} min` : '') + (r.name ? ` · ${r.name}` : '');
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

const newRouteId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function serialise(r) {
  const round = (p) => ({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) });
  return {
    id: r.id,
    name: r.name,
    from: r.from,
    to: r.to,
    vias: r.vias.map(round),
    path: r.path.map(round),
    steps: r.steps,
    metres: r.metres,
    millis: r.millis,
    checkpoints: r.checkpoints,
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
            <span class="small">${esc(r.from)} → ${esc(r.to)} · ${km(r.metres)} km ·
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
  toggleAddVia(false);
  showView('drive');
  try {
    state.pano ||= await G.getPanorama($('pano'));
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
      strokeColor: '#2a7de1',
      strokeOpacity: 0.85,
      strokeWeight: 7,
      clickable: false,
    });
    state.miniLine.route = state.route;
  }
}

const headingUp = () => !!window.RR_CONFIG?.mapId;

function updateMiniMap(img) {
  if (!state.mini) return;
  state.mini.moveCamera({ center: { lat: img.lat, lng: img.lng }, heading: headingUp() ? img.heading : 0 });
  $('miniCar').style.setProperty('--car', `${headingUp() ? 0 : img.heading}deg`);
}

function fmtAhead(m) {
  if (m < 15) return 'Now';
  if (m >= 1000) return `In ${(m / 1000).toFixed(1)} km`;
  return `In ${m < 200 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50} m`;
}

function updateBanner(d) {
  const b = CP.bannerAt(state.moves, d);
  $('banner').hidden = !b;
  if (!b) return;
  $('bnIcon').textContent = CP.iconFor(b);
  $('bnDist').textContent = fmtAhead(b.inMetres);
  $('bnText').textContent = b.text;
  $('bnLane').textContent = b.lane;
}

function updateCheckpointCard(d) {
  const c = CP.checkpointNear(state.route.checkpoints, d);
  $('cpCard').hidden = !c;
  if (!c) return;
  $('cpCard').dataset.id = c.id;
  $('cpIcon').textContent = CP.PIN_TYPES[c.type]?.icon || '•';
  $('cpTitle').textContent = c.title;
  $('cpDist').textContent = c.d - d < 10 ? 'here' : `in ${Math.round((c.d - d) / 10) * 10} m`;
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
  $('imgDate').textContent = date ? `Image: ${date}` : '';
  $('posText').textContent = `${dist(img.d)} of ${dist(state.geom.total)}`;
  updateBanner(img.d);
  updateCheckpointCard(img.d);
  updateMiniMap(img);
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
}

function recentre() {
  facePath();
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
    if (state.idx >= imgs.length - 1) return stop();
    show(state.idx + 1);
    state.timer = setTimeout(tick, 1600 / +$('speed').value);
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

// ---------- checkpoints and pins ----------

function renderCheckpointList() {
  const list = [...state.route.checkpoints].sort((a, b) => a.d - b.d);
  $('cpList').innerHTML = list.length
    ? list
        .map(
          (c) => `<li class="${c.hidden ? 'dim' : ''}"><b>${CP.PIN_TYPES[c.type]?.icon || '•'} ${esc(c.title)}</b>
            <span class="tag">at ${dist(c.d)}${c.auto ? ' · auto' : ''}${c.hidden ? ' · hidden' : ''}</span>
            <div class="row"><button type="button" class="primary" data-go="${c.id}">Go</button>
            <button type="button" data-edit="${c.id}">Edit</button></div></li>`
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
  }
  if ($('dlgCps').open) renderCheckpointList();
}

function checkpointAction(e) {
  const { go, edit } = e.target.dataset || {};
  const cp = state.route.checkpoints.find((c) => c.id === (go || edit));
  if (!cp) return;
  if (edit) return openPin(cp);
  $('dlgCps').close();
  scrubTo(Math.max(0, cp.d - 40)); // stop just before it, to see it coming
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
  $('btnSave2').onclick = () => (stop(), saveCurrent());
  $('btnBack').onclick = () => (stop(), step(-1));
  $('btnFwd').onclick = () => (stop(), step(1));
  $('btnPlay').onclick = play;
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
  $('btnCps').onclick = () => (stop(), renderCheckpointList(), $('dlgCps').showModal());
  $('cpList').onclick = checkpointAction;
  $('cpEdit').onclick = () => openPin(state.route.checkpoints.find((c) => c.id === $('cpCard').dataset.id));
  $('dlgPin').addEventListener('close', closePin);
  $('miniWrap').onclick = () => $('miniWrap').classList.toggle('big');
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
