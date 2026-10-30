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

test('uses the direct return water crossing for High Island–Sai Kung without calling Kau Sai Village', () => {
  const row = direction('7000020', 0);
  assert.equal(row.status, 'matched');
  assert.equal(row.manual, true);
  assert.match(row.source, /direct-waterline/);
  assert.deepEqual(row.legs[0].endsM, [0, 0]);
  assert.equal(row.legs[0].from, '糧船灣碼頭');
  assert.equal(row.legs[0].to, '西貢公眾碼頭');
});

test('draws the Sha Tau Kok ferry loop through its scheduled piers', () => {
  const row = direction('7000030', 0);
  assert.equal(row.status, 'matched');
  assert.equal(row.manual, true);
  assert.equal(row.circular, true);
  assert.equal(row.intermediateStopsMatched, '100%');
  assert.deepEqual(row.legs.map(leg => leg.source), [
    'way/502378418',
    'way/502378419',
    'way/1446426987',
    'direct-waterline'
  ]);
  assert.deepEqual(row.legs.map(leg => [leg.from, leg.to]), [
    ['沙頭角公眾碼頭', '鴨洲公眾碼頭'],
    ['鴨洲公眾碼頭', '吉澳洲碼頭'],
    ['吉澳洲碼頭', '荔枝窩登岸梯級'],
    ['荔枝窩登岸梯級', '沙頭角公眾碼頭']
  ]);
});

test('leaves only circular routes without connected OSM coverage unchanged', () => {
  for (const routeId of ['7000025']) {
    assert.equal(direction(routeId, 0).status, 'skipped');
  }
  assert.equal(result.summary.matchedDirections, 105);
  assert.equal(result.summary.ambiguousDirections, 0);
});
