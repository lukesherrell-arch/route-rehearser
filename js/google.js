// Everything that talks to Google lives here, and every billable call is
// counted. Design rule: ONE Street View panorama per page visit, moved with
// setPano(), so stepping shouldn't add charges.

import { count, guard } from './usage.js';

let loading = null;
let authFailed = () => {};

export function onAuthFailure(fn) {
  authFailed = fn;
}

export function loadGoogle(apiKey) {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    window.gm_authFailure = () => authFailed();
    window.__rrGoogleReady = () => resolve(window.google.maps);
    const params = new URLSearchParams({
      key: apiKey,
      v: 'weekly',
      loading: 'async',
      callback: '__rrGoogleReady',
      region: 'GB',
      language: 'en-GB',
    });
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn't reach Google. Check your internet connection."));
    };
    document.head.append(s);
  });
  return loading;
}

const NEWPORT = { lat: 51.5842, lng: -2.9977 };
let map = null;

// Drawing classes for the map, filled in once Google has loaded.
export const lib = {};

export async function createMap(el) {
  if (map) return map;
  guard('maps');
  const { Map, Polyline } = await google.maps.importLibrary('maps');
  const { Marker } = await google.maps.importLibrary('marker');
  const { LatLngBounds } = await google.maps.importLibrary('core');
  Object.assign(lib, { Polyline, Marker, LatLngBounds });
  map = new Map(el, {
    center: NEWPORT,
    zoom: 13,
    mapTypeControl: false,
    streetViewControl: false, // stops the map making its own Street View
    fullscreenControl: false,
    clickableIcons: false,
    gestureHandling: 'greedy',
  });
  count('maps');
  return map;
}

// Small sat-nav style map shown while rehearsing (one extra map load per visit).
// With a vector Map ID it can turn heading-up; without one it stays north-up.
let mini = null;

export async function createMiniMap(el, mapId) {
  if (mini) return mini;
  guard('maps');
  const { Map } = await google.maps.importLibrary('maps');
  const opts = {
    center: NEWPORT,
    zoom: 17,
    disableDefaultUI: true,
    gestureHandling: 'none',
    keyboardShortcuts: false,
    clickableIcons: false,
  };
  if (mapId) Object.assign(opts, { mapId, renderingType: 'VECTOR', headingInteractionEnabled: false });
  mini = new Map(el, opts);
  count('maps');
  return mini;
}

let pano = null;

export async function getPanorama(el) {
  if (pano) return pano;
  guard('streetview');
  const { StreetViewPanorama } = await google.maps.importLibrary('streetView');
  pano = new StreetViewPanorama(el, {
    disableDefaultUI: true,
    linksControl: false, // no arrows, so it can't wander off the route
    clickToGo: false,
    addressControl: false,
    showRoadLabels: false,
    motionTracking: false,
    motionTrackingControl: false,
    enableCloseButton: false,
    zoomControl: false,
    panControl: false,
    fullscreenControl: false,
  });
  count('streetview');
  return pano;
}

let svc = null;
let sv = null;

async function service() {
  if (!svc) {
    sv = await google.maps.importLibrary('streetView');
    svc = new sv.StreetViewService();
  }
  return svc;
}

function tidyPano(data) {
  const loc = data?.location;
  if (!loc?.pano || !loc.latLng) return null;
  // Skip photos uploaded by the public; we only want Google's own car imagery.
  if (data.copyright && !/google/i.test(data.copyright)) return null;
  return {
    pano: loc.pano,
    lat: loc.latLng.lat(),
    lng: loc.latLng.lng(),
    date: data.imageDate || '',
    links: (data.links || []).map((l) => ({ pano: l.pano, heading: l.heading })),
  };
}

// Street View metadata look-ups. Google doesn't charge for these.
export async function lookupNear(latLng, radius) {
  const s = await service();
  const req = { location: latLng, radius, preference: sv.StreetViewPreference.NEAREST };
  if (sv.StreetViewSource.GOOGLE) req.sources = [sv.StreetViewSource.GOOGLE];
  else req.source = sv.StreetViewSource.OUTDOOR;
  count('metadata');
  try {
    const { data } = await s.getPanorama(req);
    return tidyPano(data);
  } catch {
    return null; // no image near here
  }
}

export async function lookupById(id) {
  const s = await service();
  count('metadata');
  try {
    const { data } = await s.getPanorama({ pano: id });
    return tidyPano(data);
  } catch {
    return null;
  }
}

const ll = (p) => ({
  lat: typeof p.lat === 'function' ? p.lat() : p.lat,
  lng: typeof p.lng === 'function' ? p.lng() : p.lng,
});

// Works out a driving route (one billable call). Via points make the route
// pass through a spot without stopping there.
export async function computeRoute({ from, to, vias }) {
  guard('routes');
  const { Route } = await google.maps.importLibrary('routes');
  count('routes');
  const req = {
    origin: from,
    destination: to,
    travelMode: 'DRIVING',
    region: 'uk',
    language: 'en-GB',
    polylineQuality: 'HIGH_QUALITY',
    fields: ['path', 'legs', 'distanceMeters', 'durationMillis'],
  };
  if (vias.length) {
    req.intermediates = vias.map((v) => ({ location: { lat: v.lat, lng: v.lng }, via: true }));
  }
  const { routes } = await Route.computeRoutes(req);
  const r = routes?.[0];
  if (!r) throw new Error('No route found.');
  const steps = (r.legs || []).flatMap((leg) =>
    (leg.steps || []).map((s) => ({
      text: s.instructions || '',
      maneuver: s.maneuver || '',
      metres: s.distanceMeters || 0,
      at: s.path?.length ? ll(s.path[0]) : null,
    }))
  );
  return {
    path: r.path.map(ll),
    steps,
    metres: r.distanceMeters || 0,
    millis: r.durationMillis || 0,
  };
}
