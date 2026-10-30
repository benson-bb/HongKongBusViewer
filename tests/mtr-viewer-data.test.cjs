'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { nearestFeature } = require('../assets/mtr-hit-test.js');

const root = path.join(__dirname, '..');
const network = JSON.parse(fs.readFileSync(path.join(root, 'assets/mtr-network.json'), 'utf8'));
const viewerHtml = fs.readFileSync(path.join(root, 'mtr.html'), 'utf8');
const viewerScript = fs.readFileSync(path.join(root, 'assets/mtr-viewer.js'), 'utf8');
const lineFeatures = new Map(network.routes.features.filter(feature => !feature.properties.branch).map(feature => [feature.properties.code, feature]));
const stationFeatures = new Map(network.stations.features.map(feature => [feature.properties.code, feature]));

test('bundled MTR network covers all ten MTR rail lines', () => {
  assert.deepEqual(network.lines.map(line => line.code).sort(), ['AEL', 'DRL', 'EAL', 'ISL', 'KTL', 'SIL', 'TCL', 'TKL', 'TML', 'TWL']);
  assert.equal(lineFeatures.size, network.lines.length);
});

test('every official MTR direction station has a mapped OSM location', () => {
  assert.equal(network.importReport.missingStationCoordinates.length, 0);
  for (const line of network.lines) {
    assert.ok(lineFeatures.has(line.code), 'missing route shape for ' + line.code);
    assert.ok(line.directions.length > 0, 'missing directions for ' + line.code);
    for (const direction of line.directions) {
      assert.ok(direction.stations.length > 1, 'empty direction ' + line.code + ':' + direction.code);
      const sequence = direction.stations.map(station => station.sequence);
      assert.deepEqual(sequence, [...sequence].sort((a, b) => a - b));
      for (const stop of direction.stations) {
        const feature = stationFeatures.get(stop.code);
        assert.ok(feature, 'missing OSM station point ' + line.code + ':' + stop.code);
        assert.ok(feature.properties.lineCodes.includes(line.code), 'station is not linked to line ' + line.code + ':' + stop.code);
        assert.equal(feature.properties.en, stop.en);
        assert.equal(feature.properties.zh, stop.zh);
      }
    }
  }
});

test('station properties identify route terminals and interchanges', () => {
  const terminalCodes = new Set();
  for (const line of network.lines) for (const direction of line.directions) {
    terminalCodes.add(direction.stations[0].code);
    terminalCodes.add(direction.stations[direction.stations.length - 1].code);
  }
  const interchanges = network.stations.features.filter(feature => feature.properties.isInterchange);
  assert.ok(terminalCodes.size > 0);
  assert.ok(interchanges.length > 0);
  for (const feature of network.stations.features) {
    assert.equal(feature.properties.isTerminal, terminalCodes.has(feature.properties.code), feature.properties.code);
    assert.equal(feature.properties.isInterchange, feature.properties.lineCodes.length > 1, feature.properties.code);
    assert.equal(feature.properties.color, network.lines.find(line => line.code === feature.properties.lineCodes[0]).color, feature.properties.code);
  }
});

test('Racecourse is included between Fo Tan and University on every East Rail service pattern', () => {
  const racecourse = stationFeatures.get('RAC');
  assert.ok(racecourse, 'Racecourse station marker is missing');
  assert.equal(racecourse.properties.zh, '馬場');
  assert.deepEqual(racecourse.properties.lineCodes, ['EAL']);
  const eastRail = network.lines.find(line => line.code === 'EAL');
  assert.ok(eastRail.directions.length > 0);
  for (const direction of eastRail.directions) {
    const fot = direction.stations.findIndex(station => station.code === 'FOT');
    const rac = direction.stations.findIndex(station => station.code === 'RAC');
    const uni = direction.stations.findIndex(station => station.code === 'UNI');
    assert.ok(fot >= 0 && rac >= 0 && uni >= 0, 'Racecourse missing from ' + direction.code);
    assert.equal(Math.abs(fot - rac), 1);
    assert.equal(Math.abs(rac - uni), 1);
  }
  const branch = network.routes.features.find(feature => feature.properties.code === 'EAL' && feature.properties.branch);
  assert.ok(branch, 'East Rail Racecourse branch is missing');
  assert.equal(branch.geometry.type, 'MultiLineString');
  const branchPath = branch.geometry.coordinates[0];
  assert.deepEqual(branchPath[0], stationFeatures.get('FOT').geometry.coordinates);
  assert.deepEqual(branchPath.at(-1), racecourse.geometry.coordinates);
  assert.ok(branch.geometry.coordinates.length > 1, 'parallel track segments should use the dashed branch styling too');
});

test('MTR route and station GeoJSON coordinates are valid Hong Kong WGS84 points', () => {
  for (const feature of network.routes.features) {
    const segments = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    assert.ok(feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString');
    assert.ok(segments.length > 0, 'empty geometry for ' + feature.properties.code);
    for (const segment of segments) {
      assert.ok(segment.length >= 2);
      for (const [lon, lat] of segment) {
        assert.ok(Number.isFinite(lon) && lon >= 113.7 && lon <= 114.6, 'invalid longitude ' + lon);
        assert.ok(Number.isFinite(lat) && lat >= 22.0 && lat <= 22.7, 'invalid latitude ' + lat);
      }
    }
  }
  for (const feature of network.stations.features) {
    assert.equal(feature.geometry.type, 'Point');
    const [lon, lat] = feature.geometry.coordinates;
    assert.ok(lon >= 113.7 && lon <= 114.6);
    assert.ok(lat >= 22.0 && lat <= 22.7);
    assert.match(feature.properties.color, /^#[0-9a-f]{6}$/i);
  }
});


test('all route termini end at their station markers', () => {
  const distanceMeters = (a, b) => Math.hypot(
    (a[0] - b[0]) * 102000 * Math.cos(a[1] * Math.PI / 180),
    (a[1] - b[1]) * 111000
  );
  for (const line of network.lines) {
    const routeSegments = network.routes.features.filter(feature => feature.properties.code === line.code)
      .flatMap(feature => feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates);
    const terminals = new Set(line.directions.flatMap(direction => [direction.stations[0].code, direction.stations.at(-1).code]));
    for (const code of terminals) {
      const station = stationFeatures.get(code);
      const nearest = Math.min(...routeSegments.flatMap(segment => segment.map(point => distanceMeters(point, station.geometry.coordinates))));
      assert.ok(nearest < 0.1, line.code + ':' + code + ' route ends ' + nearest.toFixed(2) + 'm from its station');
    }
  }
});

test('direct map hit testing picks the nearest eligible station in screen space', () => {
  const stations = [
    { properties: { code: 'CENTRAL', lineCodes: ['ISL'] }, geometry: { coordinates: [114.15, 22.28] } },
    { properties: { code: 'ADMIRALTY', lineCodes: ['ISL', 'TWL'] }, geometry: { coordinates: [114.16, 22.28] } },
    { properties: { code: 'CAUSEWAY_BAY', lineCodes: ['ISL'] }, geometry: { coordinates: [114.18, 22.28] } }
  ];
  const projected = new Map([
    [stations[0], { x: 20, y: 20 }],
    [stations[1], { x: 31, y: 20 }],
    [stations[2], { x: 90, y: 20 }]
  ]);
  const project = feature => projected.get(feature);

  assert.equal(nearestFeature(stations, { x: 29, y: 21 }, project, 16), stations[1]);
  assert.equal(nearestFeature(stations, { x: 29, y: 21 }, project, 16, feature => feature.properties.lineCodes.includes('TWL')), stations[1]);
  assert.equal(nearestFeature(stations, { x: 29, y: 21 }, project, 16, feature => feature.properties.lineCodes.includes('TKL')), null);
  assert.equal(nearestFeature(stations, { x: 55, y: 20 }, project, 16), null);
});

test('MTR map wires screen-space station hit testing before viewer interactions', () => {
  assert.ok(viewerHtml.indexOf('assets/mtr-hit-test.js') < viewerHtml.indexOf('assets/mtr-viewer.js'));
  assert.match(viewerScript, /MtrHitTest\.nearestFeature/);
  assert.match(viewerScript, /map\.on\('click', handleMapClick\)/);
});
