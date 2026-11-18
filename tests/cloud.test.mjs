import test from 'node:test';
import assert from 'node:assert/strict';
import { merge, fingerprint, parseRepo } from '../js/cloud.js';

const r = (id, savedAt, name = id) => ({ id, savedAt, name, path: [] });

test('newest copy of each route wins', () => {
  const pc = { routes: [r('a', 10, 'old'), r('b', 5)], deleted: {} };
  const phone = { routes: [r('a', 20, 'new'), r('c', 7)], deleted: {} };
  const m = merge(pc, phone);
  assert.deepEqual(m.routes.map((x) => x.id).sort(), ['a', 'b', 'c']);
  assert.equal(m.routes.find((x) => x.id === 'a').name, 'new');
  assert.equal(fingerprint(merge(phone, pc)), fingerprint(m));
});

test('deleted routes stay deleted unless saved again later', () => {
  const pc = { routes: [r('b', 5)], deleted: { a: 30 } };
  const phone = { routes: [r('a', 20), r('b', 5)], deleted: {} };
  assert.deepEqual(merge(pc, phone).routes.map((x) => x.id), ['b']);
  const phone2 = { routes: [r('a', 40)], deleted: {} }; // re-saved after the delete
  assert.deepEqual(merge(pc, phone2).routes.map((x) => x.id).sort(), ['a', 'b']);
  assert.equal(merge(pc, phone).deleted.a, 30);
});

test('empty or missing cloud copy', () => {
  const pc = { routes: [r('a', 1)], deleted: {} };
  assert.equal(fingerprint(merge(pc, null)), fingerprint(pc));
  assert.notEqual(fingerprint(pc), fingerprint({ routes: [], deleted: {} }));
});

test('repository names', () => {
  assert.equal(parseRepo('luke/route-data'), 'luke/route-data');
  assert.equal(parseRepo(' https://github.com/luke/route-data.git '), 'luke/route-data');
  assert.equal(parseRepo('https://github.com/luke/route-data/'), 'luke/route-data');
  assert.equal(parseRepo('route-data'), null);
});
