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

// Backup file with every saved route, for moving between phone and PC.
export function exportAll() {
  return { app: 'route-rehearser', version: 1, exported: new Date().toISOString(), routes: read(ROUTES, []) };
}

// Adds routes from a backup file. A route that's already here is replaced
// only if the file's copy is newer. Returns how many were added or updated.
export function importRoutes(data) {
  const incoming = Array.isArray(data?.routes) ? data.routes : [];
  const valid = incoming.filter((r) => r && r.id && Array.isArray(r.path) && r.path.length > 1);
  const all = read(ROUTES, []);
  let added = 0;
  let updated = 0;
  for (const r of valid) {
    const i = all.findIndex((x) => x.id === r.id);
    if (i < 0) {
      all.push(r);
      added++;
    } else if ((r.savedAt || 0) > (all[i].savedAt || 0)) {
      all[i] = r;
      updated++;
    }
  }
  const ok = write(ROUTES, all);
  return { ok, added, updated, skipped: incoming.length - added - updated };
}
