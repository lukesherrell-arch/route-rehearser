// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeom, project, headingAt, haversine } from '../js/geo.js';
import { buildImageList } from '../js/imagery.js';

// A 600 m road heading east, then 300 m heading north, near Newport.
const O = { lat: 51.58, lng: -3.0 };
const mPerLng = 111320 * Math.cos((O.lat * Math.PI) / 180);
const at = (east, north) => ({ lat: O.lat + north / 110574, lng: O.lng + east / mPerLng });
const path = [at(0, 0), at(600, 0), at(600, 300)];
const g = buildGeom(path);

test('geometry: length, heading and side', () => {
  assert.ok(Math.abs(g.total - 900) < 3, `total ${g.total}`);
  assert.ok(Math.abs(headingAt(g, 100) - 90) < 1);
  assert.ok(Math.abs(headingAt(g, 700) - 0) < 1);
  // Heading east, a point 5 m north is on the LEFT (negative side).
  const left = project(g, at(100, 5));
  assert.ok(Math.abs(left.d - 100) < 1 && left.side < -4.5);
  const right = project(g, at(100, -5));
  assert.ok(right.side > 4.5);
});

test('imagery: keeps our carriageway, skips the other one, marks gaps, follows links', async () => {
  const panos = new Map();
  const add = (id, p, links = []) => panos.set(id, { pano: id, ...p, date: '2023-06', links });
  // Our side: 2 m left of the line, every 10 m along the east leg...
  for (let e = 0; e <= 600; e += 10) add(`E${e}`, at(e, 2));
  // ...the other carriageway 12 m to the right (should never be used)...
  for (let e = 0; e <= 600; e += 10) add(`X${e}`, at(e, -12));
  // ...north leg has images 0-100 m and 220-300 m, nothing between (a real gap).
  for (let n = 10; n <= 100; n += 10) add(`N${n}`, at(598, n));
  for (let n = 220; n <= 300; n += 10) add(`N${n}`, at(598, n));
  // Hidden images on the east leg that nearest-search misses but links reach.
  panos.delete('E300'); panos.delete('E310'); panos.delete('E320'); panos.delete('E330');
  add('L1', at(305, 2), [{ pano: 'L2', heading: 90 }]);
  add('L2', at(318, 2), [{ pano: 'X330', heading: 270 }]);
  panos.get('E290').links = [{ pano: 'L1', heading: 91 }, { pano: 'X290', heading: 180 }];

  const hidden = new Set(['L1', 'L2']);
  const lookupNear = async (p, radius) => {
    let best = null;
    for (const v of panos.values()) {
      if (hidden.has(v.pano)) continue;
      const dist = haversine(p, v);
      if (dist <= radius && (!best || dist < best.dist)) best = { dist, v };
    }
    return best ? { ...best.v } : null;
  };
  const lookupById = async (id) => (panos.has(id) ? { ...panos.get(id) } : null);

  const { images, gaps } = await buildImageList(g, { lookupNear, lookupById });
  const ids = images.map((i) => i.pano);
  assert.ok(!ids.some((id) => id.startsWith('X')), 'never uses the other carriageway');
  assert.ok(ids.includes('L1') && ids.includes('L2'), 'filled the hole by following links');
  for (let i = 1; i < images.length; i++) assert.ok(images[i].d > images[i - 1].d, 'in route order');
  assert.equal(gaps.length, 1, JSON.stringify(gaps));
  assert.ok(Math.abs(gaps[0].from - 700) < 3 && Math.abs(gaps[0].to - 820) < 3);
  const north = images.find((i) => i.pano === 'N50');
  assert.ok(Math.abs(north.heading) < 1 || Math.abs(north.heading - 360) < 1);
});
