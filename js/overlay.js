// The route line drawn over the Street View picture: a ribbon on the road
// ahead that narrows and fades with distance. Pure maths here; app.js does
// the drawing. It assumes flat ground, so it drifts a little on hills.

import { pointAt } from './geo.js';

const rad = (d) => (d * Math.PI) / 180;

export const RIBBON = {
  camHeight: 2.5, // Google's camera is about this far above the road (metres)
  halfWidth: 0.9, // half the ribbon's width on the road (metres)
  from: 5, // nearest point drawn, metres ahead
  to: 150, // furthest point drawn
};

// Focal length in pixels for a Street View of this size and zoom. Measured
// against Google's viewer: the zoom sets the angle across the width
// (90° at zoom 1), but the angle up-and-down never goes above 90°, which
// is what applies on a tall phone screen.
export function focal(w, h, zoom = 1) {
  const fov = 2 * Math.atan(2 ** (1 - zoom));
  return Math.max(w / 2 / Math.tan(fov / 2), h / 2);
}

// Where a point on the ground (east/north metres from the camera) lands on
// screen, or null if it's behind the camera.
export function projectGround(east, north, pov, f, w, h, camHeight = RIBBON.camHeight) {
  const H = rad(pov.heading);
  const P = rad(pov.pitch);
  const right = east * Math.cos(H) - north * Math.sin(H);
  const fwd = east * Math.sin(H) + north * Math.cos(H);
  const up = -camHeight;
  const depth = fwd * Math.cos(P) + up * Math.sin(P);
  if (depth < 0.5) return null;
  const rise = -fwd * Math.sin(P) + up * Math.cos(P);
  return { x: w / 2 + (right / depth) * f, y: h / 2 - (rise / depth) * f };
}

// The ribbon as a list of slices, nearest first. Each slice has the screen
// positions of its left and right edge and how far ahead it is.
//   g: route geometry, cam: { lat, lng } of the photo, d: distance along route
//   sideAt(d): how far right (+) or left (-) of Google's route line to draw,
//   in metres. Google's line runs down the middle of a two-way road, so
//   without this the ribbon would sit on the centre line, not in our lane.
export function ribbon(g, cam, d, pov, zoom, w, h, sideAt = () => 0, opt = RIBBON) {
  const f = focal(w, h, zoom);
  const out = [];
  let ahead = opt.from;
  while (ahead <= opt.to && d + ahead <= g.total) {
    const a = pointAt(g, d + ahead - 1);
    const b = pointAt(g, Math.min(g.total, d + ahead + 1));
    const p = pointAt(g, d + ahead);
    // Metres east/north of the camera.
    let e = (p.lng - cam.lng) * g.kx;
    let n = (p.lat - cam.lat) * g.ky;
    // Sideways direction (to the right of travel), for the ribbon's width.
    let dx = (b.lng - a.lng) * g.kx;
    let dy = (b.lat - a.lat) * g.ky;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const side = sideAt(d + ahead);
    e += dy * side;
    n -= dx * side;
    const L = projectGround(e - dy * opt.halfWidth, n + dx * opt.halfWidth, pov, f, w, h, opt.camHeight);
    const R = projectGround(e + dy * opt.halfWidth, n - dx * opt.halfWidth, pov, f, w, h, opt.camHeight);
    if (L && R) out.push({ L, R, ahead });
    else if (out.length) break; // route has gone behind us: stop rather than draw a jump
    ahead += ahead < 30 ? 2 : ahead < 80 ? 4 : 8; // finer close up, where it matters
  }
  return out;
}
