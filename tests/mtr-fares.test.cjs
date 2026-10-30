'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const network = require('../assets/mtr-network.json');
const fares = require('../assets/mtr-fares.json');

const stationCodes = new Set(network.stations.features.map(feature => feature.properties.code));
const fareByPair = new Map(fares.pairs.map(pair => [pair[0] + '|' + pair[1], pair]));

test('official MTR fare pairs map to bundled stations and have one row per origin/destination', () => {
  assert.equal(fares.pairs.length, fareByPair.size);
  for (const [from, to, ...values] of fares.pairs) {
    assert.ok(stationCodes.has(from), 'unknown fare origin ' + from);
    assert.ok(stationCodes.has(to), 'unknown fare destination ' + to);
    assert.equal(values.length, fares.cardTypes.length);
    assert.ok(values.every(value => value === null || Number.isFinite(value)), 'invalid fare value ' + from + ' → ' + to);
  }
  for (const code of stationCodes) assert.ok(fareByPair.has(code + '|' + code), 'missing self fare for ' + code);
});

test('standard Octopus card fares and Airport Express unsupported types stay faithful to the official tables', () => {
  assert.deepEqual(fareByPair.get('CEN|ADM'), ['CEN', 'ADM', 4.9, 3.2, 3.2, 2, 2, 2]);
  assert.deepEqual(fareByPair.get('HOK|AIR'), ['HOK', 'AIR', 120, null, 60, null, null, null]);
  assert.deepEqual(fareByPair.get('AIR|AWE'), ['AIR', 'AWE', 6.5, null, 3.2, null, null, null]);
});
