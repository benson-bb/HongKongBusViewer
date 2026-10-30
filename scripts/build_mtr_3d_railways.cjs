// Build a 3D MTR rail profile from the existing OSM-derived 2D track geometry
// and Lands Department indoor MTR platform elevations/shapes downloaded via
// the CSDI WFS API. Track heights between platforms are estimates.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const network = readJson('assets/mtr-network.json');
const amenities = readJson('data/mtr-platform-amenities.geojson');
const platformPolygons = readJson('data/mtr-platform-polygons.geojson');
const outputPath = path.join(root, 'data/mtr-3d-railway.geojson');

const EARTH_RADIUS = 6371008.8;
const DEG = Math.PI / 180;
const MAX_ANCHOR_DISTANCE_M = 180;
const LINE_HINTS = {
  AEL: ['airport express', '機場快綫', '機場快線', 'airport/asiaworld-expo', 'to airport/asiaworld-expo', 'from airport/asiaworld-expo'],
  DRL: ['disneyland resort line', '迪士尼綫', '迪士尼線'],
  EAL: ['east rail line', '東鐵綫', '東鐵線'],
  ISL: ['island line', '港島綫', '港島線'],
  KTL: ['kwun tong line', '觀塘綫', '觀塘線'],
  TCL: ['tung chung line', '東涌綫', '東涌線'],
  TKL: ['tseung kwan o line', '將軍澳綫', '將軍澳線'],
  TML: ['tuen ma line', '屯馬綫', '屯馬線'],
  TWL: ['tsuen wan line', '荃灣綫', '荃灣線'],
  SIL: ['south island line', '南港島綫', '南港島線']
};

function normalize(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '').replace(/station$/, '');
}

function lineMatches(code, text) {
  const normalizedText = normalize(text);
  return (LINE_HINTS[code] || []).some(hint => normalizedText.includes(normalize(hint)));
}

function coordinateKey(coordinate) {
  return Number(coordinate[0]).toFixed(7) + ',' + Number(coordinate[1]).toFixed(7);
}

function haversine(a, b) {
  const lat1 = Number(a[1]) * DEG, lat2 = Number(b[1]) * DEG;
  const dLat = lat2 - lat1, dLon = (Number(b[0]) - Number(a[0])) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function limitVerticalGrade(coordinates, maximumGrade = 0.08) {
  const result = coordinates.map(coordinate => coordinate.slice());
  if (result.length < 2) return result;
  const clampToNeighbor = (index, neighborIndex) => {
    const horizontal = haversine(result[index], result[neighborIndex]);
    const maximumChange = horizontal * maximumGrade;
    const center = result[neighborIndex][2];
    result[index][2] = Math.max(center - maximumChange, Math.min(center + maximumChange, result[index][2]));
  };
  // A bidirectional constraint pass removes tiny, implausibly steep steps while
  // spreading the adjustment across nearby route vertices on both sides.
  for (let index = 1; index < result.length; index++) clampToNeighbor(index, index - 1);
  for (let index = result.length - 2; index >= 0; index--) clampToNeighbor(index, index + 1);
  return result;
}

function project(point, a, b) {
  const latitude = Number(point[1]) * DEG;
  const sx = EARTH_RADIUS * DEG * Math.cos(latitude), sy = EARTH_RADIUS * DEG;
  const ax = (Number(a[0]) - Number(point[0])) * sx, ay = (Number(a[1]) - Number(point[1])) * sy;
  const bx = (Number(b[0]) - Number(point[0])) * sx, by = (Number(b[1]) - Number(point[1])) * sy;
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  const coordinate = [Number(a[0]) + (Number(b[0]) - Number(a[0])) * t, Number(a[1]) + (Number(b[1]) - Number(a[1])) * t];
  return { t, coordinate, distance: haversine(point, coordinate) };
}

function polygonCentroid(feature) {
  const ring = feature?.geometry?.coordinates?.[0] || [];
  if (!ring.length) return null;
  const sum = ring.reduce((result, coordinate) => [result[0] + coordinate[0], result[1] + coordinate[1]], [0, 0]);
  return [sum[0] / ring.length, sum[1] / ring.length];
}

function simplifyOpenPath(points, toleranceMeters, latitude) {
  if (points.length <= 2) return points.slice();
  const xScale = EARTH_RADIUS * DEG * Math.cos(latitude * DEG);
  const yScale = EARTH_RADIUS * DEG;
  const xy = points.map(point => [point[0] * xScale, point[1] * yScale]);
  const keep = new Set([0, points.length - 1]);
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    const a = xy[start], b = xy[end], dx = b[0] - a[0], dy = b[1] - a[1];
    let farthest = -1, maximumDistance = toleranceMeters;
    for (let index = start + 1; index < end; index++) {
      const p = xy[index];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const distance = Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
      if (distance > maximumDistance) { maximumDistance = distance; farthest = index; }
    }
    if (farthest >= 0) {
      keep.add(farthest);
      stack.push([start, farthest], [farthest, end]);
    }
  }
  return points.filter((_point, index) => keep.has(index));
}

function simplifyRing(ring, toleranceMeters = 1.5) {
  const open = ring.length > 1 && coordinateKey(ring[0]) === coordinateKey(ring[ring.length - 1])
    ? ring.slice(0, -1) : ring.slice();
  if (open.length < 4) return ring.slice();
  let farthest = 1, maximumDistance = 0;
  const origin = open[0], latitude = origin[1] * DEG, xScale = EARTH_RADIUS * DEG * Math.cos(latitude), yScale = EARTH_RADIUS * DEG;
  for (let index = 1; index < open.length; index++) {
    const distance = Math.hypot((open[index][0] - origin[0]) * xScale, (open[index][1] - origin[1]) * yScale);
    if (distance > maximumDistance) { maximumDistance = distance; farthest = index; }
  }
  const firstHalf = simplifyOpenPath(open.slice(0, farthest + 1), toleranceMeters, origin[1]);
  const secondHalf = simplifyOpenPath(open.slice(farthest).concat([open[0]]), toleranceMeters, origin[1]);
  const simplified = firstHalf.concat(secondHalf.slice(1));
  if (simplified.length < 4) return ring.slice();
  if (coordinateKey(simplified[0]) !== coordinateKey(simplified[simplified.length - 1])) simplified.push(simplified[0].slice());
  return simplified;
}

function platformShapeSamples(feature, maxSamples = 24) {
  const geometry = feature?.geometry;
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  const samples = [];
  for (const polygon of polygons) {
    const ring = polygon?.[0] || [];
    const openRing = ring.length > 1 && coordinateKey(ring[0]) === coordinateKey(ring[ring.length - 1])
      ? ring.slice(0, -1) : ring;
    if (!openRing.length) continue;
    const step = Math.max(1, Math.ceil(openRing.length / maxSamples));
    for (let i = 0; i < openRing.length; i += step) samples.push(openRing[i].slice(0, 2));
  }
  return samples;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const crosses = (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / ((b[1] - a[1]) || Number.EPSILON) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function geometryContainsPoint(geometry, point) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some(rings => {
    if (!rings?.length || !pointInRing(point, rings[0])) return false;
    return !rings.slice(1).some(ring => pointInRing(point, ring));
  });
}

function unitVector(a, b) {
  const latitude = (Number(a[1]) + Number(b[1])) * 0.5 * DEG;
  const dx = (Number(b[0]) - Number(a[0])) * Math.cos(latitude);
  const dy = Number(b[1]) - Number(a[1]);
  const length = Math.hypot(dx, dy) || 1;
  return [dx / length, dy / length];
}

function midpointAndTangent(coordinates) {
  if (coordinates.length < 2) return null;
  const lengths = [];
  let total = 0;
  for (let index = 1; index < coordinates.length; index++) {
    const length = haversine(coordinates[index - 1], coordinates[index]);
    lengths.push(length);
    total += length;
  }
  let remaining = total / 2;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index];
    if (remaining <= length || index === lengths.length - 1) {
      const a = coordinates[index], b = coordinates[index + 1];
      const fraction = length ? remaining / length : 0;
      return {
        point: [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction],
        tangent: unitVector(a, b)
      };
    }
    remaining -= length;
  }
  return null;
}

function directionForTrackPart(line, coordinates) {
  const midpoint = midpointAndTangent(coordinates);
  if (!midpoint) return null;
  let best = null;
  for (const direction of line.directions) {
    const stops = direction.stations;
    for (let index = 1; index < stops.length; index++) {
      const a = network.stations.features.find(feature => feature.properties.code === stops[index - 1].code)?.geometry.coordinates;
      const b = network.stations.features.find(feature => feature.properties.code === stops[index].code)?.geometry.coordinates;
      if (!a || !b) continue;
      const projected = project(midpoint.point, a, b);
      const expected = unitVector(a, b);
      const alignment = midpoint.tangent[0] * expected[0] + midpoint.tangent[1] * expected[1];
      // OSM rail ways preserve their along-track node order. Use the nearest
      // stop pair and that order to distinguish the two directional tracks.
      const score = projected.distance + (1 - alignment) * 500;
      if (!best || score < best.score) best = { code: direction.code, score, distance: projected.distance };
    }
  }
  return best && best.distance <= 1200 ? best.code : null;
}

function directionCodeForUnit(line, points) {
  const matches = new Set();
  for (const point of points) {
    const amenity = point.properties?.amenity_name_en || point.properties?.amenity_name_zh || '';
    if (!lineMatches(line.code, amenity)) continue;
    const normalizedAmenity = normalize(amenity);
    for (const direction of line.directions) {
      const terminal = direction.stations.at(-1);
      if (!terminal) continue;
      if ([terminal.en && 'to' + normalize(terminal.en), terminal.zh && '往' + normalize(terminal.zh)]
        .some(destination => destination && normalizedAmenity.includes(destination))) {
        matches.add(direction.code);
      }
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}

const stationByName = new Map(network.stations.features.map(feature => [normalize(feature.properties.en), feature]));
const lineCodesByStation = new Map();
const lineByCode = new Map(network.lines.map(line => [line.code, line]));
for (const line of network.lines) {
  for (const direction of line.directions) for (const stop of direction.stations) {
    if (!lineCodesByStation.has(stop.code)) lineCodesByStation.set(stop.code, new Set());
    lineCodesByStation.get(stop.code).add(line.code);
  }
}

const platformPointsByUnit = new Map();
for (const feature of amenities.features) {
  const properties = feature.properties || {};
  if (!/platform/i.test(properties.amenity_name_en || '') && !/月台/.test(properties.amenity_name_zh || '')) continue;
  if (!platformPointsByUnit.has(properties.unit_id)) platformPointsByUnit.set(properties.unit_id, []);
  platformPointsByUnit.get(properties.unit_id).push(feature);
}

const polygonByUnit = new Map();
for (const feature of platformPolygons.features) {
  const id = feature.properties?.unit_id;
  if (id) polygonByUnit.set(id, feature);
}

function unitStationName(unit) {
  const polygon = unit.polygon;
  const point = unit.points[0];
  return normalize(polygon?.properties?.building_name_en || point?.properties?.building_name_en);
}

const unitRecords = [];
const allUnitIds = new Set([...polygonByUnit.keys(), ...platformPointsByUnit.keys()]);
for (const unitId of allUnitIds) {
  const polygon = polygonByUnit.get(unitId) || null;
  const points = platformPointsByUnit.get(unitId) || [];
  const properties = polygon?.properties || points[0]?.properties || {};
  const stationKey = unitStationName({ polygon, points });
  const station = stationByName.get(stationKey);
  if (!station) continue;
  const stationCodes = [...(lineCodesByStation.get(station.properties.code) || [])];
  const texts = [
    properties.unit_name_en, properties.unit_name_zh,
    properties.level_name_en, properties.level_name_zh,
    ...points.flatMap(point => [point.properties?.amenity_name_en, point.properties?.amenity_name_zh,
      point.properties?.level_name_en, point.properties?.level_name_zh])
  ].filter(Boolean).join(' ');
  let lineCodes = stationCodes.filter(code => lineMatches(code, texts));
  let assignment = 'platform name';
  if (!lineCodes.length && stationCodes.length === 1) {
    lineCodes = stationCodes;
    assignment = 'single-line station';
  }
  if (!lineCodes.length && stationCodes.length > 1) {
    const stationUnits = [...allUnitIds].filter(id => {
      const testPolygon = polygonByUnit.get(id);
      const testPoints = platformPointsByUnit.get(id) || [];
      const p = testPolygon?.properties || testPoints[0]?.properties || {};
      return normalize(p.building_name_en) === stationKey;
    }).map(id => {
      const p = polygonByUnit.get(id)?.properties || platformPointsByUnit.get(id)?.[0]?.properties || {};
      return Number(p.level_z_value);
    }).filter(Number.isFinite);
    if (stationUnits.length && new Set(stationUnits.map(value => value.toFixed(1))).size === 1) {
      lineCodes = stationCodes;
      assignment = 'shared-height interchange';
    }
  }
  if (!lineCodes.length) continue;
  const zValues = [properties.level_z_value, ...points.map(point => point.properties?.level_z_value)]
    .map(Number).filter(Number.isFinite);
  if (!zValues.length) continue;
  const z = zValues.sort((a, b) => a - b)[Math.floor(zValues.length / 2)];
  const pointCoordinates = points.map(point => point.geometry?.coordinates).filter(coordinate => coordinate?.length >= 2);
  const centroid = polygonCentroid(polygon);
  const anchorCoordinates = [...pointCoordinates, ...platformShapeSamples(polygon)];
  if (centroid) anchorCoordinates.push(centroid);
  if (!anchorCoordinates.length && station.geometry?.coordinates) anchorCoordinates.push(station.geometry.coordinates);
  const anchorProperties = polygon?.properties || points[0]?.properties || {};
  const levelOrdinal = Number(anchorProperties.level_ordinal);
  const outdoor = Number(anchorProperties.level_outdoor) === 1;
  const underground = !outdoor && (z < 0 || (Number.isFinite(levelOrdinal) && levelOrdinal < 0));
  const unit = {
    id: unitId, stationCode: station.properties.code, stationName: station.properties.en,
    stationKey, lineCodes, assignment, z, outdoor, underground,
    levelOrdinal: Number.isFinite(levelOrdinal) ? levelOrdinal : null,
    levelNameEn: anchorProperties.level_name_en || '',
    levelNameZh: anchorProperties.level_name_zh || '',
    directionCodes: Object.fromEntries(lineCodes.map(code => {
      const line = lineByCode.get(code);
      return [code, line ? directionCodeForUnit(line, points) : null];
    }).filter(([, directionCode]) => directionCode)),
    polygon, points, pointCoordinates, coordinates: anchorCoordinates
  };
  unitRecords.push(unit);
}

const anchorCandidates = new Map();
for (const unit of unitRecords) {
  for (const code of unit.lineCodes) {
    const key = code + ':' + unit.stationCode;
    if (!anchorCandidates.has(key)) anchorCandidates.set(key, []);
    anchorCandidates.get(key).push(unit);
  }
}

function stationProfile(line, stationCode, directionCode) {
  const candidates = anchorCandidates.get(line.code + ':' + stationCode) || [];
  if (!candidates.length) return null;
  const directionalCandidates = candidates.filter(item => item.directionCodes[line.code]);
  let selected = directionalCandidates.filter(item => item.directionCodes[line.code] === directionCode);
  if (!selected.length) {
    const levels = [...new Set(candidates.map(item => Number(item.z).toFixed(2)))];
    if (levels.length !== 1) return null;
    selected = candidates;
  }
  if (!selected.length) return null;
  const levels = [...new Set(selected.map(item => Number(item.z).toFixed(2)))];
  // Distinct surveyed levels at one station are separate platforms. If the
  // API did not identify which direction uses them, leave the station unset
  // and interpolate each direction independently instead of averaging them.
  if (levels.length !== 1) return null;
  const representative = selected[0];
  const z = representative.z;
  const outdoor = selected.every(item => item.outdoor);
  const underground = !outdoor && selected.every(item => item.underground);
  const levelOrdinal = representative.levelOrdinal;
  const coordinates = selected.flatMap(item => item.coordinates);
  return {
    z, direct: true, outdoor, underground, levelOrdinal,
    candidates: selected, coordinates,
    source: selected.some(item => item.assignment === 'platform name') ? 'CSDI direction-specific platform level' : 'CSDI platform level'
  };
}

function buildStationProfiles(line, direction) {
  const profiles = new Map();
  for (const stop of direction.stations) profiles.set(stop.code, stationProfile(line, stop.code, direction.code));
  const proposals = new Map();
  const stops = direction.stations;
  const cumulative = [0];
  for (let i = 1; i < stops.length; i++) {
    const a = network.stations.features.find(feature => feature.properties.code === stops[i - 1].code)?.geometry.coordinates;
    const b = network.stations.features.find(feature => feature.properties.code === stops[i].code)?.geometry.coordinates;
    cumulative[i] = cumulative[i - 1] + (a && b ? haversine(a, b) : 1);
  }
  for (let i = 0; i < stops.length; i++) {
    if (profiles.get(stops[i].code)?.direct) continue;
    let previous = i - 1, next = i + 1;
    while (previous >= 0 && !profiles.get(stops[previous].code)?.direct) previous--;
    while (next < stops.length && !profiles.get(stops[next].code)?.direct) next++;
    let z = null, underground = false, outdoor = false;
    if (previous >= 0 && next < stops.length) {
      const left = profiles.get(stops[previous].code), right = profiles.get(stops[next].code);
      const fraction = (cumulative[i] - cumulative[previous]) / Math.max(1, cumulative[next] - cumulative[previous]);
      z = left.z + (right.z - left.z) * fraction;
      underground = left.underground && right.underground;
      outdoor = left.outdoor && right.outdoor;
    } else if (previous >= 0 || next < stops.length) {
      const known = profiles.get(stops[previous >= 0 ? previous : next].code);
      z = known.z;
      underground = known.underground;
      outdoor = known.outdoor;
    }
    if (Number.isFinite(z)) {
      const code = stops[i].code;
      proposals.set(code, { z, underground, outdoor });
    }
  }
  for (const [code, row] of proposals) {
    if (profiles.get(code)?.direct) continue;
    profiles.set(code, {
      z: row.z, direct: false,
      underground: row.underground,
      outdoor: row.outdoor,
      levelOrdinal: null, candidates: [], coordinates: [], source: 'Interpolated along this route direction between known station platforms'
    });
  }
  return profiles;
}

function buildLine(line) {
  const routeFeatures = network.routes.features.filter(feature => feature.properties.code === line.code);
  const nodes = new Map(), edges = new Map(), edgeRefs = [], parts = [];
  const ensureNode = (id, coordinate, anchor = null) => {
    if (!nodes.has(id)) nodes.set(id, { id, coordinate: coordinate.slice(0, 2), adj: [], anchor, geometryDirections: new Set() });
    else if (anchor) nodes.get(id).anchor = anchor;
    return nodes.get(id);
  };
  const adjacencyKey = (a, b) => a < b ? a + '|' + b : b + '|' + a;
  for (const feature of routeFeatures) {
    for (let partIndex = 0; partIndex < feature.geometry.coordinates.length; partIndex++) {
      const coordinates = feature.geometry.coordinates[partIndex];
      const directionCode = directionForTrackPart(line, coordinates);
      const part = { feature, partIndex, coordinates, directionCode, edgeRefs: [], inserts: new Map() };
      parts.push(part);
      for (let segmentIndex = 1; segmentIndex < coordinates.length; segmentIndex++) {
        const a = coordinates[segmentIndex - 1], b = coordinates[segmentIndex];
        const aKey = coordinateKey(a), bKey = coordinateKey(b);
        if (aKey === bKey) continue;
        ensureNode(aKey, a); ensureNode(bKey, b);
        if (part.directionCode) {
          nodes.get(aKey).geometryDirections.add(part.directionCode);
          nodes.get(bKey).geometryDirections.add(part.directionCode);
        }
        const key = adjacencyKey(aKey, bKey), length = haversine(a, b);
        let edge = edges.get(key);
        if (!edge) {
          edge = { a: aKey, b: bKey, length, branch: !!feature.properties.branch, refs: [] };
          edges.set(key, edge);
          nodes.get(aKey).adj.push({ to: bKey, length });
          nodes.get(bKey).adj.push({ to: aKey, length });
        } else {
          edge.branch = edge.branch && !!feature.properties.branch;
        }
        const ref = { a, b, aKey, bKey, length, edge, part, segmentIndex };
        edge.refs.push(ref);
        part.edgeRefs.push(ref);
        edgeRefs.push(ref);
      }
    }
  }

  let geometryComponentCount = 0;
  for (const node of nodes.values()) {
    if (node.geometryComponent !== undefined) continue;
    const componentId = geometryComponentCount++, stack = [node.id];
    node.geometryComponent = componentId;
    while (stack.length) {
      const id = stack.pop();
      for (const edge of nodes.get(id).adj) {
        const neighbor = nodes.get(edge.to);
        if (neighbor.geometryComponent === undefined) {
          neighbor.geometryComponent = componentId;
          stack.push(neighbor.id);
        }
      }
    }
  }

  const stationProfilesByDirection = new Map(line.directions.map(direction => [direction.code, buildStationProfiles(line, direction)]));
  const nearestEdgeFor = (coordinate, componentId = null, directionCode = null) => {
    let best = null;
    for (const ref of edgeRefs) {
      if (componentId !== null && nodes.get(ref.aKey).geometryComponent !== componentId) continue;
      if (directionCode && ref.part.directionCode && ref.part.directionCode !== directionCode) continue;
      const projected = project(coordinate, ref.a, ref.b);
      if (!best || projected.distance < best.distance) best = { ...projected, ref };
    }
    return best;
  };
  const anchors = [];
  const neutralPlatformAnchored = new Set();
  const MAX_PLATFORM_TRACK_DISTANCE_M = 18;
  for (const direction of line.directions) {
    const stationProfiles = stationProfilesByDirection.get(direction.code);
    for (const stop of direction.stations) {
    const stationCode = stop.code;
    const profile = stationProfiles.get(stationCode);
    const stationFeature = network.stations.features.find(feature => feature.properties.code === stationCode);
    if (!stationFeature) continue;
    const stationUnits = (anchorCandidates.get(line.code + ':' + stationCode) || [])
      .filter(unit => unit.lineCodes.includes(line.code));
    const hasDirectionalPlatformData = stationUnits.some(unit => unit.directionCodes[line.code]);
    const distinctPlatformLevels = new Set(stationUnits.map(unit => Number(unit.z).toFixed(2)));
    const directionUnits = stationUnits.filter(unit => unit.directionCodes[line.code] === direction.code);
    const platformUnits = hasDirectionalPlatformData
      ? directionUnits.length ? directionUnits : distinctPlatformLevels.size === 1 ? stationUnits : []
      : distinctPlatformLevels.size === 1 ? stationUnits : [];
    if (!hasDirectionalPlatformData && platformUnits.length) {
      const neutralKey = line.code + ':' + stationCode;
      if (neutralPlatformAnchored.has(neutralKey)) continue;
      neutralPlatformAnchored.add(neutralKey);
    }
    if ((!profile || !Number.isFinite(profile.z)) && !platformUnits.length) continue;
    for (let componentId = 0; componentId < geometryComponentCount; componentId++) {
      const pinnedNodesByUnit = new Map();
      if (platformUnits.length) {
        for (const node of nodes.values()) {
          if (node.geometryComponent !== componentId || node.anchor) continue;
          const directionCode = platformUnits.find(unit => unit.directionCodes[line.code])?.directionCodes[line.code];
          if (directionCode && node.geometryDirections.size > 1) continue;
          if (directionCode && node.geometryDirections.size && !node.geometryDirections.has(directionCode)) continue;
          const containing = platformUnits.filter(unit => unit.polygon && geometryContainsPoint(unit.polygon.geometry, node.coordinate));
          if (!containing.length) continue;
          const unitDistance = unit => {
            const references = unit.pointCoordinates.length ? unit.pointCoordinates : [polygonCentroid(unit.polygon) || stationFeature.geometry.coordinates];
            return Math.min(...references.map(reference => haversine(node.coordinate, reference)));
          };
          const unit = containing.reduce((best, candidate) => unitDistance(candidate) < unitDistance(best) ? candidate : best);
          // CSDI unit and its destination label identify the surveyed platform
          // level for this rail direction, even where two platforms overlap in 2D.
          const anchorProfile = { z: unit.z, direct: true, underground: unit.underground, outdoor: unit.outdoor, stationCode, unitId: unit.id, directionCode: unit.directionCodes[line.code] || direction.code };
          node.anchor = anchorProfile;
          node.elevation = unit.z;
          if (!pinnedNodesByUnit.has(unit.id)) pinnedNodesByUnit.set(unit.id, []);
          pinnedNodesByUnit.get(unit.id).push(node);
        }
      }
      const projections = new Map();
      if (platformUnits.length) {
        for (const unit of platformUnits) {
          for (const candidate of unit.coordinates) {
            for (const ref of edgeRefs) {
              if (nodes.get(ref.aKey).geometryComponent !== componentId) continue;
              if (unit.directionCodes[line.code] && ref.part.directionCode && ref.part.directionCode !== unit.directionCodes[line.code]) continue;
              const test = project(candidate, ref.a, ref.b);
              if (test.distance > MAX_PLATFORM_TRACK_DISTANCE_M) continue;
              const canonicalT = ref.aKey === ref.edge.a ? test.t : 1 - test.t;
              const key = adjacencyKey(ref.edge.a, ref.edge.b) + ':' + canonicalT.toFixed(3);
              const previous = projections.get(key);
              if (!previous || test.distance < previous.distance) projections.set(key, { ...test, ref, unit });
            }
          }
        }
      }
      const registerAnchor = (id, anchorProfile) => {
        const key = [stationCode, componentId, anchorProfile.unitId || anchorProfile.directionCode || 'route'].join(':');
        if (anchors.some(anchor => anchor._key === key)) return;
        anchors.push({ id, stationCode, z: anchorProfile.z, direct: anchorProfile.direct,
          underground: anchorProfile.underground, outdoor: anchorProfile.outdoor, directionCode: anchorProfile.directionCode,
          unitId: anchorProfile.unitId, _key: key });
      };

      for (const unit of platformUnits) {
        const pinnedNodes = pinnedNodesByUnit.get(unit.id) || [];
        if (pinnedNodes.length) {
          const representative = pinnedNodes.reduce((best, node) =>
            haversine(node.coordinate, stationFeature.geometry.coordinates) < haversine(best.coordinate, stationFeature.geometry.coordinates) ? node : best);
          registerAnchor(representative.id, representative.anchor);
        }
      }

      if (!platformUnits.length && !projections.size) {
        const fallback = nearestEdgeFor(stationFeature.geometry.coordinates, componentId, direction.code);
        if (fallback && fallback.distance <= MAX_ANCHOR_DISTANCE_M) {
          projections.set('estimated:' + componentId, { ...fallback, profile });
        }
      } else if (platformUnits.length && !projections.size && !pinnedNodesByUnit.size) {
        let fallback = null;
        for (const unit of platformUnits) for (const candidate of unit.coordinates) {
          const test = nearestEdgeFor(candidate, componentId, unit.directionCodes[line.code] || direction.code);
          if (test && test.distance <= MAX_ANCHOR_DISTANCE_M && (!fallback || test.distance < fallback.distance)) {
            fallback = { ...test, unit };
          }
        }
        if (fallback) projections.set('fallback:' + componentId, fallback);
      }

      let projectionIndex = 0;
      for (const projection of projections.values()) {
        const id = '@platform:' + stationCode + ':' + componentId + ':' + direction.code + ':' + projectionIndex++;
        const anchorProfile = projection.unit
          ? { z: projection.unit.z, direct: true, underground: projection.unit.underground, outdoor: projection.unit.outdoor, stationCode, unitId: projection.unit.id, directionCode: projection.unit.directionCodes[line.code] || direction.code }
          : { ...projection.profile, stationCode, directionCode: direction.code };
        const anchorNode = ensureNode(id, projection.coordinate, anchorProfile);
        anchorNode.elevation = anchorProfile.z;
        const ref = projection.ref;
        const links = [[ref.aKey, projection.t * ref.length], [ref.bKey, (1 - projection.t) * ref.length]];
        for (const [nodeKey, length] of links) {
          nodes.get(id).adj.push({ to: nodeKey, length });
          nodes.get(nodeKey).adj.push({ to: id, length });
        }
        for (const duplicateRef of ref.edge.refs) {
          if (anchorProfile.directionCode && duplicateRef.part.directionCode && duplicateRef.part.directionCode !== anchorProfile.directionCode) continue;
          if (!duplicateRef.part.inserts.has(duplicateRef.segmentIndex)) duplicateRef.part.inserts.set(duplicateRef.segmentIndex, []);
          const duplicateT = duplicateRef.aKey === ref.aKey ? projection.t : 1 - projection.t;
          duplicateRef.part.inserts.get(duplicateRef.segmentIndex).push({ t: duplicateT, id, coordinate: projection.coordinate });
        }
        registerAnchor(id, anchorProfile);
      }
    }
    }
  }

  const components = [];
  for (const node of nodes.values()) {
    if (node.component !== undefined) continue;
    const componentId = components.length, stack = [node.id], componentNodes = [];
    node.component = componentId;
    while (stack.length) {
      const id = stack.pop(), current = nodes.get(id);
      componentNodes.push(current);
      for (const edge of current.adj) {
        const neighbor = nodes.get(edge.to);
        if (neighbor.component === undefined) { neighbor.component = componentId; stack.push(neighbor.id); }
      }
    }
    components.push(componentNodes);
  }

  const anchoredComponents = new Set(anchors.map(anchor => nodes.get(anchor.id).component));
  for (const component of components) {
    const componentAnchors = anchors.filter(anchor => nodes.get(anchor.id).component === nodes.get(component[0].id).component);
    if (!componentAnchors.length) {
      const nearestAnchor = anchors.reduce((best, anchor) => {
        const distance = haversine(component[0].coordinate, nodes.get(anchor.id).coordinate);
        return !best || distance < best.distance ? { anchor, distance } : best;
      }, null);
      const fallbackZ = nearestAnchor?.anchor.z ?? 0;
      for (const node of component) node.elevation = fallbackZ;
      continue;
    }
    const initial = componentAnchors[0]?.z ?? 0;
    for (const node of component) if (!node.anchor) node.elevation = initial;
    for (let iteration = 0; iteration < 1600; iteration++) {
      let maxChange = 0;
      for (const node of component) {
        if (node.anchor || !node.adj.length) continue;
        let weighted = 0, weights = 0;
        for (const edge of node.adj) {
          const neighbor = nodes.get(edge.to);
          if (!Number.isFinite(neighbor.elevation)) continue;
          const weight = 1 / Math.max(1, edge.length);
          weighted += neighbor.elevation * weight; weights += weight;
        }
        if (!weights) continue;
        const next = weighted / weights;
        maxChange = Math.max(maxChange, Math.abs(next - (node.elevation ?? initial)));
        node.elevation = next;
      }
      if (maxChange < 0.001) break;
    }
  }
  for (const anchor of anchors) nodes.get(anchor.id).elevation = anchor.z;

  const features = [];
  for (const part of parts) {
    if (part.coordinates.length < 2) continue;
    const coordinates = [];
    const append = (coordinate, z, priority = 0) => {
      const previous = coordinates[coordinates.length - 1];
      const item = [Number(coordinate[0]), Number(coordinate[1]), Number.isFinite(z) ? z : 0];
      if (previous && coordinateKey(previous) === coordinateKey(item)) {
        if (priority > (previous._priority || 0)) previous[2] = item[2];
        previous._priority = Math.max(previous._priority || 0, priority);
      } else {
        item._priority = priority;
        coordinates.push(item);
      }
    };
    const first = part.coordinates[0], firstNode = nodes.get(coordinateKey(first));
    append(first, firstNode?.elevation);
    for (const ref of part.edgeRefs) {
      for (const inserted of (part.inserts.get(ref.segmentIndex) || []).sort((a, b) => a.t - b.t)) {
        append(inserted.coordinate, nodes.get(inserted.id)?.elevation, 1);
      }
      const endNode = nodes.get(ref.bKey);
      append(ref.b, endNode?.elevation);
    }
    if (coordinates.length < 2) continue;
    features.push({
      type: 'Feature',
      properties: {
        ...part.feature.properties, kind: 'railway',
        directionCode: part.directionCode || undefined,
        directionTerminal: line.directions.find(direction => direction.code === part.directionCode)?.stations.at(-1)?.en || undefined,
        source: 'OpenStreetMap route geometry + Lands Department CSDI platform levels',
        profile: 'smoothed estimate between platform anchors',
        directPlatformAnchors: anchors.filter(anchor => anchor.direct).length,
        estimatedStationAnchors: anchors.filter(anchor => !anchor.direct).length
      },
        geometry: { type: 'LineString', coordinates: limitVerticalGrade(coordinates.map(coordinate => coordinate.slice(0, 3))) }
    });
  }

  const directStationCount = new Set(anchors.filter(anchor => anchor.direct).map(anchor => anchor.stationCode)).size;
  return { features, anchors, directStationCount, stationProfiles: stationProfilesByDirection, graphNodeCount: nodes.size, graphEdgeCount: edges.size, anchoredComponents };
}

const outputs = [];
const report = {};
for (const line of network.lines) {
  const built = buildLine(line);
  outputs.push(...built.features);
  report[line.code] = {
    stationAnchors: built.anchors.length,
    directPlatformHeights: built.directStationCount,
    estimatedStationHeights: built.anchors.filter(anchor => !anchor.direct).length,
    trackFeatures: built.features.length,
    graphNodes: built.graphNodeCount,
    graphEdges: built.graphEdgeCount,
    anchoredComponents: built.anchoredComponents.size
  };
}

const unitById = new Map(unitRecords.map(unit => [unit.id, unit]));
for (const polygon of platformPolygons.features) {
  const unit = unitById.get(polygon.properties?.unit_id);
  if (!unit || !polygon.geometry?.coordinates?.length) continue;
  for (const sourceRing of polygon.geometry.coordinates) {
    const ring = simplifyRing(sourceRing);
    if (ring.length < 2) continue;
    // Use the unit's single surveyed platform elevation for every vertex. This
    // avoids tiny per-vertex Z differences creating a visibly warped outline.
    const coordinates = ring.map(coordinate => [Number(coordinate[0]), Number(coordinate[1]), unit.z]);
    if (coordinateKey(coordinates[0]) !== coordinateKey(coordinates[coordinates.length - 1])) coordinates.push(coordinates[0].slice());
    outputs.push({
      type: 'Feature',
      properties: {
        code: unit.lineCodes[0], lineCodes: unit.lineCodes, kind: 'platform',
        unitId: unit.id, station: unit.stationName,
        levelZ: unit.z, levelNameEn: unit.levelNameEn, levelNameZh: unit.levelNameZh,
        outdoor: unit.outdoor, source: 'Lands Department CSDI indoor MTR platform polygon'
      },
      geometry: { type: 'LineString', coordinates }
    });
  }
}

const result = {
  type: 'FeatureCollection',
  metadata: {
    generatedAt: new Date().toISOString(),
    sourceTrackGeometry: 'assets/mtr-network.json; OSM-derived MTR track geometry',
    platformElevationApi: 'https://mapapi.hkmapservice.gov.hk/ogc/wfs/indoor/mtr_amenity_point',
    platformShapeApi: 'https://mapapi.hkmapservice.gov.hk/ogc/wfs/indoor/mtr_unit_polygon',
    apiDocumentation: 'https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-indoor-mtr-station-map',
    verticalCoordinate: 'Uses level_z_value as returned by WFS (meters); vertical datum is not identified in the feature response.',
    estimatedProfile: 'CSDI platform elevations are assigned to route directions when platform amenity names identify their destination. Distinct platform levels without a direction match are left unassigned rather than averaged. Track heights between directional station anchors use length-weighted harmonic interpolation; no artificial tunnel sag is applied. This remains an estimated rail profile, not surveyed track alignment data.',
    report
  },
  features: outputs
};
fs.writeFileSync(outputPath, JSON.stringify(result));
console.log(JSON.stringify({ outputPath: path.relative(root, outputPath), features: outputs.length, report }, null, 2));
