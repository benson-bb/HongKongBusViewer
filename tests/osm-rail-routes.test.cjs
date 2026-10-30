const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const report = JSON.parse(execFileSync(process.execPath, [path.join(root, 'scripts/import_osm_rail_routes.cjs')], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 2 * 1024 * 1024
})).report;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function readArray(name) {
  const markerAt = html.indexOf(`${name}=`);
  assert.notEqual(markerAt, -1, `${name} is present in the app`);
  let start = markerAt + name.length + 1;
  while (/\s/.test(html[start])) start++;
  const open = html[start], close = open === '[' ? ']' : '}';
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error(`Unclosed ${name}`);
}

function decode(encoded) {
  let index = 0, lat = 0, lon = 0;
  const coordinates = [];
  while (index < encoded.length) {
    let chunk, shift = 0, result = 0;
    do { chunk = encoded.charCodeAt(index++) - 63; result |= (chunk & 31) << shift; shift += 5; } while (chunk >= 32);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { chunk = encoded.charCodeAt(index++) - 63; result |= (chunk & 31) << shift; shift += 5; } while (chunk >= 32);
    lon += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push([lon / 1e5, lat / 1e5]);
  }
  return coordinates;
}

function pointLineDistance(point, line) {
  const scaleY = 111320, scaleX = scaleY * Math.cos(point[1] * Math.PI / 180);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - point[0]) * scaleX, ay = (line[i - 1][1] - point[1]) * scaleY;
    const bx = (line[i][0] - point[0]) * scaleX, by = (line[i][1] - point[1]) * scaleY;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

const stopRows = new Map(readArray('stopPacked').map(stop => [String(stop[0]), stop]));
const patterns = new Map(readArray('stopPatternPacked').map(pattern => [String(pattern.i), pattern]));
const appWindow = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/osm-rail-routes.js'), 'utf8'), { window: appWindow });
const shapes = appWindow.HK_OSM_RAIL_ROUTES;

test('all tram and Peak Tram directions use track-following OSM geometries', () => {
  const expectedKeys = ['4001:0', '4001:1', '4002:0', '4002:1', '4003:0', '4003:1', '4004:0', '4004:1', '4005:0', '4005:1', '5001:0', '5001:1'];
  assert.deepEqual(Object.keys(shapes).sort(), expectedKeys.sort());
  assert.equal(report.length, expectedKeys.length);
  for (const [key, shape] of Object.entries(shapes)) {
    const [routeId, direction] = key.split(':');
    const pattern = patterns.get(routeId).d[Number(direction)];
    const line = decode(shape.high);
    assert.ok(line.length >= 2, key);
    const farthestStop = Math.max(...pattern.s.map(stop => {
      const row = stopRows.get(String(stop[0]));
      return pointLineDistance([row[2], row[3]], line);
    }));
    assert.ok(farthestStop <= 75, `${key} misses a scheduled stop by ${Math.round(farthestStop)}m`);
    assert.ok(report.find(row => row.routeId === routeId && row.direction === Number(direction)).maxStopDistanceM <= 75, key);
  }
});

test('the Happy Valley loop directions include their direction-specific stops', () => {
  for (const key of ['4002:1', '4003:0']) {
    const [routeId, direction] = key.split(':');
    const pattern = patterns.get(routeId).d[Number(direction)];
    const line = decode(shapes[key].high);
    const max = Math.max(...pattern.s.map(stop => {
      const row = stopRows.get(String(stop[0]));
      return pointLineDistance([row[2], row[3]], line);
    }));
    assert.ok(max < 15, `${key} should pass within 15m of every stop; got ${Math.round(max)}m`);
  }
});

test('prefers the North Point service relation when it better matches that direction', () => {
  const row = report.find(item => item.routeId === '4005' && item.direction === 0);
  assert.equal(row.source, 'relation/4088481');
  assert.ok(row.maxStopDistanceM <= 5);
});

test('Peak Tram geometry follows the track through all six stations', () => {
  for (const key of ['5001:0', '5001:1']) {
    assert.equal(shapes[key].source, 'relation/3264047');
    assert.ok(decode(shapes[key].high).length >= 35);
  }
});
