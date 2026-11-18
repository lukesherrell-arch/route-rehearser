import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../js/random.js';

function seeded(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

test('spots stay inside the radius and go one way round', () => {
  for (let s = 1; s < 30; s++) {
    const spots = R.pickSpots(3000, seeded(s));
    assert.equal(spots.length, 3);
    for (const sp of spots) assert.ok(sp.metres >= 1500 && sp.metres <= 3000);
    // consecutive bearings differ by roughly 135° (270 / 2), allowing jitter
    for (let i = 1; i < spots.length; i++) {
      const diff = Math.abs(((spots[i].bearing - spots[i - 1].bearing + 540) % 360) - 180);
      assert.ok(diff > 80 && diff < 180, `diff ${diff}`);
    }
  }
  assert.equal(R.pickSpots(6000, seeded(3)).length, 4);
});

test('offset and distance agree', () => {
  const p = { lat: 51.58, lng: -3.0 };
  for (const b of [0, 45, 90, 200, 300]) {
    const q = R.offset(p, b, 2000);
    assert.ok(Math.abs(R.metresBetween(p, q) - 2000) < 5);
  }
});

test('planning from miles and / or minutes', () => {
  assert.equal(Math.round(R.plan({ miles: 2 }).radius), 3219);
  const t = R.plan({ mins: 20 });
  assert.ok(t.radius > 1500 && t.radius < 2000, String(t.radius)); // about 1.1 miles
  assert.equal(t.want, 20);
  // a small radius caps a long time
  assert.equal(Math.round(R.plan({ miles: 1, mins: 60 }).radius), 1609);
});

test('radius adjusts towards the wanted time', () => {
  assert.equal(R.adjustRadius(2000, 10, 20), 4000);
  assert.equal(R.adjustRadius(2000, 10, 60), 4000); // at most doubles
  assert.equal(R.adjustRadius(2000, 40, 20), 1000);
  assert.equal(R.adjustRadius(2000, 10, 20, 3000), 3000); // never past the limit
  assert.ok(R.closeEnough(22, 20));
  assert.ok(!R.closeEnough(30, 20));
  assert.ok(R.closeEnough(14, null));
});
