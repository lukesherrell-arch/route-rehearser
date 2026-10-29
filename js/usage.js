// Counts this device's Google usage per calendar month, so there are no
// billing surprises. Google's Cloud console is the true figure.

const KEY = 'rr.usage';

export const METERS = {
  streetview: { label: 'Street View loads', short: 'Street View', free: 5000, billed: true },
  maps: { label: 'Map loads', short: 'Maps', free: 10000, billed: true },
  routes: { label: 'Routes worked out', short: 'Routes', free: 10000, billed: true },
  metadata: { label: 'Image look-ups', free: null, billed: false },
};

// Google won't let us set daily caps on this account, so the app sets its own,
// per device. Normal use is a handful a day; these only stop runaway use.
export const DAILY_LIMIT = { streetview: 40, maps: 40, routes: 60 };

const session = { streetview: 0, maps: 0, routes: 0, metadata: 0, steps: 0 };
const listeners = new Set();

function month() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function today() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
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
    if (all.day?.date !== today()) all.day = { date: today() };
    all.day[kind] = (all.day[kind] || 0) + n;
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {}
  }
  listeners.forEach((fn) => fn());
}

export function thisMonth() {
  return load()[month()] || {};
}

// Throws (instead of calling Google) once today's safety limit is reached.
export function guard(kind) {
  const day = load().day;
  const used = day?.date === today() ? day[kind] || 0 : 0;
  if (used >= DAILY_LIMIT[kind]) {
    const err = new Error(
      `Daily safety limit reached (${DAILY_LIMIT[kind]} ${METERS[kind].label.toLowerCase()} today). It resets at midnight.`
    );
    err.safety = true;
    throw err;
  }
}

export function thisSession() {
  return { ...session };
}

export function onChange(fn) {
  listeners.add(fn);
}
