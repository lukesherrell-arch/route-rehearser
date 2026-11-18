// Random practice routes: a loop (or a one-way trip) through a few random
// spots around a starting point. The maths lives here so it can be tested;
// app.js does the Google calls.

const MILE = 1609.344;
export const milesToM = (mi) => mi * MILE;

// A point some metres away from p in a compass direction (degrees).
export function offset(p, bearing, metres) {
  const h = (bearing * Math.PI) / 180;
  return {
    lat: p.lat + (metres * Math.cos(h)) / 110574,
    lng: p.lng + (metres * Math.sin(h)) / (111320 * Math.cos((p.lat * Math.PI) / 180)),
  };
}

// Straight-line distance in metres (good enough over a few miles).
export function metresBetween(a, b) {
  const y = (b.lat - a.lat) * 110574;
  const x = (b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(x, y);
}

// Bigger areas get an extra spot, so the loop isn't just a long out-and-back.
export const spotCount = (radiusM) => (radiusM > 4000 ? 4 : 3);

// Random spots spread round the start, going one way round (clockwise or
// anticlockwise), so the loop doesn't cross itself much.
// Each spot is { bearing, metres }, between half and all of the radius out.
export function pickSpots(radiusM, rand = Math.random, n = spotCount(radiusM)) {
  const turn = rand() < 0.5 ? 1 : -1;
  const first = rand() * 360;
  const step = 270 / Math.max(1, n - 1); // spread over three-quarters of a circle
  const spots = [];
  for (let i = 0; i < n; i++) {
    const jitter = (rand() - 0.5) * step * 0.4;
    spots.push({
      bearing: (((first + turn * (i * step + jitter)) % 360) + 360) % 360,
      metres: radiusM * (0.5 + 0.5 * rand()),
    });
  }
  return spots;
}

// Average town driving is roughly 20 mph, and a loop out to the spots and
// back is about 6 times the radius by road (measured round Newport). So a first guess at the radius
// for a wanted number of minutes:
const TOWN_MPS = 8.9;
export const radiusForMinutes = (mins) => (mins * 60 * TOWN_MPS) / 6;

// After a try comes back too long or short, scale the radius to suit.
// Never more than doubles or halves at once, and never past maxM.
export function adjustRadius(radiusM, gotMins, wantMins, maxM = Infinity) {
  if (!gotMins || !wantMins) return radiusM;
  const k = Math.min(2, Math.max(0.5, wantMins / gotMins));
  return Math.min(maxM, Math.max(300, radiusM * k));
}

// Is a try close enough to the wanted time? (within 20%, or 3 minutes)
export const closeEnough = (gotMins, wantMins) =>
  !wantMins || Math.abs(gotMins - wantMins) <= Math.max(3, wantMins * 0.2);

// Works out the settings to start from.
// miles and mins may each be empty; at least one is needed.
export function plan({ miles, mins }) {
  const maxM = miles > 0 ? milesToM(miles) : Infinity;
  const want = mins > 0 ? mins : null;
  const radius = want ? Math.min(maxM, radiusForMinutes(want)) : maxM;
  return { radius, maxM, want };
}
