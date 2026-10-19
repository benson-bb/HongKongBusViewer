const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const result = JSON.parse(execFileSync(process.execPath, [path.join(root, 'scripts/import_osm_ferry_routes.cjs')], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024
}));
const direction = (routeId, index) => result.report.find(row => String(row.routeId) === routeId && row.direction === index);

test('maps Central–Sok Kwu Wan from the matching OSM ferry way in both directions', () => {
  for (const index of [0, 1]) {
    const row = direction('7008', index);
    assert.equal(row.status, 'matched');
    assert.equal(row.source, 'way/632340199');
    assert.ok(row.endsM.every(distance => distance <= 20));
    assert.equal(row.vertices, 76);
  }
});

test('joins OSM ferry legs at their shared piers when no single path covers the service', () => {
  for (const routeId of ['7000016', '7000023', '7014']) {
    for (const index of [0, 1]) {
      const row = direction(routeId, index);
      assert.equal(row.status, 'matched', `${routeId}:${index}`);
      assert.equal(row.composite, true, `${routeId}:${index}`);
      assert.equal(row.intermediateStopsMatched, '100%', `${routeId}:${index}`);
      assert.ok(row.legs.length >= 2, `${routeId}:${index}`);
    }
  }
});

test('keeps a return direction off the OSM path that includes a stop it skips', () => {
  const row = direction('7000020', 0);
  assert.equal(row.status, 'excluded');
  assert.match(row.reason, /explicitly excluded/);
  assert.ok(row.candidates.some(candidate => candidate.source === 'way/1235785818'));
});

test('does not invent geometry for circular routes without connected OSM coverage', () => {
  for (const routeId of ['7000025', '7000030']) {
    assert.equal(direction(routeId, 0).status, 'skipped');
  }
  assert.equal(result.summary.matchedDirections, 103);
  assert.equal(result.summary.ambiguousDirections, 0);
});
