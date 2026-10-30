#!/usr/bin/env node
// Import well-matched OpenStreetMap ferry geometry into the app's compact
// polyline override asset. Run with --write to regenerate the asset.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const osm = JSON.parse(fs.readFileSync(path.join(root, 'data/osm-ferry-overpass.json'), 'utf8'));

function readArray(name) {
  const marker = `${name}=`;
  const markerAt = html.indexOf(marker);
  if (markerAt < 0) throw new Error(`Could not find ${name} in index.html`);
  let start = markerAt + marker.length;
  while (/\s/.test(html[start])) start++;
  const open = html[start];
  const close = open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) throw new Error(`Unexpected ${name} value`);
  let depth = 0;
  let inString = false;
  let escaped = false;
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

const packed = readArray('const packed');
const stopPatterns = readArray('stopPatternPacked');
const stopRows = readArray('stopPacked');
const stopById = new Map(stopRows.map(stop => [String(stop[0]), stop]));
const patternsByRoute = new Map(stopPatterns.map(route => [String(route.i), route]));
const nodes = new Map(osm.elements.filter(el => el.type === 'node').map(el => [el.id, el]));
const ways = new Map(osm.elements.filter(el => el.type === 'way').map(el => [el.id, el]));

function chainWays(members) {
  const groups = new Map();
  for (const member of members) {
    if (member.type !== 'way' || !ways.has(member.ref)) continue;
    const role = member.role || '';
    if (!groups.has(role)) groups.set(role, []);
    groups.get(role).push(ways.get(member.ref));
  }
  const chains = [];
  for (const group of groups.values()) {
    const endpointUse = new Map();
    for (const way of group) {
      for (const id of new Set([way.nodes[0], way.nodes.at(-1)])) endpointUse.set(id, (endpointUse.get(id) || 0) + 1);
    }
    const unused = new Set(group);
    while (unused.size) {
      const seed = [...unused].find(way => endpointUse.get(way.nodes[0]) === 1 || endpointUse.get(way.nodes.at(-1)) === 1) || [...unused][0];
      const startsAt = endpointUse.get(seed.nodes[0]) === 1 ? seed.nodes[0] : endpointUse.get(seed.nodes.at(-1)) === 1 ? seed.nodes.at(-1) : seed.nodes[0];
      let ids = startsAt === seed.nodes[0] ? [...seed.nodes] : [...seed.nodes].reverse();
      unused.delete(seed);
      while (unused.size) {
        const tail = ids.at(-1);
        const next = [...unused].find(way => way.nodes[0] === tail || way.nodes.at(-1) === tail);
        if (!next) break;
        const part = next.nodes[0] === tail ? next.nodes : [...next.nodes].reverse();
        ids.push(...part.slice(1));
        unused.delete(next);
      }
      const coordinates = ids.map(id => nodes.get(id)).filter(Boolean).map(node => [node.lon, node.lat]);
      const compact = coordinates.filter((coordinate, index) => index === 0 || coordinate[0] !== coordinates[index - 1][0] || coordinate[1] !== coordinates[index - 1][1]);
      if (compact.length >= 4) chains.push(compact);
    }
  }
  return chains;
}

function haversine(a, b) {
  const rad = Math.PI / 180;
  const lat1 = a[1] * rad, lat2 = b[1] * rad;
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function pointLineDistance(point, line) {
  const latScale = Math.PI / 180 * 6371000;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const lat0 = point[1] * Math.PI / 180;
    const scaleX = latScale * Math.cos(lat0);
    const ax = (line[i - 1][0] - point[0]) * scaleX;
    const ay = (line[i - 1][1] - point[1]) * latScale;
    const bx = (line[i][0] - point[0]) * scaleX;
    const by = (line[i][1] - point[1]) * latScale;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

function projectOntoLine(point, line) {
  const latScale = Math.PI / 180 * 6371000;
  const lat0 = point[1] * Math.PI / 180;
  const scaleX = latScale * Math.cos(lat0);
  let travelled = 0;
  let best = null;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - point[0]) * scaleX;
    const ay = (line[i - 1][1] - point[1]) * latScale;
    const bx = (line[i][0] - point[0]) * scaleX;
    const by = (line[i][1] - point[1]) * latScale;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const segmentLength = haversine(line[i - 1], line[i]);
    const distance = Math.hypot(ax + t * dx, ay + t * dy);
    if (!best || distance < best.distance) {
      best = {
        distance,
        along: travelled + segmentLength * t,
        coordinate: [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]
      };
    }
    travelled += segmentLength;
  }
  return best;
}

function sliceLine(line, startProjection, endProjection) {
  if (endProjection.along <= startProjection.along + 30) return null;
  const coordinates = [startProjection.coordinate];
  let travelled = 0;
  for (let i = 1; i < line.length - 1; i++) {
    travelled += haversine(line[i - 1], line[i]);
    if (travelled > startProjection.along && travelled < endProjection.along) coordinates.push(line[i]);
  }
  coordinates.push(endProjection.coordinate);
  return coordinates.length >= 2 ? coordinates : null;
}

function samePath(a, b) {
  const sample = (line, other) => line.filter((_, i) => i % Math.max(1, Math.floor(line.length / 20)) === 0).every(point => pointLineDistance(point, other) <= 80);
  return sample(a, b) && sample(b, a);
}

function placeMatchesStop(place, stopName) {
  if (!place || !stopName) return false;
  const placeHan = place.match(/\p{Script=Han}+/gu) || [];
  const stopHan = stopName.match(/\p{Script=Han}+/gu) || [];
  return placeHan.some(token => token.length >= 2 && stopHan.some(name => name.includes(token) || token.includes(name)));
}

function viaVariant(text) {
  return /\bvia\b|經|经/i.test(text || '');
}

function hasNamedVia(tags) {
  const chineseWaypoints = (tags['name:zh'] || '').split(/[—–]/).length;
  const englishWaypoints = (tags['name:en'] || '').split(/\s+[—–-]\s+/).length;
  return Boolean(tags.via || viaVariant(tags.name) || chineseWaypoints >= 3 || englishWaypoints >= 3);
}

function namedViaStops(tags) {
  let viaNames = tags.via ? tags.via.split(/[;；,，]/).map(value => value.trim()).filter(Boolean) : [];
  if (!viaNames.length) {
    const zhWaypoints = (tags['name:zh'] || '').split(/[—–]/).map(value => value.trim()).filter(Boolean);
    const enWaypoints = (tags['name:en'] || '').split(/\s+[—–-]\s+/).map(value => value.trim()).filter(Boolean);
    if (zhWaypoints.length >= 3) viaNames = zhWaypoints.slice(1, -1);
    else if (enWaypoints.length >= 3) viaNames = enWaypoints.slice(1, -1);
  }
  return viaNames;
}

function viaStopCoverage(tags, stopNames) {
  return namedViaStops(tags).filter(viaName => stopNames.some(stopName => placeMatchesStop(viaName, stopName))).length;
}

function hasUnmatchedVia(tags, stopNames, routeName) {
  return namedViaStops(tags).some(viaName => !stopNames.some(stopName => placeMatchesStop(viaName, stopName)) && !placeMatchesStop(viaName, routeName));
}

function explicitlyExcludedStop(routeName, sourceName) {
  const excluded = [...(routeName || '').matchAll(/不(?:經|经)([\p{Script=Han}]{2,6})/gu)].map(match => match[1]);
  return excluded.some(stop => (sourceName || '').includes(stop));
}

const routePaths = [];
for (const relation of osm.elements.filter(el => el.type === 'relation' && el.tags?.route === 'ferry')) {
  const tagText = Object.values(relation.tags || {}).join(' ');
  // Cross-border/international relations are not relevant to the local app routes.
  if (/深圳|珠海|廣州|广州|澳門|澳门|中山|东莞|順德|顺德|香港機場|香港机场/.test(tagText)) continue;
  for (const coordinates of chainWays(relation.members)) routePaths.push({ type: 'relation', id: relation.id, tags: relation.tags, coordinates });
}
const relationWayIds = new Set(osm.elements.filter(el => el.type === 'relation' && el.tags?.route === 'ferry').flatMap(relation => relation.members.filter(member => member.type === 'way').map(member => member.ref)));
for (const way of osm.elements.filter(el => el.type === 'way' && el.tags?.route === 'ferry' && !relationWayIds.has(el.id))) {
  const coordinates = way.nodes.map(id => nodes.get(id)).filter(Boolean).map(node => [node.lon, node.lat]);
  if (coordinates.length >= 4) routePaths.push({ type: 'way', id: way.id, tags: way.tags, coordinates });
}

function pathSegmentsBetween(start, end, routeName, stopNames) {
  const candidates = [];
  for (const item of routePaths) {
    if (explicitlyExcludedStop(routeName, item.tags.name)) continue;
    for (const coordinates of [item.coordinates, [...item.coordinates].reverse()]) {
      const startProjection = projectOntoLine(start, coordinates);
      const endProjection = projectOntoLine(end, coordinates);
      if (!startProjection || !endProjection || Math.max(startProjection.distance, endProjection.distance) > 250) continue;
      const segmentCoordinates = sliceLine(coordinates, startProjection, endProjection);
      if (!segmentCoordinates) continue;
      const variantPenalty = Number(hasNamedVia(item.tags) && hasUnmatchedVia(item.tags, stopNames, routeName));
      candidates.push({
        ...item,
        coordinates: segmentCoordinates,
        startDistance: startProjection.distance,
        endDistance: endProjection.distance,
        endpointScore: startProjection.distance + endProjection.distance,
        directionMatches: Number(placeMatchesStop(item.tags.from, stopNames[0])) + Number(placeMatchesStop(item.tags.to, stopNames[1])),
        variantPenalty,
        viaCoverage: viaStopCoverage(item.tags, stopNames)
      });
    }
  }
  candidates.sort((a, b) => a.variantPenalty - b.variantPenalty || b.viaCoverage - a.viaCoverage || b.directionMatches - a.directionMatches || a.endpointScore - b.endpointScore || b.coordinates.length - a.coordinates.length);
  return candidates;
}

function buildCompositePath(pattern, routeName, allStopNames) {
  const stops = (pattern.s || []).map(stop => stopById.get(String(stop[0])));
  if (stops.length < 3 || stops.some(stop => !stop)) return null;
  const coordinates = [];
  const sources = [];
  const sourceNames = [];
  const legs = [];
  let firstDistance = 0, lastDistance = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const startStop = stops[i], endStop = stops[i + 1];
    const start = [startStop[2], startStop[3]], end = [endStop[2], endStop[3]];
    const candidates = pathSegmentsBetween(start, end, routeName, allStopNames);
    if (!candidates.length) return null;
    const best = candidates[0];
    const tiedDifferent = candidates.find(candidate => (candidate.type !== best.type || candidate.id !== best.id) && candidate.directionMatches === best.directionMatches && candidate.variantPenalty === best.variantPenalty && candidate.viaCoverage === best.viaCoverage && candidate.endpointScore <= best.endpointScore + 20 && !samePath(best.coordinates, candidate.coordinates));
    if (tiedDifferent) return null;
    if (i === 0) firstDistance = best.startDistance;
    else {
      const stopCoordinate = [startStop[2], startStop[3]];
      if (haversine(coordinates.at(-1), stopCoordinate) > 250 || haversine(stopCoordinate, best.coordinates[0]) > 250) return null;
      if (haversine(coordinates.at(-1), stopCoordinate) > 2) coordinates.push(stopCoordinate);
    }
    coordinates.push(...(coordinates.length ? best.coordinates.slice(1) : best.coordinates));
    lastDistance = best.endDistance;
    const source = `${best.type}/${best.id}`;
    if (!sources.includes(source)) sources.push(source);
    if (best.tags.name && !sourceNames.includes(best.tags.name)) sourceNames.push(best.tags.name);
    legs.push({ from: startStop[1], to: endStop[1], source, sourceName: best.tags.name, vertices: best.coordinates.length, endsM: [Math.round(best.startDistance), Math.round(best.endDistance)] });
  }
  if (sources.length < 2 || coordinates.length < 4) return null;
  return { coordinates, source: sources.join('+'), sourceName: sourceNames.join(' + '), startDistance: firstDistance, endDistance: lastDistance, legs };
}

function findCircularPath(pattern, routeName) {
  const stops = (pattern.s || []).map(stop => stopById.get(String(stop[0]))).filter(Boolean);
  if (stops.length < 3) return { best: null, tiedDifferent: null };
  const stopNames = (pattern.s || []).map(stop => stop[1]).filter(Boolean);
  const terminal = [stops[0][2], stops[0][3]];
  const candidates = [];
  for (const item of routePaths) {
    if (explicitlyExcludedStop(routeName, item.tags.name)) continue;
    for (const coordinates of [item.coordinates, [...item.coordinates].reverse()]) {
      const startDistance = haversine(terminal, coordinates[0]);
      const endDistance = haversine(terminal, coordinates.at(-1));
      if (Math.max(startDistance, endDistance) > 250) continue;
      const coverage = stops.filter(stop => pointLineDistance([stop[2], stop[3]], coordinates) <= 250).length / stops.length;
      if (coverage < 1) continue;
      candidates.push({
        ...item,
        coordinates,
        startDistance,
        endDistance,
        endpointScore: startDistance + endDistance,
        coverage,
        variantPenalty: Number(hasNamedVia(item.tags) && hasUnmatchedVia(item.tags, stopNames, routeName)),
        viaCoverage: viaStopCoverage(item.tags, stopNames),
        directionMatches: Number(placeMatchesStop(item.tags.from, pattern.s?.[0]?.[1])) + Number(placeMatchesStop(item.tags.to, pattern.s?.at(-1)?.[1]))
      });
    }
  }
  candidates.sort((a, b) => a.variantPenalty - b.variantPenalty || b.viaCoverage - a.viaCoverage || b.directionMatches - a.directionMatches || a.endpointScore - b.endpointScore || b.coordinates.length - a.coordinates.length);
  const best = candidates[0] || null;
  const tiedDifferent = best && candidates.find(candidate => (candidate.type !== best.type || candidate.id !== best.id) && candidate.variantPenalty === best.variantPenalty && candidate.viaCoverage === best.viaCoverage && candidate.directionMatches === best.directionMatches && candidate.endpointScore <= best.endpointScore + 20 && !samePath(best.coordinates, candidate.coordinates));
  return { best, tiedDifferent };
}

function encodePolyline(coordinates) {
  let previousLat = 0, previousLon = 0;
  let encoded = '';
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

function waySegment(wayId, start, end) {
  const way = ways.get(wayId);
  if (!way) throw new Error(`Missing OSM ferry way ${wayId}`);
  const line = way.nodes.map(id => nodes.get(id)).filter(Boolean).map(node => [node.lon, node.lat]);
  let best = null;
  for (const oriented of [line, [...line].reverse()]) {
    const startProjection = projectOntoLine(start, oriented);
    const endProjection = projectOntoLine(end, oriented);
    const segment = sliceLine(oriented, startProjection, endProjection);
    if (segment && (!best || startProjection.distance + endProjection.distance < best.score)) {
      best = { coordinates: segment, score: startProjection.distance + endProjection.distance, endsM: [startProjection.distance, endProjection.distance] };
    }
  }
  if (!best || Math.max(...best.endsM) > 250) throw new Error(`OSM ferry way ${wayId} does not reach its route stops`);
  return {
    coordinates: [start, ...best.coordinates, end].filter((point, index, all) => index === 0 || haversine(point, all[index - 1]) > 0.5),
    endsM: best.endsM.map(Math.round),
    vertices: best.coordinates.length
  };
}

function manualFerryRoute(routeId, pattern) {
  const stops = (pattern.s || []).map(stop => stopById.get(String(stop[0])));
  if (routeId === '7000020' && stops.length === 2) {
    const coordinates = [[stops[0][2], stops[0][3]], [stops[1][2], stops[1][3]]];
    return {
      coordinates,
      source: 'direct-waterline (no Kau Sai Village call)',
      sourceName: 'Direct ferry crossing; excludes Kau Sai Village',
      startDistance: 0,
      endDistance: 0,
      legs: [{ from: stops[0][1], to: stops[1][1], source: 'direct-waterline', vertices: 2, endsM: [0, 0] }],
      circular: false
    };
  }
  if (routeId === '7000030' && stops.length === 5) {
    const stopCoordinates = stops.map(stop => [stop[2], stop[3]]);
    const legs = [
      { from: 502378418, start: 0, end: 1 },
      { from: 502378419, start: 1, end: 2 },
      { from: 1446426987, start: 2, end: 3 },
      { from: null, start: 3, end: 4 }
    ].map(leg => {
      const start = stopCoordinates[leg.start], end = stopCoordinates[leg.end];
      if (leg.from === null) return { ...leg, coordinates: [start, end], endsM: [0, 0], vertices: 2, source: 'direct-waterline' };
      const segment = waySegment(leg.from, start, end);
      return { ...leg, ...segment, source: `way/${leg.from}` };
    });
    const coordinates = [];
    for (const leg of legs) coordinates.push(...(coordinates.length ? leg.coordinates.slice(1) : leg.coordinates));
    const sources = [...new Set(legs.map(leg => leg.source))];
    return {
      coordinates,
      source: sources.join('+'),
      sourceName: 'OSM ferry legs with a direct return to Sha Tau Kok',
      startDistance: legs[0].endsM[0],
      endDistance: legs.at(-1).endsM[1],
      legs: legs.map((leg, index) => ({ from: stops[index][1], to: stops[index + 1][1], source: leg.source, vertices: leg.vertices, endsM: leg.endsM })),
      circular: true
    };
  }
  return null;
}

const overrides = {};
const report = [];
for (const route of packed.filter(route => route.a === 'FERRY')) {
  const routePattern = patternsByRoute.get(String(route.i));
  for (const [direction, pattern] of (routePattern?.d || []).entries()) {
    const firstStop = stopById.get(String(pattern.s?.[0]?.[0]));
    const lastStop = stopById.get(String(pattern.s?.at(-1)?.[0]));
    if (!firstStop || !lastStop) {
      report.push({ routeId: route.i, route: route.n, direction, status: 'skipped', reason: 'The app route pattern is missing a terminal stop.' });
      continue;
    }
    const manual = manualFerryRoute(String(route.i), pattern);
    if (manual) {
      const key = `${route.i}:${direction}`;
      overrides[key] = { source: manual.source, high: encodePolyline(manual.coordinates) };
      report.push({ routeId: route.i, route: route.n, direction, status: 'matched', source: manual.source, sourceName: manual.sourceName, endsM: [manual.startDistance, manual.endDistance], vertices: manual.coordinates.length, intermediateStopsMatched: '100%', manual: true, circular: manual.circular, legs: manual.legs });
      continue;
    }
    const isCircular = haversine([firstStop[2], firstStop[3]], [lastStop[2], lastStop[3]]) < 50;
    if (isCircular) {
      const loop = findCircularPath(pattern, route.n);
      if (loop.tiedDifferent) {
        report.push({ routeId: route.i, route: route.n, direction, status: 'ambiguous', reason: 'Multiple OSM paths cover the loop stops with similar evidence.', candidates: [loop.best, loop.tiedDifferent].map(c => ({ source: `${c.type}/${c.id}`, name: c.tags.name, vertices: c.coordinates.length })) });
      } else if (loop.best) {
        const key = `${route.i}:${direction}`;
        overrides[key] = { source: `${loop.best.type}/${loop.best.id}`, high: encodePolyline(loop.best.coordinates) };
        report.push({ routeId: route.i, route: route.n, direction, status: 'matched', source: `${loop.best.type}/${loop.best.id}`, sourceName: loop.best.tags.name, endsM: [Math.round(loop.best.startDistance), Math.round(loop.best.endDistance)], vertices: loop.best.coordinates.length, intermediateStopsMatched: '100%', circular: true });
      } else {
        const composite = buildCompositePath(pattern, route.n, (pattern.s || []).map(stop => stop[1]).filter(Boolean));
        if (composite) {
          const key = `${route.i}:${direction}`;
          overrides[key] = { source: composite.source, high: encodePolyline(composite.coordinates) };
        report.push({ routeId: route.i, route: route.n, direction, status: 'matched', source: composite.source, sourceName: composite.sourceName, endsM: [Math.round(composite.startDistance), Math.round(composite.endDistance)], vertices: composite.coordinates.length, intermediateStopsMatched: '100%', composite: true, circular: true, legs: composite.legs });
        } else report.push({ routeId: route.i, route: route.n, direction, status: 'skipped', reason: 'No single or connected set of OSM paths covers all loop legs.' });
      }
      continue;
    }
    const start = [firstStop[2], firstStop[3]], end = [lastStop[2], lastStop[3]];
    const innerStops = (pattern.s || []).slice(1, -1).map(stop => stopById.get(String(stop[0]))).filter(Boolean).map(stop => [stop[2], stop[3]]);
    const patternStopNames = (pattern.s || []).map(stop => stop[1]).filter(Boolean);
    const candidates = [];
    const excludedCandidates = [];
    const nearMisses = [];
    const coverageMisses = [];
    for (const item of routePaths) {
      for (const coordinates of [item.coordinates, [...item.coordinates].reverse()]) {
        const startProjection = projectOntoLine(start, coordinates);
        const endProjection = projectOntoLine(end, coordinates);
        if (!startProjection || !endProjection) continue;
        const startDistance = startProjection.distance;
        const endDistance = endProjection.distance;
        if (explicitlyExcludedStop(route.n, item.tags.name)) {
          if (Math.max(startDistance, endDistance) <= 250) excludedCandidates.push({ item, startDistance, endDistance });
          continue;
        }
        if (Math.max(startDistance, endDistance) > 250) {
          if (Math.max(startDistance, endDistance) <= 2000) nearMisses.push({ item, startDistance, endDistance });
          continue;
        }
        const segmentCoordinates = sliceLine(coordinates, startProjection, endProjection);
        if (!segmentCoordinates) continue;
        const coverage = innerStops.length ? innerStops.filter(stop => pointLineDistance(stop, segmentCoordinates) <= 250).length / innerStops.length : 0;
        if (innerStops.length && coverage < 1) {
          coverageMisses.push({ item, startDistance, endDistance, coverage });
          continue;
        }
        const directionMatches = Number(placeMatchesStop(item.tags.from, pattern.s?.[0]?.[1])) + Number(placeMatchesStop(item.tags.to, pattern.s?.at(-1)?.[1]));
        // Prefer the OSM service variant whose named via stops agree with the
        // app's pattern and title, then use stop coverage and terminal fit.
        const variantPenalty = Number(hasNamedVia(item.tags) && hasUnmatchedVia(item.tags, patternStopNames, route.n));
        const viaCoverage = viaStopCoverage(item.tags, patternStopNames);
        candidates.push({ ...item, coordinates: segmentCoordinates, startDistance, endDistance, endpointScore: startDistance + endDistance, directionMatches, variantPenalty, viaCoverage, coverage });
      }
    }
    candidates.sort((a, b) => a.variantPenalty - b.variantPenalty || b.viaCoverage - a.viaCoverage || (innerStops.length ? b.coverage - a.coverage : 0) || b.directionMatches - a.directionMatches || a.endpointScore - b.endpointScore || b.coordinates.length - a.coordinates.length);
    if (!candidates.length) {
      const composite = !excludedCandidates.length && innerStops.length ? buildCompositePath(pattern, route.n, patternStopNames) : null;
      if (composite) {
        const key = `${route.i}:${direction}`;
        overrides[key] = { source: composite.source, high: encodePolyline(composite.coordinates) };
        report.push({ routeId: route.i, route: route.n, direction, status: 'matched', source: composite.source, sourceName: composite.sourceName, endsM: [Math.round(composite.startDistance), Math.round(composite.endDistance)], vertices: composite.coordinates.length, intermediateStopsMatched: '100%', composite: true, legs: composite.legs });
        continue;
      }
      if (excludedCandidates.length) {
        report.push({ routeId: route.i, route: route.n, direction, status: 'excluded', reason: 'The matching OSM path includes a stop explicitly excluded by this route.', candidates: excludedCandidates.slice(0, 2).map(c => ({ source: `${c.item.type}/${c.item.id}`, name: c.item.tags.name, endsM: [Math.round(c.startDistance), Math.round(c.endDistance)] })) });
      } else if (coverageMisses.length) {
        coverageMisses.sort((a, b) => b.coverage - a.coverage || a.startDistance + a.endDistance - b.startDistance - b.endDistance);
        report.push({ routeId: route.i, route: route.n, direction, status: 'unmatched', reason: 'Nearby OSM paths do not cover every intermediate stop.', nearestPaths: coverageMisses.slice(0, 3).map(c => ({ source: `${c.item.type}/${c.item.id}`, name: c.item.tags.name, endsM: [Math.round(c.startDistance), Math.round(c.endDistance)], intermediateStopCoverage: `${Math.round(c.coverage * 100)}%` })) });
      } else {
        nearMisses.sort((a, b) => Math.max(a.startDistance, a.endDistance) - Math.max(b.startDistance, b.endDistance) || a.startDistance + a.endDistance - b.startDistance - b.endDistance);
      report.push({ routeId: route.i, route: route.n, direction, status: 'unmatched', reason: 'No OSM ferry path has both terminals within 250m.', nearestPaths: nearMisses.slice(0, 3).map(c => ({ source: `${c.item.type}/${c.item.id}`, name: c.item.tags.name, endsM: [Math.round(c.startDistance), Math.round(c.endDistance)] })) });
      }
      continue;
    }
    const best = candidates[0];
    const tiedDifferent = candidates.find(candidate => (candidate.type !== best.type || candidate.id !== best.id) && candidate.directionMatches === best.directionMatches && candidate.variantPenalty === best.variantPenalty && candidate.viaCoverage === best.viaCoverage && (!innerStops.length || Math.abs(candidate.coverage - best.coverage) < 0.05) && candidate.endpointScore <= best.endpointScore + 20 && !samePath(best.coordinates, candidate.coordinates));
    if (tiedDifferent) {
      report.push({ routeId: route.i, route: route.n, direction, status: 'ambiguous', candidates: [best, tiedDifferent].map(c => ({ source: `${c.type}/${c.id}`, name: c.tags.name, variantPenalty: c.variantPenalty, directionMatches: c.directionMatches, endsM: [Math.round(c.startDistance), Math.round(c.endDistance)], intermediateStopCoverage: innerStops.length ? `${Math.round(c.coverage * 100)}%` : 'n/a', vertices: c.coordinates.length })) });
      continue;
    }
    const key = `${route.i}:${direction}`;
    overrides[key] = { source: `${best.type}/${best.id}`, high: encodePolyline(best.coordinates) };
    report.push({ routeId: route.i, route: route.n, direction, status: 'matched', source: `${best.type}/${best.id}`, sourceName: best.tags.name, endsM: [Math.round(best.startDistance), Math.round(best.endDistance)], vertices: best.coordinates.length, intermediateStopsMatched: innerStops.length ? `${Math.round(best.coverage * 100)}%` : 'n/a' });
  }
}

const summary = { sourceTimestamp: osm.osm3s?.timestamp_osm_base || null, osmPathsConsidered: routePaths.length, matchedDirections: Object.keys(overrides).length, routes: new Set(Object.keys(overrides).map(key => key.split(':')[0])).size, ambiguousDirections: report.filter(row => row.status === 'ambiguous').length, excludedDirections: report.filter(row => row.status === 'excluded').length, unmatchedDirections: report.filter(row => row.status === 'unmatched').length, skippedDirections: report.filter(row => row.status === 'skipped').length };
function routePatternCount(routeId) { return patternsByRoute.get(String(routeId))?.d?.length || 0; }

if (process.argv.includes('--write')) {
  const asset = `/* Ferry shapes derived from OpenStreetMap route=ferry relations and ways.\n * Source extract timestamp: ${summary.sourceTimestamp || 'unknown'}.\n * OSM data is available under the Open Database License (ODbL); see README.md.\n */\nwindow.HK_OSM_FERRY_ROUTES=${JSON.stringify(overrides)};\n`;
  fs.writeFileSync(path.join(root, 'assets/osm-ferry-routes.js'), asset);
  console.log(`Matched ${summary.matchedDirections} ferry directions across ${summary.routes} routes; ${summary.excludedDirections} route-excluded, ${summary.ambiguousDirections} ambiguous, ${summary.unmatchedDirections} unmatched and ${summary.skippedDirections} skipped directions were left unchanged.`);
  console.log(`Wrote assets/osm-ferry-routes.js (OSM snapshot ${summary.sourceTimestamp || 'unknown'}).`);
} else console.log(JSON.stringify({ summary, report }, null, 2));
