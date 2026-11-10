import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeom } from '../js/geo.js';
import * as OSM from '../js/osm.js';
import * as U from '../js/units.js';

const O = { lat: 51.58, lng: -3.0 };
const mPerLng = 111320 * Math.cos((O.lat * Math.PI) / 180);
const at = (east, north) => ({ lat: O.lat + north / 110574, lng: O.lng + east / mPerLng });
const geo = (...pts) => pts.map(([e, n]) => ({ lat: at(e, n).lat, lon: at(e, n).lng }));
const node = (id, e, n, tags) => ({ type: 'node', id, lat: at(e, n).lat, lon: at(e, n).lng, tags });

test('parsing speed limits and lanes', () => {
  assert.equal(OSM.parseMph('30 mph'), 30);
  assert.equal(OSM.parseMph('50'), 30); // km/h
  assert.equal(OSM.parseMph('national'), null);
  assert.deepEqual(OSM.parseLanes('left|through|through;right'), [['left'], ['through'], ['through', 'right']]);
  assert.deepEqual(OSM.parseLanes('|right'), [['none'], ['right']]);
  assert.equal(OSM.parseLanes('none|none'), null);
  assert.equal(OSM.parseLanes('left'), null);
});

test('which lanes to use', () => {
  const lanes = [['left'], ['through'], ['through', 'right']];
  assert.deepEqual(OSM.lanesToUse(lanes, -90), [true, false, false]);
  assert.deepEqual(OSM.lanesToUse(lanes, 0), [false, true, true]);
  assert.deepEqual(OSM.lanesToUse(lanes, 80), [false, false, true]);
  assert.deepEqual(OSM.lanesToUse([['none'], ['right']], 0), [true, false]); // unmarked lane = ahead
});

// Route: east 600 m along a two-way road, then turn LEFT (north) for 300 m.
const g = buildGeom([at(0, 0), at(600, 0), at(600, 300)]);
const elements = [
  // Two-way road drawn WEST-wards (against us), 30 mph, lanes for our direction = backward.
  { type: 'way', id: 1, nodes: [10, 11, 12], geometry: geo([400, 0], [200, 0], [0, 0]), tags: { highway: 'primary', maxspeed: '30 mph' } },
  { type: 'way', id: 2, nodes: [13, 14, 10], geometry: geo([600, 0], [500, 0], [400, 0]),
    tags: { highway: 'primary', maxspeed: '30 mph', 'turn:lanes:backward': 'left|through;right', 'turn:lanes:forward': 'through|right' } },
  // North leg, 20 mph, drawn our way.
  { type: 'way', id: 3, nodes: [13, 15], geometry: geo([600, 0], [600, 300]), tags: { highway: 'residential', maxspeed: '20 mph' } },
  // Opposite carriageway of some dual road: one-way against us, 5 m away. Must be ignored.
  { type: 'way', id: 4, nodes: [20, 21], geometry: geo([300, 5], [100, 5]), tags: { highway: 'primary', oneway: 'yes', maxspeed: '70 mph', 'turn:lanes': 'left|left' } },
  // A side road crossing ours. Must be ignored, along with its give-way line.
  { type: 'way', id: 5, nodes: [30, 11, 31], geometry: geo([200, -40], [200, 0], [200, 40]), tags: { highway: 'residential', maxspeed: '20 mph' } },
  node(30, 200, -6, { highway: 'give_way' }),
  node(11, 200, 0, { highway: 'traffic_signals' }),
  node(14, 500, 0, { highway: 'crossing', crossing: 'zebra' }),
  node(13, 600, 0, { highway: 'give_way' }), // at the end of our road: applies to us
  node(12, 0, 0, { highway: 'give_way' }), // at the START of our road: for traffic coming the other way
  node(99, 450, 15, { highway: 'speed_camera' }),
];

test('fits OpenStreetMap roads onto the route', () => {
  const moves = [{ d: 600, type: 'left' }];
  const osm = OSM.analyse(g, elements, moves);
  const near = (x, y) => Math.abs(x - y) < 3;
  assert.deepEqual(osm.limits.map((l) => l.mph), [30, 20]);
  assert.ok(near(osm.limits[0].from, 0) && near(osm.limits[0].to, 600) && near(osm.limits[1].to, 900));
  assert.equal(OSM.limitAt(osm, 300), 30);
  assert.equal(OSM.limitAt(osm, 700), 20);

  assert.equal(osm.lanes.length, 1);
  const [s] = osm.lanes;
  assert.ok(near(s.from, 400) && near(s.to, 600));
  assert.deepEqual(s.lanes, [['left'], ['through', 'right']]);
  assert.deepEqual(s.use, [true, false]); // we turn left at the end
  assert.equal(OSM.lanesAt(osm, 100), null);
  assert.ok(OSM.lanesAt(osm, 300)); // shown from 120 m before
  assert.equal(OSM.lanesAt(osm, 650), null);

  assert.deepEqual(osm.spots.map((x) => [Math.round(x.d / 10) * 10, x.label]), [
    [200, 'Traffic lights'], [450, 'Speed camera'], [500, 'Zebra crossing'], [600, 'Give way'],
  ]);
  assert.equal(OSM.nextSpot(osm, 100).label, 'Traffic lights');
  assert.equal(OSM.nextSpot(osm, 210), null);
  assert.equal(OSM.nextSpot(osm, 360).label, 'Speed camera');
  assert.equal(OSM.nextSpot(osm, 610), null);
});

test('query is well formed and short', () => {
  const q = OSM.buildQuery(g.pts);
  assert.match(q, /^\[out:json\]/);
  assert.match(q, /out body geom;$/);
  assert.ok(OSM.thin(g.pts.concat()).length <= 3);
});

test('units', () => {
  assert.equal(U.dist(100), '110 yd');
  assert.equal(U.dist(5400), '3.4 mi');
  assert.equal(U.ahead(5), 'Now');
  assert.equal(U.ahead(110), '120 yd');
  assert.equal(U.ahead(320), '350 yd');
  assert.equal(U.ahead(1609), '1 mi');
  U.setImperial(false);
  assert.equal(U.dist(5400), '5.4 km');
  assert.equal(U.ahead(120), '120 m');
  U.setImperial(true);
});
