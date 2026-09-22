const { test } = require('node:test');
const assert = require('node:assert/strict');
const basemaps = require('../assets/trailsta-basemaps.js');

test('bundles the supplied Positron and Fiord Color style definitions', () => {
  assert.deepEqual(basemaps.styleUrls, {
    positron: 'https://styles.trailsta.sh/positron.json',
    'fiord-color': 'https://styles.trailsta.sh/fiord-color.json'
  });
  assert.equal(basemaps.source.type, 'vector');
  assert.equal(basemaps.source.url, 'https://tiles.openfreemap.org/planet');
  assert.equal(basemaps.layerIds('positron').length, 50);
  assert.equal(basemaps.layerIds('fiord-color').length, 48);
});

test('prefixes layers, shares the vector source and preserves native visibility', () => {
  const positron = basemaps.layers('positron', true);
  const fiord = basemaps.layers('fiord-color', true);
  assert.equal(new Set([...positron, ...fiord].map(layer => layer.id)).size, 98);
  assert(positron.every(layer => layer.id.startsWith('trailsta-positron-')));
  assert(fiord.every(layer => layer.id.startsWith('trailsta-fiord-color-')));
  assert([...positron, ...fiord].filter(layer => layer.source).every(layer => layer.source === 'trailsta-openmaptiles'));
  const native = basemaps.visibility('fiord-color');
  assert.equal(native['trailsta-fiord-color-highway_ref'], 'none');
  assert.equal(fiord.find(layer => layer.id === 'trailsta-fiord-color-highway_ref').layout.visibility, 'none');
  assert(basemaps.layers('fiord-color', false).every(layer => layer.layout.visibility === 'none'));
});
