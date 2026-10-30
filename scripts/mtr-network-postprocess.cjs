'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RACECOURSE = {
  code: 'RAC', id: '70', zh: '馬場', en: 'Racecourse',
  coordinates: [114.202847, 22.4004961]
};
const DIRECTIONAL_CROP_LINES = new Set(['ISL', 'TWL', 'TKL']);
const TERMINAL_CROP_RADIUS_METERS = 1200;
const TERMINAL_CROP_CORRIDOR_METERS = 250;
const MAX_UNATTACHED_TKL_COMPONENT_METERS = 350;
const MIN_UNATTACHED_TKL_STATION_DISTANCE_METERS = 350;

function metersBetween(a, b) {
  const xScale = 102000 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const dx = (a[0] - b[0]) * xScale;
  const dy = (a[1] - b[1]) * 111000;
  return Math.hypot(dx, dy);
}

function nearestPointOnLine(point, coordinates) {
  let best = null;
  for (let index = 0; index < coordinates.length - 1; index++) {
    const a = coordinates[index], b = coordinates[index + 1];
    const xScale = 102000 * Math.cos(point[1] * Math.PI / 180);
    const ax = a[0] * xScale, ay = a[1] * 111000;
    const bx = b[0] * xScale, by = b[1] * 111000;
    const px = point[0] * xScale, py = point[1] * 111000;
    const vx = bx - ax, vy = by - ay;
    const lengthSquared = vx * vx + vy * vy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lengthSquared)) : 0;
    const projected = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const distance = metersBetween(point, projected);
    if (!best || distance < best.distance) best = { index, t, point: projected, distance };
  }
  return best;
}

function sideToKeep(coordinates, hit, neighborPoints, stationPoint) {
  const before = coordinates.slice(0, hit.index + 1).concat([[...stationPoint]]);
  const after = [[...stationPoint]].concat(coordinates.slice(hit.index + 1));
  const scoreFarEnd = farEnd => Math.min(...neighborPoints.map(point => metersBetween(farEnd, point)));
  const kept = scoreFarEnd(before[0]) <= scoreFarEnd(after.at(-1)) ? before : after;
  return kept.length >= 2 ? kept : (before.length >= 2 ? before : after);
}

function clipPolylineAtTerminal(coordinates, terminalPoint, outwardUnit) {
  if (coordinates.length < 2) return [coordinates];
  const localPoint = point => {
    const xScale = 102000 * Math.cos(terminalPoint[1] * Math.PI / 180);
    return [(point[0] - terminalPoint[0]) * xScale, (point[1] - terminalPoint[1]) * 111000];
  };
  const signedDistance = point => {
    const local = localPoint(point);
    return local[0] * outwardUnit[0] + local[1] * outwardUnit[1];
  };
  const closest = nearestPointOnLine(terminalPoint, coordinates);
  if (!closest || closest.distance > TERMINAL_CROP_RADIUS_METERS) return [coordinates];
  const closestLocal = localPoint(closest.point);
  const crossTrack = Math.abs(closestLocal[0] * outwardUnit[1] - closestLocal[1] * outwardUnit[0]);
  if (crossTrack > TERMINAL_CROP_CORRIDOR_METERS) return [coordinates];

  const signed = coordinates.map(signedDistance);
  if (Math.max(...signed) <= 0) return [coordinates];
  if (Math.min(...signed) > 0) return [];

  const clipped = [];
  let current = [];
  const intersection = (a, b, aDistance, bDistance) => {
    const t = aDistance / (aDistance - bDistance);
    const point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return metersBetween(point, terminalPoint) <= TERMINAL_CROP_CORRIDOR_METERS
      ? [...terminalPoint]
      : point;
  };

  for (let index = 0; index < coordinates.length - 1; index++) {
    const a = coordinates[index], b = coordinates[index + 1];
    const aInside = signed[index] <= 0, bInside = signed[index + 1] <= 0;
    if (aInside && current.length === 0) current.push(a);
    if (aInside && bInside) current.push(b);
    else if (aInside && !bInside) {
      current.push(intersection(a, b, signed[index], signed[index + 1]));
      if (current.length >= 2) clipped.push(current);
      current = [];
    } else if (!aInside && bInside) {
      current = [intersection(a, b, signed[index], signed[index + 1]), b];
    }
  }
  if (current.length >= 2) clipped.push(current);
  return clipped;
}

function anchorStationOnGeometry(geometry, stationPoint) {
  const segments = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  let best = null;
  for (const [segmentIndex, coordinates] of segments.entries()) {
    const hit = nearestPointOnLine(stationPoint, coordinates);
    if (hit && (!best || hit.distance < best.hit.distance)) best = { segmentIndex, hit };
  }
  if (!best || best.hit.distance > 20) return;
  const coordinates = segments[best.segmentIndex];
  if (best.hit.t <= 1e-6) coordinates[best.hit.index] = [...stationPoint];
  else if (best.hit.t >= 1 - 1e-6) coordinates[best.hit.index + 1] = [...stationPoint];
  else coordinates.splice(best.hit.index + 1, 0, [...stationPoint]);
}

function removeSmallUnattachedTklComponents(line, stationFeatures) {
  const geometry = line.geometry;
  const segments = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  const parents = segments.map((_, index) => index);
  const find = index => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const union = (a, b) => { parents[find(a)] = find(b); };
  const endpointIndexes = new Map();
  for (const [index, coordinates] of segments.entries()) {
    for (const endpoint of [coordinates[0], coordinates.at(-1)]) {
      const key = pointKey(endpoint);
      if (endpointIndexes.has(key)) union(index, endpointIndexes.get(key));
      else endpointIndexes.set(key, index);
    }
  }

  const components = new Map();
  for (const [index, coordinates] of segments.entries()) {
    const root = find(index);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(coordinates);
  }
  const routeStations = stationFeatures.filter(feature => (feature.properties.lineCodes || []).includes(line.code));
  if (!routeStations.length) return;
  const removed = new Set();
  for (const component of components.values()) {
    const length = component.reduce((sum, coordinates) => sum + coordinates.slice(1).reduce((part, point, index) => part + metersBetween(coordinates[index], point), 0), 0);
    if (length > MAX_UNATTACHED_TKL_COMPONENT_METERS) continue;
    const nearestStation = Math.min(...component.flatMap(coordinates => coordinates.map(point =>
      Math.min(...routeStations.map(station => metersBetween(point, station.geometry.coordinates)))
    )));
    // Discard short, detached TKL track fragments that do not approach any TKL station.
    if (nearestStation > MIN_UNATTACHED_TKL_STATION_DISTANCE_METERS) {
      for (const coordinates of component) removed.add(coordinates);
    }
  }
  const kept = segments.filter(coordinates => !removed.has(coordinates));
  geometry.coordinates = geometry.type === 'LineString' ? (kept[0] || []) : kept;
}

function cropDirectionalTerminalExtensions(line, stationByCode) {
  const internalStops = new Set(line.directions.flatMap(direction => direction.stations.slice(1, -1).map(station => station.code)));
  const terminals = new Map();
  for (const direction of line.directions) {
    if (direction.stations.length < 2) continue;
    for (const [terminal, neighbor] of [[direction.stations[0], direction.stations[1]], [direction.stations.at(-1), direction.stations.at(-2)]]) {
      if (internalStops.has(terminal.code)) continue;
      const point = stationByCode.get(terminal.code), neighborPoint = stationByCode.get(neighbor.code);
      if (point && neighborPoint) terminals.set(terminal.code, { point, neighborPoint });
    }
  }

  const geometry = line.geometry;
  const sourceSegments = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  let segments = sourceSegments.slice();
  for (const { point, neighborPoint } of terminals.values()) {
    const xScale = 102000 * Math.cos(point[1] * Math.PI / 180);
    const dx = (point[0] - neighborPoint[0]) * xScale;
    const dy = (point[1] - neighborPoint[1]) * 111000;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const outwardUnit = [dx / length, dy / length];
    segments = segments.flatMap(coordinates => clipPolylineAtTerminal(coordinates, point, outwardUnit));
  }
  geometry.coordinates = geometry.type === 'LineString' ? (segments[0] || []) : segments;

  const directionEndpoints = new Set(line.directions.flatMap(direction => [direction.stations[0]?.code, direction.stations.at(-1)?.code]).filter(Boolean));
  for (const code of directionEndpoints) {
    const point = stationByCode.get(code);
    if (point) anchorStationOnGeometry(geometry, point);
  }
}

function addRacecourseStation(network) {
  const eastRail = network.lines.find(line => line.code === 'EAL');
  if (!eastRail) return;

  for (const direction of eastRail.directions) {
    if (direction.stations.some(station => station.code === RACECOURSE.code)) continue;
    const fotIndex = direction.stations.findIndex(station => station.code === 'FOT');
    const uniIndex = direction.stations.findIndex(station => station.code === 'UNI');
    if (fotIndex < 0 || uniIndex < 0 || Math.abs(fotIndex - uniIndex) !== 1) continue;
    const insertAt = Math.min(fotIndex, uniIndex) + 1;
    direction.stations.splice(insertAt, 0, {
      code: RACECOURSE.code, id: RACECOURSE.id, zh: RACECOURSE.zh, en: RACECOURSE.en,
      sequence: insertAt + 1
    });
    direction.stations.forEach((station, index) => { station.sequence = index + 1; });
  }

  const eastRailStation = network.stations.features.find(feature => feature.properties.code === RACECOURSE.code);
  const color = eastRail.color || network.routes.features.find(feature => feature.properties.code === 'EAL')?.properties.color || '#53b7e8';
  const feature = {
    type: 'Feature',
    properties: {
      code: RACECOURSE.code, id: RACECOURSE.id, zh: RACECOURSE.zh, en: RACECOURSE.en,
      lineCodes: ['EAL'], isTerminal: false, isInterchange: false, color
    },
    geometry: { type: 'Point', coordinates: [...RACECOURSE.coordinates] }
  };
  if (eastRailStation) Object.assign(eastRailStation, feature);
  else network.stations.features.push(feature);
}

function clipLineTerminals(network) {
  const stationByCode = new Map(network.stations.features.map(feature => [feature.properties.code, feature.geometry.coordinates]));
  for (const line of network.lines) {
    if (DIRECTIONAL_CROP_LINES.has(line.code)) {
      if (line.code === 'TKL') removeSmallUnattachedTklComponents(line, network.stations.features);
      cropDirectionalTerminalExtensions(line, stationByCode);
      for (const feature of network.routes.features.filter(candidate => candidate.properties.code === line.code && !candidate.properties.branch)) {
        feature.geometry = JSON.parse(JSON.stringify(line.geometry));
      }
      continue;
    }
    const neighborsByTerminal = new Map();
    for (const direction of line.directions) {
      const stops = direction.stations;
      if (stops.length < 2) continue;
      for (const [terminal, neighbor] of [[stops[0], stops[1]], [stops.at(-1), stops.at(-2)]]) {
        const terminalPoint = stationByCode.get(terminal.code), neighborPoint = stationByCode.get(neighbor.code);
        if (!terminalPoint || !neighborPoint) continue;
        if (!neighborsByTerminal.has(terminal.code)) neighborsByTerminal.set(terminal.code, { point: terminalPoint, neighbors: [] });
        const entry = neighborsByTerminal.get(terminal.code);
        if (!entry.neighbors.some(point => metersBetween(point, neighborPoint) < 1)) entry.neighbors.push(neighborPoint);
      }
    }

    const routeGeometries = network.routes.features.filter(feature => feature.properties.code === line.code).map(feature => feature.geometry);
    const targetGeometries = [...new Set([line.geometry, ...routeGeometries])];
    for (const { point, neighbors } of neighborsByTerminal.values()) {
      for (const geometry of targetGeometries) {
        const segments = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
        const candidates = segments.map((coordinates, index) => ({ index, hit: nearestPointOnLine(point, coordinates) }))
          .filter(candidate => candidate.hit)
          .sort((a, b) => a.hit.distance - b.hit.distance);
        if (!candidates.length || candidates[0].hit.distance > 60) continue;
        const minimum = candidates[0].hit.distance;
        for (const candidate of candidates) {
          if (candidate.hit.distance > Math.min(60, Math.max(22, minimum + 8))) break;
          const clipped = sideToKeep(segments[candidate.index], candidate.hit, neighbors, point);
          if (clipped.length >= 2) segments[candidate.index] = clipped;
        }
      }
    }
  }
}

function pointKey(point) {
  return point.map(value => Number(value).toFixed(7)).join(',');
}

function racecourseBranch(line, stations) {
  const fot = stations.get('FOT'), racecourse = stations.get(RACECOURSE.code);
  if (!fot || !racecourse) return null;
  const graph = new Map();
  function addNode(point) {
    const key = pointKey(point);
    if (!graph.has(key)) graph.set(key, { point, edges: [] });
    return key;
  }
  for (const [segmentIndex, coordinates] of line.geometry.coordinates.entries()) {
    if (coordinates.length < 2) continue;
    const start = addNode(coordinates[0]), end = addNode(coordinates.at(-1));
    if (start === end) continue;
    const distance = coordinates.slice(1).reduce((sum, point, index) => sum + metersBetween(coordinates[index], point), 0);
    graph.get(start).edges.push({ to: end, segmentIndex, reverse: false, distance });
    graph.get(end).edges.push({ to: start, segmentIndex, reverse: true, distance });
  }
  if (!graph.size) return null;
  const nearestNode = point => {
    let best = null;
    for (const [key, node] of graph) {
      const distance = metersBetween(point, node.point);
      if (!best || distance < best.distance) best = { key, distance };
    }
    return best;
  };
  const start = nearestNode(fot), finish = nearestNode(racecourse);
  if (!start || !finish || start.distance > 80 || finish.distance > 80) return null;

  const distances = new Map([[start.key, 0]]), previous = new Map(), queue = new Set(graph.keys());
  while (queue.size) {
    let current = null, currentDistance = Infinity;
    for (const key of queue) {
      const distance = distances.get(key) ?? Infinity;
      if (distance < currentDistance) { current = key; currentDistance = distance; }
    }
    if (!current || currentDistance === Infinity) break;
    queue.delete(current);
    if (current === finish.key) break;
    for (const edge of graph.get(current).edges) {
      const distance = currentDistance + edge.distance;
      if (distance < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, distance);
        previous.set(edge.to, { from: current, edge });
      }
    }
  }
  if (!previous.has(finish.key)) return null;

  const path = [];
  let current = finish.key;
  while (previous.has(current)) {
    const step = previous.get(current);
    path.push(step.edge);
    current = step.from;
  }
  path.reverse();
  const coordinates = [];
  for (const edge of path) {
    const segment = line.geometry.coordinates[edge.segmentIndex];
    const oriented = edge.reverse ? segment.slice().reverse() : segment;
    if (!coordinates.length) coordinates.push(...oriented);
    else if (metersBetween(coordinates.at(-1), oriented[0]) < 3) coordinates.push(...oriented.slice(1));
    else coordinates.push(...oriented);
  }
  if (coordinates.length < 2) return null;
  coordinates[0] = [...fot];
  coordinates[coordinates.length - 1] = [...racecourse];
  return { coordinates, segmentIndexes: new Set(path.map(edge => edge.segmentIndex)) };
}

function branchParallelIndexes(segments, branchCoordinates, ignoredIndexes = new Set()) {
  const indexes = new Set();
  for (const [index, coordinates] of segments.entries()) {
    if (ignoredIndexes.has(index) || coordinates.length < 2) continue;
    const length = coordinates.slice(1).reduce((sum, point, i) => sum + metersBetween(coordinates[i], point), 0);
    if (length < 2) continue;
    const samples = [];
    for (let i = 0; i < coordinates.length; i++) {
      samples.push(coordinates[i]);
      if (i + 1 < coordinates.length) samples.push([(coordinates[i][0] + coordinates[i + 1][0]) / 2, (coordinates[i][1] + coordinates[i + 1][1]) / 2]);
    }
    const closeCount = samples.filter(point => nearestPointOnLine(point, branchCoordinates).distance <= 25).length;
    if (closeCount / samples.length >= 0.72) indexes.add(index);
  }
  return indexes;
}

function splitEastRailBranch(network) {
  const line = network.lines.find(candidate => candidate.code === 'EAL');
  const mainFeature = network.routes.features.find(feature => feature.properties.code === 'EAL' && !feature.properties.branch);
  const existingBranch = network.routes.features.find(feature => feature.properties.code === 'EAL' && feature.properties.branch);
  if (!line || !mainFeature) return;

  if (existingBranch) {
    const branchLines = existingBranch.geometry.type === 'LineString' ? [existingBranch.geometry.coordinates] : existingBranch.geometry.coordinates;
    const pathCoordinates = branchLines[0];
    const mainSegments = mainFeature.geometry.type === 'LineString' ? [mainFeature.geometry.coordinates] : mainFeature.geometry.coordinates;
    const parallelIndexes = branchParallelIndexes(mainSegments, pathCoordinates);
    if (parallelIndexes.size) {
      const parallel = mainSegments.filter((_, index) => parallelIndexes.has(index));
      mainFeature.geometry = { type: 'MultiLineString', coordinates: mainSegments.filter((_, index) => !parallelIndexes.has(index)) };
      existingBranch.geometry = { type: 'MultiLineString', coordinates: branchLines.concat(parallel) };
    }
    return;
  }

  const stations = new Map(network.stations.features.map(feature => [feature.properties.code, feature.geometry.coordinates]));
  const branch = racecourseBranch(line, stations);
  if (!branch) return;
  const allSegments = line.geometry.coordinates;
  const parallelIndexes = branchParallelIndexes(allSegments, branch.coordinates, branch.segmentIndexes);
  const branchIndexes = new Set([...branch.segmentIndexes, ...parallelIndexes]);
  const mainSegments = allSegments.filter((_, index) => !branchIndexes.has(index));
  mainFeature.geometry = { type: 'MultiLineString', coordinates: mainSegments };
  const branchSegments = [branch.coordinates, ...allSegments.filter((_, index) => parallelIndexes.has(index))];
  const branchFeature = {
    type: 'Feature',
    properties: { ...mainFeature.properties, branch: true, branchName: 'FOT-RAC' },
    geometry: { type: 'MultiLineString', coordinates: branchSegments }
  };
  network.routes.features.push(branchFeature);
}

function postprocessMtrNetwork(network) {
  addRacecourseStation(network);
  clipLineTerminals(network);
  splitEastRailBranch(network);
  network.importReport.supplementalStations = ['EAL:RAC'];
  return network;
}

module.exports = { postprocessMtrNetwork };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const filename = path.join(root, 'assets', 'mtr-network.json');
  const network = JSON.parse(fs.readFileSync(filename, 'utf8'));
  fs.writeFileSync(filename, JSON.stringify(postprocessMtrNetwork(network)), 'utf8');
  console.log('Updated MTR viewer data with terminal clipping and the Racecourse branch.');
}
