#!/usr/bin/env node
// Build tram and Peak Tram track overrides from bundled OSM route relations.
// The source XML files are snapshots from api.openstreetmap.org; no network
// request is made when rebuilding the app asset.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function readArray(name) {
  const markerAt = html.indexOf(`${name}=`);
  if (markerAt < 0) throw new Error(`Could not find ${name} in index.html`);
  let start = markerAt + name.length + 1;
  while (/\s/.test(html[start])) start++;
  const open = html[start], close = open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) throw new Error(`Unexpected ${name} value`);
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
  throw new Error(`Unclosed ${name} value`);
}

const stopRows = new Map(readArray('stopPacked').map(stop => [String(stop[0]), stop]));
const patterns = new Map(readArray('stopPatternPacked').map(pattern => [String(pattern.i), pattern]));

function haversine(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const lat1 = a[1] * rad, lat2 = b[1] * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function projectOntoSegment(point, a, b) {
  const latScale = Math.PI / 180 * 6371000;
  const scaleX = latScale * Math.cos(point[1] * Math.PI / 180);
  const ax = (a[0] - point[0]) * scaleX, ay = (a[1] - point[1]) * latScale;
  const bx = (b[0] - point[0]) * scaleX, by = (b[1] - point[1]) * latScale;
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  return {
    distance: Math.hypot(ax + t * dx, ay + t * dy),
    coordinate: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  };
}

function readTrackNetwork(relationId) {
  const sourcePath = path.join(root, `data/osm-relation-${relationId}.xml`);
  const xml = fs.readFileSync(sourcePath, 'utf8');
  const relationStart = xml.indexOf(`<relation id="${relationId}"`);
  const relationEnd = xml.indexOf('</relation>', relationStart);
  if (relationStart < 0 || relationEnd < 0) throw new Error(`OSM relation ${relationId} is missing from ${sourcePath}`);
  const relationXml = xml.slice(relationStart, relationEnd);
  const excluded = new Set(['platform', 'station']);
  const memberIds = [...relationXml.matchAll(/<member type="way" ref="(\d+)" role="([^"]*)"\/>/g)]
    .filter(member => !excluded.has(member[2]))
    .map(member => member[1]);
  const nodes = new Map([...xml.matchAll(/<node id="(\d+)"[^>]*lat="([^"]+)" lon="([^"]+)"/g)]
    .map(match => [match[1], [Number(match[3]), Number(match[2])]]));
  const ways = new Map([...xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)]
    .map(match => [match[1], [...match[2].matchAll(/<nd ref="(\d+)"/g)].map(node => node[1])]));
  const segments = [], adjacency = new Map(), seenSegments = new Set();
  const addEdge = (from, to, coordinates, weight) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ node: to, coordinates, weight });
  };
  for (const wayId of new Set(memberIds)) {
    const refs = ways.get(wayId);
    if (!refs) throw new Error(`OSM relation ${relationId} is missing way ${wayId}`);
    for (let i = 1; i < refs.length; i++) {
      const from = refs[i - 1], to = refs[i], a = nodes.get(from), b = nodes.get(to);
      if (!a || !b) throw new Error(`OSM relation ${relationId} has incomplete geometry in way ${wayId}`);
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      if (seenSegments.has(key)) continue;
      seenSegments.add(key);
      const weight = haversine(a, b);
      const segment = { from, to, a, b, weight };
      segments.push(segment);
      addEdge(from, to, [a, b], weight);
      addEdge(to, from, [b, a], weight);
    }
  }
  return { source: `relation/${relationId}`, segments, adjacency };
}

function readServicePath(relationId, startPoint, endPoint) {
  const xml = fs.readFileSync(path.join(root, `data/osm-relation-${relationId}.xml`), 'utf8');
  const relationStart = xml.indexOf(`<relation id="${relationId}"`), relationEnd = xml.indexOf('</relation>', relationStart);
  if (relationStart < 0 || relationEnd < 0) throw new Error(`OSM service relation ${relationId} is missing`);
  const relationXml = xml.slice(relationStart, relationEnd);
  const members = [...relationXml.matchAll(/<member type="way" ref="(\d+)" role="([^"]*)"\/>/g)]
    .filter(member => !['platform', 'station'].includes(member[2]))
    .map(member => member[1]);
  const nodes = new Map([...xml.matchAll(/<node id="(\d+)"[^>]*lat="([^"]+)" lon="([^"]+)"/g)]
    .map(match => [match[1], [Number(match[3]), Number(match[2])]]));
  const ways = new Map([...xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)]
    .map(match => [match[1], [...match[2].matchAll(/<nd ref="(\d+)"/g)].map(node => node[1])]));
  const uniqueWays = [...new Set(members)].map(id => {
    const refs = ways.get(id);
    if (!refs?.length) throw new Error(`OSM service relation ${relationId} is missing way ${id}`);
    return refs;
  });
  const build = reverseFirst => {
    let ids = reverseFirst ? [...uniqueWays[0]].reverse() : [...uniqueWays[0]];
    for (const way of uniqueWays.slice(1)) {
      const tail = ids.at(-1);
      if (way[0] === tail) ids.push(...way.slice(1));
      else if (way.at(-1) === tail) ids.push(...way.slice(0, -1).reverse());
      else return null;
    }
    return ids.map(id => nodes.get(id));
  };
  const candidates = [build(false), build(true)].filter(Boolean);
  if (!candidates.length) throw new Error(`OSM service relation ${relationId} has disconnected track members`);
  candidates.sort((a, b) => {
    const score = line => haversine(startPoint, line[0]) + haversine(endPoint, line.at(-1));
    return score(a) - score(b);
  });
  let coordinates = candidates[0];
  if (haversine(startPoint, coordinates.at(-1)) + haversine(endPoint, coordinates[0]) < haversine(startPoint, coordinates[0]) + haversine(endPoint, coordinates.at(-1))) coordinates = [...coordinates].reverse();
  return { source: `relation/${relationId}`, coordinates };
}

function nearestSegment(point, network) {
  let best = null;
  for (const segment of network.segments) {
    const projection = projectOntoSegment(point, segment.a, segment.b);
    if (!best || projection.distance < best.distance) best = { ...projection, distance: projection.distance, segment };
  }
  return best;
}

function addAttachment(network, graph, id, projection) {
  graph.set(id, []);
  for (const [node, coordinate] of [[projection.segment.from, projection.segment.a], [projection.segment.to, projection.segment.b]]) {
    const weight = haversine(projection.coordinate, coordinate);
    graph.get(id).push({ node, coordinates: [projection.coordinate, coordinate], weight });
    graph.get(node).push({ node: id, coordinates: [coordinate, projection.coordinate], weight });
  }
}

function shortestPath(graph, start, end) {
  const distances = new Map([[start, 0]]), previous = new Map(), remaining = new Set(graph.keys());
  while (remaining.size) {
    let current = null;
    for (const node of remaining) if (distances.has(node) && (current === null || distances.get(node) < distances.get(current))) current = node;
    if (current === null || current === end) break;
    remaining.delete(current);
    for (const edge of graph.get(current) || []) {
      const candidate = distances.get(current) + edge.weight;
      if (!distances.has(edge.node) || candidate < distances.get(edge.node)) {
        distances.set(edge.node, candidate);
        previous.set(edge.node, { node: current, edge });
      }
    }
  }
  if (!previous.has(end)) throw new Error(`No connected rail path between route stops ${start} and ${end}`);
  const edges = [];
  for (let node = end; node !== start;) {
    const step = previous.get(node);
    if (!step) throw new Error(`Could not reconstruct rail path between ${start} and ${end}`);
    edges.push(step.edge);
    node = step.node;
  }
  edges.reverse();
  const coordinates = [];
  for (const edge of edges) coordinates.push(...(coordinates.length ? edge.coordinates.slice(1) : edge.coordinates));
  return coordinates;
}

function buildRouteGeometry(pattern, network, routeId, direction) {
  const projections = pattern.s.map(stop => {
    const row = stopRows.get(String(stop[0]));
    if (!row) throw new Error(`Route ${routeId}:${direction} references unknown stop ${stop[0]}`);
    const point = [row[2], row[3]], projection = nearestSegment(point, network);
    if (!projection || projection.distance > 250) throw new Error(`Route ${routeId}:${direction} cannot snap stop ${stop[1]} within 250 metres`);
    return { ...projection, point };
  });
  const graph = new Map([...network.adjacency].map(([node, edges]) => [node, [...edges]]));
  const stopIds = projections.map((_, index) => `stop:${routeId}:${direction}:${index}`);
  projections.forEach((projection, index) => addAttachment(network, graph, stopIds[index], projection));
  const coordinates = [];
  for (let i = 0; i < stopIds.length - 1; i++) {
    const segment = shortestPath(graph, stopIds[i], stopIds[i + 1]);
    coordinates.push(...(coordinates.length ? segment.slice(1) : segment));
  }
  const compact = coordinates.filter((point, index) => index === 0 || point[0] !== coordinates[index - 1][0] || point[1] !== coordinates[index - 1][1]);
  return {
    coordinates: compact,
    maxSnapDistance: Math.max(...projections.map(projection => projection.distance)),
    endpointDistances: [projections[0].distance, projections.at(-1).distance]
  };
}

function maxStopDistance(pattern, coordinates) {
  return Math.max(...pattern.s.map(stop => {
    const row = stopRows.get(String(stop[0]));
    return pointLineDistance([row[2], row[3]], coordinates);
  }));
}

function pointLineDistance(point, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, projectOntoSegment(point, line[i - 1], line[i]).distance);
  return best;
}

function encodePolyline(coordinates) {
  let previousLat = 0, previousLon = 0, encoded = '';
  for (const [lon, lat] of coordinates) {
    const scaledLat = Math.round(lat * 1e5), scaledLon = Math.round(lon * 1e5);
    for (const value of [scaledLat - previousLat, scaledLon - previousLon]) {
      let chunk = value < 0 ? ~(value << 1) : value << 1;
      while (chunk >= 0x20) {
        encoded += String.fromCharCode((0x20 | (chunk & 0x1f)) + 63);
        chunk >>= 5;
      }
      encoded += String.fromCharCode(chunk + 63);
    }
    previousLat = scaledLat;
    previousLon = scaledLon;
  }
  return encoded;
}

const networkByRoute = {
  '4001': { relation: 18008886, serviceRelation: 4088368 }, // Sheung Wan–Shau Kei Wan
  '4002': { relation: 18008886, serviceRelation: 4088517 }, // Happy Valley–Shau Kei Wan
  '4003': { relation: 18008886, serviceRelation: 3263757 }, // Kennedy Town–Happy Valley
  '4004': { relation: 18008886, serviceRelation: 4088087 }, // Shek Tong Tsui–Causeway Bay
  '4005': { relation: 18008886, serviceRelation: 4088481 }, // Shek Tong Tsui–North Point
  '5001': { relation: 3264047 } // Peak Tram
};
const networks = new Map();
const overrides = {}, report = [];

for (const [routeId, source] of Object.entries(networkByRoute)) {
  const routePattern = patterns.get(routeId);
  if (!routePattern) throw new Error(`App route ${routeId} is missing its stop pattern`);
  if (!networks.has(source.relation)) networks.set(source.relation, readTrackNetwork(source.relation));
  const network = networks.get(source.relation);
  const firstPattern = routePattern.d[0];
  const firstStart = stopRows.get(String(firstPattern.s[0][0]));
  const firstEnd = stopRows.get(String(firstPattern.s.at(-1)[0]));
  const servicePath = source.serviceRelation ? readServicePath(source.serviceRelation, [firstStart[2], firstStart[3]], [firstEnd[2], firstEnd[3]]) : null;
  for (const [direction, pattern] of routePattern.d.entries()) {
    const route = buildRouteGeometry(pattern, network, routeId, direction);
    let coordinates = route.coordinates, sourceText = source.serviceRelation ? `${network.source}; service relation/${source.serviceRelation}` : network.source;
    let maxDistance = maxStopDistance(pattern, coordinates);
    if (servicePath) {
      const startStop = stopRows.get(String(pattern.s[0][0])), endStop = stopRows.get(String(pattern.s.at(-1)[0]));
      let candidate = servicePath.coordinates;
      if (haversine([startStop[2], startStop[3]], candidate.at(-1)) + haversine([endStop[2], endStop[3]], candidate[0]) < haversine([startStop[2], startStop[3]], candidate[0]) + haversine([endStop[2], endStop[3]], candidate.at(-1))) candidate = [...candidate].reverse();
      const candidateMaxDistance = maxStopDistance(pattern, candidate);
      if (candidateMaxDistance <= maxDistance) {
        coordinates = candidate;
        maxDistance = candidateMaxDistance;
        sourceText = servicePath.source;
      }
    }
    if (maxDistance > 250) throw new Error(`Route ${routeId}:${direction} misses a stop by ${Math.round(maxDistance)}m`);
    overrides[`${routeId}:${direction}`] = { source: sourceText, high: encodePolyline(coordinates) };
    report.push({ routeId, direction, source: sourceText, vertices: coordinates.length, maxStopDistanceM: Math.round(maxDistance) });
  }
}

if (process.argv.includes('--write')) {
  const asset = `/* Hong Kong tram and Peak Tram track geometry derived from OpenStreetMap route relations.\n * Sources: tram network relation/18008886; Peak Tram relation/3264047.\n * OSM data is available under the Open Database License (ODbL); see README.md.\n */\nwindow.HK_OSM_RAIL_ROUTES=${JSON.stringify(overrides)};\n`;
  fs.writeFileSync(path.join(root, 'assets/osm-rail-routes.js'), asset);
  console.log(`Wrote assets/osm-rail-routes.js with ${report.length} directional geometries.`);
}
console.log(JSON.stringify({ report }, null, 2));
