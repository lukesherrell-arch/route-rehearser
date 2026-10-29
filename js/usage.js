// Counts this device's Google usage per calendar month, so there are no
// billing surprises. Google's Cloud console is the true figure.

const KEY = 'rr.usage';

export const METERS = {
  streetview: { label: 'Street View loads', short: 'Street View', free: 5000, billed: true },
  maps: { label: 'Map loads', short: 'Maps', free: 10000, billed: true },
  routes: { label: 'Routes worked out', short: 'Routes', free: 10000, billed: true },
  metadata: { label: 'Image look-ups', free: null, billed: false },
};

const session = { streetview: 0, maps: 0, routes: 0, metadata: 0, steps: 0 };
const listeners = new Set();

function month() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function count(kind, n = 1) {
  session[kind] = (session[kind] || 0) + n;
  if (kind !== 'steps') {
    const all = load();
    const m = (all[month()] ||= {});
    m[kind] = (m[kind] || 0) + n;
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {}
  }
  listeners.forEach((fn) => fn());
}

export function thisMonth() {
  return load()[month()] || {};
}

export function thisSession() {
  return { ...session };
}

export function onChange(fn) {
  listeners.add(fn);
}
