// Distances as text. UK road signs and sat-navs use yards and miles, so
// that's the default; metres and km are there as a setting.

const YARD = 0.9144;
const MILE = 1609.344;

let imperial = true;
export const setImperial = (on) => (imperial = !!on);

const trim = (n) => String(+n.toFixed(1)); // 2.0 -> "2"

// A length, e.g. the route is "3.4 mi" long, or "250 yd of 3.4 mi".
export function dist(m) {
  if (!imperial) return m < 1000 ? `${Math.round(m)} m` : `${trim(m / 1000)} km`;
  if (m < 0.2 * MILE) return `${Math.round(m / YARD / 10) * 10} yd`;
  return `${trim(m / MILE)} mi`;
}

// Countdown to the next manoeuvre, rounded the way a sat-nav speaks.
export function ahead(m) {
  if (m < 15) return 'Now';
  if (!imperial) {
    if (m >= 1000) return `${trim(m / 1000)} km`;
    return `${m < 200 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50} m`;
  }
  const yd = m / YARD;
  if (yd < 200) return `${Math.max(10, Math.round(yd / 10) * 10)} yd`;
  if (m < 0.3 * MILE) return `${Math.round(yd / 50) * 50} yd`;
  return `${trim(m / MILE)} mi`;
}
