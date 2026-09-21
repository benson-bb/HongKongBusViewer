const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const defaultShapes = path.join(root, 'data', 'Bus_routes_converted.json');

// Locate JSON literals without evaluating the application's JavaScript.
function literal(html, name) {
  const start = html.indexOf(name + '=') + name.length + 1;
  if (start < name.length + 1 || html[start] !== '[') throw Error(`Missing ${name}`);
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '[' || c === '{') depth++;
    else if ((c === ']' || c === '}') && --depth === 0) return { start, end: i + 1, value: JSON.parse(html.slice(start, i + 1)) };
  }
  throw Error(`Unclosed ${name}`);
}
function encode(points) {
  let lat = 0, lon = 0, result = '';
  function write(n) { n = n < 0 ? ~(n << 1) : n << 1; while (n >= 32) { result += String.fromCharCode((32 | (n & 31)) + 63); n >>>= 5; } result += String.fromCharCode(n + 63); }
  for (const p of points) { const y = Math.round(p[1] * 1e5), x = Math.round(p[0] * 1e5); write(y - lat); write(x - lon); lat = y; lon = x; }
  return result;
}
function decode(encoded) {
  let i = 0, lat = 0, lon = 0, points = [];
  while (i < encoded.length) {
    let byte, shift = 0, value = 0;
    do { byte = encoded.charCodeAt(i++) - 63; value |= (byte & 31) << shift; shift += 5; } while (byte >= 32);
    lat += (value & 1) ? ~(value >> 1) : value >> 1;
    shift = 0; value = 0;
    do { byte = encoded.charCodeAt(i++) - 63; value |= (byte & 31) << shift; shift += 5; } while (byte >= 32);
    lon += (value & 1) ? ~(value >> 1) : value >> 1;
    points.push([lon / 1e5, lat / 1e5]);
  }
  return points;
}
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const squareTolerance = tolerance * tolerance, keep = new Uint8Array(points.length), stack = [[0, points.length - 1]];
  keep[0] = keep[points.length - 1] = 1;
  while (stack.length) {
    const [start, end] = stack.pop(), a = points[start], b = points[end];
    const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
    let best = squareTolerance, index = -1;
    for (let i = start + 1; i < end; i++) {
      const point = points[i], ratio = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)) : 0;
      const x = point[0] - a[0] - ratio * dx, y = point[1] - a[1] - ratio * dy, distance = x * x + y * y;
      if (distance > best) { best = distance; index = i; }
    }
    if (index >= 0) { keep[index] = 1; stack.push([start, index], [index, end]); }
  }
  return points.filter((_, index) => keep[index]);
}
function properties(feature) { return feature.properties || feature.attributes || {}; }
function shapeParts(feature) {
  const geometry = feature.geometry || {};
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  // Supports a direct ArcGIS FeatureServer export too.
  return geometry.paths;
}
function validLine(feature) {
  const paths = shapeParts(feature);
  // These are already official route-shape fragments. Only join touching fragments;
  // no road-network search or synthetic connection is performed here.
  if (!Array.isArray(paths) || !paths.length || paths.some(p => !Array.isArray(p) || !p.length)) return null;
  const line = [...paths[0]];
  const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.000002;
  for (const part of paths.slice(1)) {
    if (same(line.at(-1), part[0])) line.push(...part.slice(1));
    else if (same(line.at(-1), part.at(-1))) line.push(...[...part].reverse().slice(1));
    else return null;
  }
  return line.length >= 2 && line.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] > 113 && p[0] < 115 && p[1] > 21 && p[1] < 24) ? line : null;
}
function loadShapes(file) {
  const collection = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features) || !collection.features.length) throw Error('Expected a non-empty GeoJSON FeatureCollection.');
  for (const feature of collection.features) {
    const p = properties(feature);
    if (p.ROUTE_ID == null || p.ROUTE_SEQ == null || !p.ROUTE_NAMEE) throw Error('A shape is missing its CSDI route identity.');
  }
  return { id: path.basename(file), features: collection.features };
}
function buildLodGeoJson(routes, patternRows, lodIndex, level) {
  const patterns = new Map(patternRows.map(row => [String(row.i), row.d]));
  const features = [];
  for (const route of routes) for (const [patternIndex, levels] of (route.l || []).entries()) {
    const encoded = levels[lodIndex];
    if (!encoded) continue;
    const direction = patterns.get(String(route.i))?.[patternIndex]?.d ?? route.geometrySources?.[patternIndex]?.direction ?? null;
    features.push({
      type: 'Feature',
      properties: {
        route_id: String(route.i), route_number: route.s, route_name: route.n,
        agency: route.a, direction, pattern_index: patternIndex, lod: level,
        geometry_provider: route.geometrySources?.[patternIndex]?.provider || null
      },
      geometry: { type: 'LineString', coordinates: decode(encoded) }
    });
  }
  return { type: 'FeatureCollection', features };
}
function apply(html, datasets) {
  const packed = literal(html, 'packed'), patterns = new Map(literal(html, 'stopPatternPacked').value.map(r => [String(r.i), r.d]));
  const stops = new Map(literal(html, 'stopPacked').value.map(s => [String(s[0]), [s[2], s[3]]]));
  const index = new Map();
  for (const dataset of datasets) for (const feature of dataset.features) {
    const p = properties(feature), key = `${p.ROUTE_ID}|${p.ROUTE_SEQ}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ feature, source: dataset.id });
  }
  const report = { generatedAt: new Date().toISOString(), matched: 0, preserved: 0, missing: [], byAgency: {}, sources: datasets.map(d => ({ id: d.id, count: d.features.length })) };
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  for (const route of packed.value) {
    if (['FERRY', 'TRAM', 'PTRAM'].includes(route.a)) continue;
    for (const [i, pattern] of (patterns.get(String(route.i)) || []).entries()) {
      const matches = (index.get(`${route.i}|${pattern.d}`) || []).filter(m => String(properties(m.feature).ROUTE_NAMEE ?? properties(m.feature).ROUTE_NAME).toUpperCase() === String(route.s).toUpperCase());
      const line = matches.length === 1 ? validLine(matches[0].feature) : null;
      if (!line || i >= route.e.length) {
        if (route.geometrySources?.[i]?.provider === 'CSDI Transport Department') { report.preserved++; continue; }
        report.missing.push({ routeId: route.i, agency: route.a, route: route.s, direction: pattern.d, patternIndex: i, reason: matches.length ? 'disconnected-official-shape' : 'no-local-official-shape', stops: pattern.s.map(s => stops.get(String(s[0]))).filter(Boolean) });
        continue;
      }
      const first = stops.get(String(pattern.s[0]?.[0])), last = stops.get(String(pattern.s.at(-1)?.[0]));
      if (first && last && distance(line[0], last) + distance(line.at(-1), first) < distance(line[0], first) + distance(line.at(-1), last)) line.reverse();
      route.e[i] = encode(line);
      (route.geometrySources ||= {})[i] = { provider: 'CSDI Transport Department', dataset: matches[0].source, direction: pattern.d };
      report.matched++; report.byAgency[route.a] = (report.byAgency[route.a] || 0) + 1;
    }
  }
  report.lodVertices = { low: 0, intermediate: 0 };
  for (const route of packed.value) route.l = route.e.map(encoded => {
    const detail = decode(encoded), low = simplify(detail, 0.0003), intermediate = simplify(detail, 0.0001);
    report.lodVertices.low += low.length; report.lodVertices.intermediate += intermediate.length;
    return [encode(low), encode(intermediate)];
  });
  let output = html.slice(0, packed.start) + JSON.stringify(packed.value).replace(/</g, '\\u003c') + html.slice(packed.end);
  output = output.replace('new maplibregl.AttributionControl({compact:true})', 'new maplibregl.AttributionControl({compact:true,customAttribution:"Route geometry: © Transport Department, HKSAR Government (CSDI)"})');
  return { html: output, report, routes: packed.value };
}
function main() {
  const shapes = loadShapes(path.resolve(process.argv[2] || defaultShapes));
  const file = path.join(root, 'index.html'), html = fs.readFileSync(file, 'utf8'), patternRows = literal(html, 'stopPatternPacked').value, result = apply(html, [shapes]);
  if (!result.report.matched) throw Error('No exact route/direction matches; leaving the app unchanged.');
  fs.writeFileSync(file + '.tmp', result.html); fs.renameSync(file + '.tmp', file);
  fs.writeFileSync(path.join(root, 'data', 'csdi-coverage.json'), JSON.stringify(result.report, null, 2));
  const exports = [
    ['low', buildLodGeoJson(result.routes, patternRows, 0, 'low')],
    ['intermediate', buildLodGeoJson(result.routes, patternRows, 1, 'intermediate')]
  ];
  for (const [level, collection] of exports) {
    const output = path.join(root, 'data', `routes-lod-${level}.geojson`), temporary = output + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(collection));
    fs.renameSync(temporary, output);
  }
  console.log(JSON.stringify({ matched: result.report.matched, preserved: result.report.preserved, missing: result.report.missing.length, byAgency: result.report.byAgency, lodVertices: result.report.lodVertices }));
}
module.exports = { literal, encode, decode, simplify, buildLodGeoJson, apply, validLine, loadShapes };
if (require.main === module) try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
