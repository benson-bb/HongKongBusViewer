'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { postprocessMtrNetwork } = require('./mtr-network-postprocess.cjs');
const { build: buildMtrFares } = require('./build_mtr_fares.cjs');

const root = process.cwd();
const csvUrl = 'https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv';
const fareCsvUrls = {
  regular: 'https://opendata.mtr.com.hk/data/mtr_lines_fares.csv',
  airport: 'https://opendata.mtr.com.hk/data/airport_express_fares.csv'
};
const osmApi = 'https://api.openstreetmap.org/api/0.6/relation/';
const wikiUrl = 'https://wiki.openstreetmap.org/wiki/Hong_Kong/Transport/Routes/MTR';

// Route-master relation IDs listed by the OSM Hong Kong/MTR route page.
const wikiLines = [
  { code: 'AEL', relation: '272078' },
  { code: 'DRL', relation: '1139477' },
  { code: 'EAL', relation: '272132' },
  { code: 'ISL', relation: '269670' },
  { code: 'KTL', relation: '6452936' },
  { code: 'TCL', relation: '269671' },
  { code: 'TKL', relation: '9736612' },
  { code: 'TML', relation: '272133' },
  { code: 'TWL', relation: '9736531' },
  { code: 'SIL', relation: '6827213' }
];

function decodeXml(value) {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function xmlAttrs(value) {
  const attrs = {};
  for (const match of value.matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[match[1]] = decodeXml(match[2]);
  return attrs;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift().map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, '') : value));
  return rows.map(values => Object.fromEntries(headers.map((header, i) => [header, values[i] || ''])));
}

function parseRelations(xml) {
  return [...xml.matchAll(/<relation\b([^>]*)>([\s\S]*?)<\/relation>/g)].map(match => {
    const block = match[0], attrs = xmlAttrs(match[1]), tags = {}, members = [];
    for (const tag of block.matchAll(/<tag\b([^>]*)\/>/g)) {
      const values = xmlAttrs(tag[1]);
      tags[values.k] = values.v;
    }
    for (const member of block.matchAll(/<member\b([^>]*)\/>/g)) members.push(xmlAttrs(member[1]));
    return { id: attrs.id, tags, members };
  });
}

function parseOsm(xml) {
  const nodes = new Map(), ways = new Map(), relations = parseRelations(xml);
  for (const match of xml.matchAll(/<node\b([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g)) {
    const attrs = xmlAttrs(match[1]), tags = {};
    for (const tag of (match[2] || '').matchAll(/<tag\b([^>]*)\/>/g)) {
      const values = xmlAttrs(tag[1]);
      tags[values.k] = values.v;
    }
    if (attrs.id && attrs.lon && attrs.lat) nodes.set(attrs.id, { id: attrs.id, lon: Number(attrs.lon), lat: Number(attrs.lat), tags });
  }
  for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const attrs = xmlAttrs(match[1]);
    const refs = [...match[2].matchAll(/<nd\b([^>]*)\/>/g)].map(nd => xmlAttrs(nd[1]).ref);
    if (attrs.id) ways.set(attrs.id, { id: attrs.id, refs });
  }
  return { nodes, ways, relations };
}

async function getText(url, retries = 3) {
  let error;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'HongKongTransitRouteViewer/1.0 (OSM MTR route import)' },
        signal: AbortSignal.timeout(30000)
      });
      if (response.ok) return await response.text();
      error = new Error('HTTP ' + response.status + ' for ' + url);
      if (response.status !== 429 && response.status < 500) break;
    } catch (err) { error = err; }
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw error;
}

async function main() {
  const [csv, regularFareCsv, airportFareCsv] = await Promise.all([
    getText(csvUrl), getText(fareCsvUrls.regular), getText(fareCsvUrls.airport)
  ]);
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  await fs.writeFile(path.join(root, 'data/mtr_lines_and_stations.csv'), csv, 'utf8');
  await fs.writeFile(path.join(root, 'data/mtr_lines_fares.csv'), regularFareCsv, 'utf8');
  await fs.writeFile(path.join(root, 'data/airport_express_fares.csv'), airportFareCsv, 'utf8');
  const rows = parseCsv(csv);
  const roots = new Map();
  for (const line of wikiLines) {
    const xml = await getText(osmApi + line.relation + '/full');
    const parsed = parseOsm(xml);
    const relation = parsed.relations.find(item => item.id === line.relation);
    if (!relation) throw new Error('OSM Wiki route relation ' + line.relation + ' was not returned');
    const children = relation.members.filter(member => member.type === 'relation').map(member => member.ref);
    if (!children.length) throw new Error('No route members found in OSM Wiki relation ' + line.relation);
    roots.set(line.code, { ...line, tags: relation.tags, children });
  }

  const uniqueChildren = [...new Set([...roots.values()].flatMap(line => line.children))];
  const childXml = new Map();
  for (let i = 0; i < uniqueChildren.length; i += 3) {
    const batch = uniqueChildren.slice(i, i + 3);
    const responses = await Promise.all(batch.map(async id => [id, await getText(osmApi + id + '/full')]));
    for (const [id, xml] of responses) childXml.set(id, xml);
    if (i + 3 < uniqueChildren.length) await new Promise(resolve => setTimeout(resolve, 250));
  }

  const routeDataByLine = new Map();
  const osmStationCandidates = [];
  for (const rootLine of roots.values()) {
    const stationCandidates = new Map(), segments = new Map();
    for (const childId of rootLine.children) {
      const xml = childXml.get(childId);
      if (!xml) continue;
      const parsed = parseOsm(xml);
      const relation = parsed.relations.find(item => item.id === childId);
      if (!relation) continue;

      for (const member of relation.members) {
        if (member.type === 'node' && /^stop/.test(member.role || '')) {
          const node = parsed.nodes.get(member.ref);
          if (!node) continue;
          const code = node.tags.ref;
          const candidate = {
            lon: node.lon, lat: node.lat,
            en: node.tags['name:en'] || node.tags.name || '',
            zh: node.tags['name:zh-Hant'] || node.tags['name:zh'] || node.tags.name || ''
          };
          if (code) {
            if (!stationCandidates.has(code)) stationCandidates.set(code, []);
            stationCandidates.get(code).push(candidate);
          }
          if (candidate.en || candidate.zh) osmStationCandidates.push(candidate);
        }
        if (member.type === 'way' && !/platform|station|stop|entry|exit|connection/i.test(member.role || '')) {
          const way = parsed.ways.get(member.ref);
          if (!way || segments.has(way.id)) continue;
          const coordinates = way.refs.map(ref => parsed.nodes.get(ref)).filter(Boolean).map(node => [node.lon, node.lat]);
          if (coordinates.length >= 2) segments.set(way.id, coordinates);
        }
      }
    }
    routeDataByLine.set(rootLine.code, { root: rootLine, stationCandidates, segments });
  }

  const rowsByLine = new Map();
  for (const row of rows) {
    const code = row['Line Code'], stationCode = row['Station Code'];
    if (!rowsByLine.has(code)) rowsByLine.set(code, []);
    rowsByLine.get(code).push({
      direction: row.Direction,
      code: stationCode,
      id: row['Station ID'],
      zh: row['Chinese Name'],
      en: row['English Name'],
      sequence: Number(row.Sequence)
    });
  }

  const allStationCandidates = new Map();
  for (const data of routeDataByLine.values()) {
    for (const [code, positions] of data.stationCandidates) {
      if (!allStationCandidates.has(code)) allStationCandidates.set(code, []);
      allStationCandidates.get(code).push(...positions);
    }
  }
  const normalized = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\s()（）\-–—]/g, '');
  const stationRows = [...rowsByLine.values()].flat();
  const stationInfoByCode = new Map();
  for (const row of stationRows) if (!stationInfoByCode.has(row.code)) stationInfoByCode.set(row.code, row);
  for (const [code, info] of stationInfoByCode) {
    if (allStationCandidates.has(code)) continue;
    const candidates = osmStationCandidates.filter(candidate =>
      (candidate.en && normalized(candidate.en) === normalized(info.en)) ||
      (candidate.zh && normalized(candidate.zh) === normalized(info.zh))
    );
    if (candidates.length) allStationCandidates.set(code, candidates);
  }

  const lines = [];
  const missing = [];
  for (const [code, data] of routeDataByLine) {
    const routeRows = rowsByLine.get(code) || [];
    for (const row of routeRows) {
      if (!allStationCandidates.has(row.code)) missing.push(code + ':' + row.code + ' ' + row.en);
    }
    const directions = [...new Set(routeRows.map(row => row.direction))].map(direction => ({
      code: direction,
      stations: routeRows.filter(row => row.direction === direction).sort((a, b) => a.sequence - b.sequence)
        .map(row => ({ code: row.code, id: row.id, zh: row.zh, en: row.en, sequence: row.sequence }))
    }));
    const meta = data.root.tags;
    const color = /^#[0-9a-f]{6}$/i.test(meta.colour || '') ? meta.colour : '#2563eb';
    const geometry = { type: 'MultiLineString', coordinates: [...data.segments.values()] };
    lines.push({
      code, zh: meta['name:zh'] || meta.name || code, en: meta['name:en'] || meta.name || code,
      color, sourceRelation: data.root.relation, memberRelations: data.root.children,
      directions, geometry
    });
  }

  const stationsByCode = new Map();
  for (const line of lines) {
    const data = routeDataByLine.get(line.code);
    for (const direction of line.directions) for (const stop of direction.stations) {
      const positions = allStationCandidates.get(stop.code);
      if (!positions || !positions.length) continue;
      const point = positions.reduce((sum, position) => [sum[0] + position.lon, sum[1] + position.lat], [0, 0]).map(value => value / positions.length);
      if (!stationsByCode.has(stop.code)) stationsByCode.set(stop.code, { code: stop.code, id: stop.id, zh: stop.zh, en: stop.en, positions: [], lineCodes: [] });
      const station = stationsByCode.get(stop.code);
      station.positions.push(point);
      if (!station.lineCodes.includes(line.code)) station.lineCodes.push(line.code);
    }
  }
  const terminalCodes = new Set();
  for (const line of lines) for (const direction of line.directions) {
    if (!direction.stations.length) continue;
    terminalCodes.add(direction.stations[0].code);
    terminalCodes.add(direction.stations[direction.stations.length - 1].code);
  }
  const stationFeatures = [...stationsByCode.values()].map(station => {
    const coordinates = station.positions.reduce((sum, position) => [sum[0] + position[0], sum[1] + position[1]], [0, 0]).map(value => value / station.positions.length);
    const isInterchange = station.lineCodes.length > 1;
    return {
      type: 'Feature',
      properties: { code: station.code, id: station.id, zh: station.zh, en: station.en, lineCodes: station.lineCodes, isTerminal: terminalCodes.has(station.code), isInterchange, color: lines.find(line => line.code === station.lineCodes[0])?.color || '#2563eb' },
      geometry: { type: 'Point', coordinates }
    };
  });
  const lineFeatures = lines.map(line => ({
    type: 'Feature',
    properties: { code: line.code, zh: line.zh, en: line.en, color: line.color },
    geometry: line.geometry
  }));

  const output = postprocessMtrNetwork({
    generatedAt: new Date().toISOString(),
    sources: {
      routeShapes: wikiUrl,
      routeStations: csvUrl,
      osmApiBase: 'https://api.openstreetmap.org/api/0.6/relation/',
      attribution: '© OpenStreetMap contributors (ODbL); MTR Corporation Limited'
    },
    lines,
    routes: { type: 'FeatureCollection', features: lineFeatures },
    stations: { type: 'FeatureCollection', features: stationFeatures },
    importReport: { roots: wikiLines, childRelationCount: uniqueChildren.length, missingStationCoordinates: missing }
  });
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets/mtr-network.json'), JSON.stringify(output), 'utf8');
  buildMtrFares();
  console.log(JSON.stringify({
    lines: lines.map(line => ({ code: line.code, name: line.en, routeMembers: line.memberRelations.length, trackWays: line.geometry.coordinates.length, stationRows: line.directions.reduce((sum, direction) => sum + direction.stations.length, 0) })),
    stationMarkers: stationFeatures.length, childRelations: uniqueChildren.length,
    missingStationCoordinates: missing, outputBytes: Buffer.byteLength(JSON.stringify(output))
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});




