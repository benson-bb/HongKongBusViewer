'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sources = {
  regular: 'data/mtr_lines_fares.csv',
  airport: 'data/airport_express_fares.csv'
};

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index++;
      row.push(cell); cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift().map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '') : value);
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function normalizeName(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fareValue(row, field) {
  const value = String(row[field] || '').trim();
  if (!value || !Number.isFinite(Number(value))) return null;
  return Number(value);
}

function farePair(row, airport = false) {
  const sourceName = airport ? row.ST_FROM : row.SRC_STATION_NAME;
  const destinationName = airport ? row.ST_TO : row.DEST_STATION_NAME;
  return {
    sourceName,
    destinationName,
    values: airport ? [
      fareValue(row, 'OCT_ADT_FARE'), null, fareValue(row, 'OCT_CHD_FARE'), null, null, null
    ] : [
      fareValue(row, 'OCT_ADT_FARE'), fareValue(row, 'OCT_STD_FARE'),
      fareValue(row, 'OCT_CON_CHILD_FARE'), fareValue(row, 'OCT_CON_ELDERLY_FARE'),
      fareValue(row, 'OCT_JOYYOU_SIXTY_FARE'), fareValue(row, 'OCT_CON_PWD_FARE')
    ]
  };
}

function build() {
  const network = JSON.parse(fs.readFileSync(path.join(root, 'assets/mtr-network.json'), 'utf8'));
  const stationByName = new Map();
  for (const feature of network.stations.features) {
    const name = normalizeName(feature.properties.en);
    if (name) stationByName.set(name, feature.properties.code);
  }
  const aliases = new Map([
    ['tsimshatsuieast', 'ETS'], ['easttsimshatsui', 'ETS'],
    ['hongkong', stationByName.get('hongkong')]
  ]);
  const codeForName = name => aliases.get(normalizeName(name)) || stationByName.get(normalizeName(name));
  const pairs = [], unmatched = new Set(), seen = new Set();
  const readRows = (filename, airport) => parseCsv(fs.readFileSync(path.join(root, filename), 'utf8'))
    .map(row => farePair(row, airport));

  for (const pair of [
    ...readRows(sources.regular, false),
    ...readRows(sources.airport, true)
  ]) {
    const from = codeForName(pair.sourceName), to = codeForName(pair.destinationName);
    if (!from || !to) {
      unmatched.add(pair.sourceName + ' → ' + pair.destinationName);
      continue;
    }
    const key = from + '|' + to;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push([from, to, ...pair.values]);
  }

  for (const code of stationByName.values()) {
    if (!code || seen.has(code + '|' + code)) continue;
    seen.add(code + '|' + code);
    pairs.push([code, code, 0, 0, 0, 0, 0, 0]);
  }

  if (unmatched.size) throw new Error('Unmatched fare station names: ' + [...unmatched].slice(0, 20).join('; '));
  const output = {
    generatedAt: new Date().toISOString(),
    sources: {
      regular: 'https://opendata.mtr.com.hk/data/mtr_lines_fares.csv',
      airportExpress: 'https://opendata.mtr.com.hk/data/airport_express_fares.csv'
    },
    cardTypes: ['adult', 'student', 'child', 'elderly', 'joyyou60', 'disability'],
    pairs
  };
  const destination = path.join(root, 'assets/mtr-fares.json');
  fs.writeFileSync(destination, JSON.stringify(output), 'utf8');
  process.stdout.write(JSON.stringify({ farePairs: pairs.length, unmatchedStations: unmatched.size, outputBytes: Buffer.byteLength(JSON.stringify(output)), destination }) + '\n');
}

if (require.main === module) {
  try { build(); }
  catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}

module.exports = { parseCsv, normalizeName, build };
