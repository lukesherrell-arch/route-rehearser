// Saved routes and settings, kept in this browser on this device.

const ROUTES = 'rr.routes';
const SETTINGS = 'rr.settings';

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function listRoutes() {
  return read(ROUTES, []).sort((a, b) => b.savedAt - a.savedAt);
}

export function getRoute(id) {
  return read(ROUTES, []).find((r) => r.id === id);
}

export function saveRoute(route) {
  const all = read(ROUTES, []).filter((r) => r.id !== route.id);
  all.push({ ...route, savedAt: Date.now() });
  return write(ROUTES, all);
}

export function deleteRoute(id) {
  write(ROUTES, read(ROUTES, []).filter((r) => r.id !== id));
}

export function getSettings() {
  return { apiKey: '', showUsage: true, ...read(SETTINGS, {}) };
}

export function setSettings(patch) {
  write(SETTINGS, { ...getSettings(), ...patch });
}
