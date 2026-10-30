import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeom } from '../js/geo.js';
import * as CP from '../js/checkpoints.js';

const O = { lat: 51.58, lng: -3.0 };
const mPerLng = 111320 * Math.cos((O.lat * Math.PI) / 180);
const at = (east, north) => ({ lat: O.lat + north / 110574, lng: O.lng + east / mPerLng });

test('turn types and lane hints', () => {
  // East 600 m, then north 300 m: a LEFT turn at 600 m.
  const g = buildGeom([at(0, 0), at(600, 0), at(600, 300)]);
  const steps = [
    { text: 'Head east', maneuver: 'DEPART', at: at(0, 0) },
    { text: 'Turn <b>left</b> onto High St', maneuver: 'TURN_LEFT', at: at(600, 0) },
  ];
  const moves = CP.manoeuvres(g, steps);
  assert.equal(moves.length, 2);
  assert.equal(moves[0].type, 'left');
  assert.equal(moves[0].text, 'Turn left onto High St');
  assert.ok(Math.abs(moves[0].d - 600) < 2);
  assert.equal(moves[1].type, 'arrive');

  const b = CP.bannerAt(moves, 480);
  assert.equal(b.type, 'left');
  assert.ok(Math.abs(b.inMetres - 120) < 2);
  assert.equal(CP.bannerAt(moves, 650).type, 'arrive');
});

test('roundabout lane depends on which way the exit goes', () => {
  // Heading east, roundabout at 300 m, then exit going south (= turning right).
  const g = buildGeom([at(0, 0), at(300, 0), at(310, -10), at(310, -300)]);
  const steps = [
    { text: 'Head east', maneuver: 'DEPART', at: at(0, 0) },
    { text: 'At the roundabout, take the 3rd exit', maneuver: 'ROUNDABOUT_LEFT', at: at(300, 0) },
    { text: 'Continue', maneuver: 'STRAIGHT', at: at(310, -40) },
  ];
  const [r] = CP.manoeuvres(g, steps);
  assert.equal(r.type, 'roundabout');
  assert.match(r.lane, /Right lane/);
});

test('checkpoints: seeded, own pins kept after re-route, near lookup', () => {
  const g = buildGeom([at(0, 0), at(600, 0), at(600, 300)]);
  const moves = CP.manoeuvres(g, [
    { text: 'Head east', maneuver: 'DEPART', at: at(0, 0) },
    { text: 'Turn left', maneuver: 'TURN_LEFT', at: at(600, 0) },
  ]);
  const seeded = CP.seedCheckpoints(moves);
  assert.equal(seeded.length, 2); // the turn + destination
  assert.ok(seeded[0].note.includes('Mirror'));
  const mine = { id: 'x', d: 200, ...at(200, 0), type: 'box', title: 'Box', note: '', auto: false };
  const far = { id: 'y', d: 0, ...at(200, 500), type: 'hazard', title: 'Gone', note: '', auto: false };
  const merged = CP.mergeCheckpoints(g, [...seeded, mine, far], CP.seedCheckpoints(moves));
  assert.deepEqual(merged.map((c) => c.title), ['Box', 'Turn left', 'Arrive at your destination']);
  assert.equal(CP.checkpointNear(merged, 150)?.title, 'Box');
  assert.equal(CP.checkpointNear(merged, 300), null);
});

test("only Google's first line decides the type", () => {
  const g = buildGeom([at(0, 0), at(600, 0), at(650, 300)]);
  const [m] = CP.manoeuvres(g, [
    { text: 'Head east', maneuver: 'DEPART', at: at(0, 0) },
    { text: 'Slight left onto Central Ave\nGo round 1 roundabout', maneuver: 'TURN_SLIGHT_LEFT', at: at(600, 0) },
  ]);
  assert.equal(m.type, 'keep');
  assert.equal(m.text, 'Slight left onto Central Ave');
  assert.equal(m.more, 'Go round 1 roundabout');
});
