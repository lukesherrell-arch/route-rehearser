import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeom } from '../js/geo.js';
import { focal, projectGround, ribbon } from '../js/overlay.js';

const O = { lat: 51.58, lng: -3.0 };
const mPerLng = 111320 * Math.cos((O.lat * Math.PI) / 180);
const at = (east, north) => ({ lat: O.lat + north / 110574, lng: O.lng + east / mPerLng });

test('focal length matches what was measured on Google', () => {
  assert.ok(Math.abs(focal(1366, 478, 1) - 683) < 2); // wide screen: 90° across
  assert.ok(Math.abs(focal(390, 592, 1) - 296) < 2); // tall phone: 90° up-and-down
  assert.ok(Math.abs(focal(390, 592, 2) - 390) < 2);
});

test('a point straight ahead on the road sits centre, below the horizon', () => {
  const p = projectGround(0, 20, { heading: 0, pitch: 0 }, 300, 400, 600);
  assert.equal(Math.round(p.x), 200);
  assert.ok(p.y > 300 && p.y < 350);
  assert.equal(projectGround(0, -20, { heading: 0, pitch: 0 }, 300, 400, 600), null); // behind
  // Looking east, a point to the north is on the left.
  assert.ok(projectGround(20, 5, { heading: 90, pitch: 0 }, 300, 400, 600).x < 200);
});

test('ribbon narrows with distance and bends with the road', () => {
  const g = buildGeom([at(0, 0), at(0, 60), at(60, 60)]); // north, then turn right
  const r = ribbon(g, at(0, 0), 0, { heading: 0, pitch: -8 }, 1, 400, 600);
  assert.ok(r.length > 10);
  const width = (s) => s.R.x - s.L.x;
  assert.ok(width(r[0]) > 3 * width(r.find((s) => s.ahead >= 40)));
  assert.ok(r[0].L.y > r[5].L.y, 'further points are higher on screen');
  const far = r[r.length - 1];
  assert.ok((far.L.x + far.R.x) / 2 > 260, 'after the right turn the line heads right');
});

test('ribbon is drawn in the lane, not on the centre line', () => {
  const g = buildGeom([at(0, 0), at(0, 200)]); // heading north
  const pov = { heading: 0, pitch: -8 };
  // Camera car is 2 m left of the route line; so is the lane ahead.
  const cam = at(-2, 0);
  const onLine = ribbon(g, cam, 0, pov, 1, 400, 600);
  const inLane = ribbon(g, cam, 0, pov, 1, 400, 600, () => -2);
  const mid = (s) => (s.L.x + s.R.x) / 2;
  assert.ok(mid(onLine[0]) > 250, 'without the lane track it sits off to the right');
  assert.ok(Math.abs(mid(inLane[0]) - 200) < 2, 'with it, it starts under the camera');
});
