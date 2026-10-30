/* Approximate MTR train locations from Next Train ETA and route segment lengths.
 * This is an estimate, not an MTR vehicle-position feed. */
(function () {
  'use strict';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const radians = degrees => degrees * Math.PI / 180;
  const DWELL_SECONDS = 24;
  const PROBE_EVERY_STATIONS = 3;
  const LINE_SPEED_KPH = {
    AEL: 65, DRL: 42, EAL: 62, ISL: 43, KTL: 42,
    TCL: 62, TKL: 43, TML: 58, TWL: 42, SIL: 43
  };

  function distanceMeters(a, b) {
    const lat1 = radians(a[1]), lat2 = radians(b[1]);
    const dLat = lat2 - lat1;
    const dLon = radians(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }

  function pointAlong(coords, ratio) {
    if (!coords.length) return null;
    if (coords.length === 1) return { coordinate: coords[0].slice(), bearing: 0 };
    const lengths = [];
    let total = 0;
    for (let i = 0; i < coords.length - 1; i += 1) {
      const length = distanceMeters(coords[i], coords[i + 1]);
      lengths.push(length);
      total += length;
    }
    if (!total) return { coordinate: coords[0].slice(), bearing: 0 };
    const target = clamp(ratio, 0, 1) * total;
    let covered = 0;
    for (let i = 0; i < lengths.length; i += 1) {
      const length = lengths[i];
      if (covered + length >= target || i === lengths.length - 1) {
        const t = length ? clamp((target - covered) / length, 0, 1) : 0;
        const a = coords[i], b = coords[i + 1];
        const y = Math.sin(radians(b[0] - a[0])) * Math.cos(radians(b[1]));
        const x = Math.cos(radians(a[1])) * Math.sin(radians(b[1]))
          - Math.sin(radians(a[1])) * Math.cos(radians(b[1])) * Math.cos(radians(b[0] - a[0]));
        const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        return { coordinate: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing };
      }
      covered += length;
    }
    return { coordinate: coords[coords.length - 1].slice(), bearing: 0 };
  }

  function parseHkTime(value) {
    if (!value) return NaN;
    const text = String(value).trim();
    const parsed = new Date((text.includes('T') ? text : text.replace(' ', 'T')) + (/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? '' : '+08:00'));
    return parsed.getTime();
  }

  function createEstimator(network) {
    const stations = new Map(network.stations.features.map(feature => [feature.properties.code, feature]));
    const routeFeatures = network.routes.features;
    const lines = new Map();
    const graphCache = new WeakMap();

    function buildTrackGraph(feature) {
      if (graphCache.has(feature)) return graphCache.get(feature);
      const nodes = [];
      const adjacency = [];
      const coordinateIndex = new Map();
      const endpoints = [];
      const paths = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      function nodeFor(coordinate) {
        const point = coordinate.slice(0, 2);
        const key = Math.round(point[0] * 1e6) + ':' + Math.round(point[1] * 1e6);
        if (coordinateIndex.has(key)) return coordinateIndex.get(key);
        const id = nodes.length;
        nodes.push(point);
        adjacency.push([]);
        coordinateIndex.set(key, id);
        return id;
      }
      function connect(a, b) {
        if (a === b) return;
        const length = distanceMeters(nodes[a], nodes[b]);
        if (length < 0.2) return;
        adjacency[a].push({ to: b, length });
        adjacency[b].push({ to: a, length });
      }
      paths.forEach((path, pathIndex) => {
        if (!path || path.length < 2) return;
        const ids = path.map(nodeFor);
        for (let index = 1; index < ids.length; index += 1) connect(ids[index - 1], ids[index]);
        endpoints.push({ id: ids[0], pathIndex }, { id: ids[ids.length - 1], pathIndex });
      });

      // Some route relations split ways a few metres apart. Join only close,
      // mutual-nearest endpoints so nearby parallel tracks are not cross-wired.
      const candidates = [];
      const nearest = new Map();
      for (let i = 0; i < endpoints.length; i += 1) {
        for (let j = i + 1; j < endpoints.length; j += 1) {
          if (endpoints[i].pathIndex === endpoints[j].pathIndex || endpoints[i].id === endpoints[j].id) continue;
          const distance = distanceMeters(nodes[endpoints[i].id], nodes[endpoints[j].id]);
          if (distance > 25) continue;
          candidates.push({ i, j, distance });
          if (!nearest.has(i) || distance < nearest.get(i).distance) nearest.set(i, { index: j, distance });
          if (!nearest.has(j) || distance < nearest.get(j).distance) nearest.set(j, { index: i, distance });
        }
      }
      candidates.sort((a, b) => a.distance - b.distance);
      const joined = new Set();
      for (const candidate of candidates) {
        const { i, j } = candidate;
        if (joined.has(i) || joined.has(j) || nearest.get(i)?.index !== j || nearest.get(j)?.index !== i) continue;
        connect(endpoints[i].id, endpoints[j].id);
        joined.add(i);
        joined.add(j);
      }
      const graph = { nodes, adjacency, stationNodes: new Map() };
      graphCache.set(feature, graph);
      return graph;
    }

    function nearestTrackNode(graph, stationCode) {
      if (graph.stationNodes.has(stationCode)) return graph.stationNodes.get(stationCode);
      const station = stations.get(stationCode);
      if (!station || !graph.nodes.length) return null;
      const coordinate = station.geometry.coordinates;
      let nearest = -1;
      let nearestDistance = Infinity;
      for (let index = 0; index < graph.nodes.length; index += 1) {
        const distance = distanceMeters(coordinate, graph.nodes[index]);
        if (distance < nearestDistance) {
          nearest = index;
          nearestDistance = distance;
        }
      }
      const result = nearestDistance <= 500 ? nearest : null;
      graph.stationNodes.set(stationCode, result);
      return result;
    }

    function shortestTrackPath(graph, start, finish) {
      if (start == null || finish == null) return null;
      if (start === finish) return [graph.nodes[start].slice()];
      const distance = new Float64Array(graph.nodes.length);
      distance.fill(Infinity);
      const previous = new Int32Array(graph.nodes.length);
      previous.fill(-1);
      const queue = [];
      function push(item) {
        let index = queue.length;
        queue.push(item);
        while (index > 0) {
          const parent = (index - 1) >> 1;
          if (queue[parent].priority <= item.priority) break;
          queue[index] = queue[parent];
          index = parent;
        }
        queue[index] = item;
      }
      function pop() {
        const first = queue[0];
        const last = queue.pop();
        if (queue.length) {
          let index = 0;
          while (true) {
            const left = index * 2 + 1, right = left + 1;
            if (left >= queue.length) break;
            const child = right < queue.length && queue[right].priority < queue[left].priority ? right : left;
            if (queue[child].priority >= last.priority) break;
            queue[index] = queue[child];
            index = child;
          }
          queue[index] = last;
        }
        return first;
      }
      const target = graph.nodes[finish];
      distance[start] = 0;
      push({ id: start, cost: 0, priority: distanceMeters(graph.nodes[start], target) });
      while (queue.length) {
        const current = pop();
        if (current.cost !== distance[current.id]) continue;
        if (current.id === finish) break;
        for (const edge of graph.adjacency[current.id]) {
          const next = current.cost + edge.length;
          if (next >= distance[edge.to]) continue;
          distance[edge.to] = next;
          previous[edge.to] = current.id;
          push({ id: edge.to, cost: next, priority: next + distanceMeters(graph.nodes[edge.to], target) });
        }
      }
      if (!Number.isFinite(distance[finish])) return null;
      const path = [];
      let reachedStart = false;
      for (let current = finish; current !== -1; current = previous[current]) {
        path.push(graph.nodes[current].slice());
        if (current === start) {
          reachedStart = true;
          break;
        }
      }
      if (!reachedStart) return null;
      path.reverse();
      return path.length >= 2 ? path : null;
    }

    function pairTrack(lineCode, fromCode, toCode) {
      const from = stations.get(fromCode);
      const to = stations.get(toCode);
      if (!from || !to) return [from && from.geometry.coordinates, to && to.geometry.coordinates].filter(Boolean);
      const branch = routeFeatures.find(feature => feature.properties.code === lineCode
        && feature.properties.branch
        && String(feature.properties.branchName || '').split('-').includes(fromCode)
        && String(feature.properties.branchName || '').split('-').includes(toCode));
      const main = routeFeatures.find(feature => feature.properties.code === lineCode && !feature.properties.branch);
      const feature = branch || main;
      if (!feature) return [from.geometry.coordinates, to.geometry.coordinates];
      const graph = buildTrackGraph(feature);
      const start = nearestTrackNode(graph, fromCode);
      const finish = nearestTrackNode(graph, toCode);
      return shortestTrackPath(graph, start, finish) || [from.geometry.coordinates, to.geometry.coordinates];
    }

    function buildDirection(line, direction) {
      const stops = direction.stations || [];
      const segments = [];
      let distanceFromStart = 0;
      for (let index = 0; index < stops.length - 1; index += 1) {
        const from = stops[index], to = stops[index + 1];
        const coords = pairTrack(line.code, from.code, to.code);
        let lengthMeters = 0;
        for (let p = 0; p < coords.length - 1; p += 1) lengthMeters += distanceMeters(coords[p], coords[p + 1]);
        if (!lengthMeters) {
          const fromFeature = stations.get(from.code), toFeature = stations.get(to.code);
          if (fromFeature && toFeature) lengthMeters = distanceMeters(fromFeature.geometry.coordinates, toFeature.geometry.coordinates) * 1.12;
        }
        const speed = (LINE_SPEED_KPH[line.code] || 45) * 1000 / 3600;
        const travelSeconds = clamp(lengthMeters / speed, 35, 900);
        segments.push({ from, to, coords, lengthMeters, travelSeconds, distanceFromStart });
        distanceFromStart += lengthMeters;
      }
      return { line, direction, stops, segments, totalLengthMeters: distanceFromStart };
    }

    for (const line of network.lines) {
      lines.set(line.code, {
        line,
        directions: (line.directions || []).map(direction => buildDirection(line, direction))
      });
    }

    function targets(lineCodes) {
      const result = [];
      const seen = new Set();
      for (const code of lineCodes || []) {
        const model = lines.get(code);
        if (!model) continue;
        const codes = new Set();
        for (const direction of model.directions) {
          for (let index = 0; index < direction.stops.length; index += 1) {
            if (index % PROBE_EVERY_STATIONS === 0 || index === direction.stops.length - 1) {
              codes.add(direction.stops[index].code);
            }
          }
        }
        for (const stationCode of codes) {
          const key = code + ':' + stationCode;
          if (!seen.has(key)) {
            seen.add(key);
            result.push({ lineCode: code, stationCode });
          }
        }
      }
      return result;
    }

    function resolveDirection(model, stationCode, train) {
      const destination = String(train.dest || '').toUpperCase();
      const racecourseService = String(train.route || '').toUpperCase() === 'RAC';
      const candidates = [];
      for (const direction of model.directions) {
        const stationIndex = direction.stops.findIndex(stop => stop.code === stationCode);
        if (stationIndex < 0) continue;
        let destinationCode = destination;
        let destinationIndex = destinationCode ? direction.stops.findIndex(stop => stop.code === destinationCode) : -1;
        if (racecourseService) {
          const racecourseIndex = direction.stops.findIndex(stop => stop.code === 'RAC');
          if (racecourseIndex > stationIndex) {
            destinationCode = 'RAC';
            destinationIndex = racecourseIndex;
          }
        }
        if (destinationIndex > stationIndex) {
          candidates.push({ direction, stationIndex, destinationIndex, destinationCode });
        } else if (destinationIndex === stationIndex && stationIndex === direction.stops.length - 1) {
          candidates.push({ direction, stationIndex, destinationIndex, destinationCode });
        }
      }
      if (!candidates.length) return null;
      // Multiple MTR service variants can share the same physical approach.
      // Prefer the shortest matching station path, which also favors the
      // correct racecourse/Lok Ma Chau branch when one is actually used.
      candidates.sort((a, b) => (a.destinationIndex - a.stationIndex) - (b.destinationIndex - b.stationIndex));
      return candidates[0];
    }

    function locateSegment(direction, targetIndex, etaSeconds) {
      let remaining = etaSeconds;
      for (let index = targetIndex - 1; index >= 0; index -= 1) {
        const segment = direction.segments[index];
        if (remaining <= segment.travelSeconds) {
          let downstreamSeconds = 0;
          for (let next = index + 1; next < targetIndex; next += 1) {
            downstreamSeconds += DWELL_SECONDS + direction.segments[next].travelSeconds;
          }
          return { segment, segmentIndex: index, downstreamSeconds };
        }
        remaining -= segment.travelSeconds;
        if (index > 0) remaining -= DWELL_SECONDS;
      }
      return null;
    }

    function stationPosition(code, bearing, progress, remainingToNextStopSeconds) {
      const station = stations.get(code);
      return station ? {
        coordinate: station.geometry.coordinates.slice(),
        bearing,
        progress,
        atStation: true,
        nextStopCode: null,
        remainingToNextStopSeconds
      } : null;
    }

    function interpolateAfterStation(model, now) {
      const direction = model.directionModel;
      const stationOrder = model.stationOrder;
      const destinationOrder = model.destinationOrder;
      if (stationOrder >= destinationOrder) return null;

      let elapsed = Math.max(0, (now - model.departureEpoch) / 1000);
      for (let segmentIndex = stationOrder; segmentIndex < destinationOrder; segmentIndex += 1) {
        const segment = direction.segments[segmentIndex];
        if (!segment) return null;
        if (elapsed < segment.travelSeconds) {
          const progress = clamp(elapsed / segment.travelSeconds, 0, 1);
          const position = pointAlong(segment.coords, progress);
          return position && {
            ...position,
            progress,
            atStation: false,
            nextStopCode: segment.to.code,
            remainingToNextStopSeconds: Math.max(0, segment.travelSeconds - elapsed)
          };
        }

        elapsed -= segment.travelSeconds;
        const arrivedAtOrder = segmentIndex + 1;
        // A train has completed this model once it reaches its destination.
        if (arrivedAtOrder >= destinationOrder) return null;

        const nextSegment = direction.segments[arrivedAtOrder];
        const dwellRemaining = DWELL_SECONDS - elapsed;
        if (dwellRemaining > 0) {
          const atStation = stationPosition(
            segment.to.code,
            model.bearing,
            0,
            nextSegment ? dwellRemaining + nextSegment.travelSeconds : null
          );
          if (atStation) atStation.nextStopCode = nextSegment ? nextSegment.to.code : null;
          return atStation;
        }
        elapsed -= DWELL_SECONDS;
      }
      return null;
    }

    function interpolateApproach(model, now) {
      const direction = model.directionModel;
      const targetOrder = model.stationOrder;
      let elapsed = Math.max(0, (now - model.feedEpoch) / 1000);

      for (let segmentIndex = model.segmentIndex; segmentIndex < targetOrder; segmentIndex += 1) {
        const segment = direction.segments[segmentIndex];
        if (!segment) return null;
        const remainingAtFeed = segmentIndex === model.segmentIndex
          ? model.remainingInSegmentAtFeed
          : segment.travelSeconds;

        if (elapsed < remainingAtFeed) {
          const progress = clamp(1 - (remainingAtFeed - elapsed) / segment.travelSeconds, 0, 1);
          const position = pointAlong(segment.coords, progress);
          return position && {
            ...position,
            progress,
            atStation: false,
            nextStopCode: segment.to.code,
            remainingToNextStopSeconds: Math.max(0, remainingAtFeed - elapsed)
          };
        }

        elapsed -= remainingAtFeed;
        const arrivedAtOrder = segmentIndex + 1;
        if (arrivedAtOrder >= targetOrder) {
          const targetPosition = stationPosition(model.stationCode, model.bearing, 1, null);
          return targetPosition;
        }

        const dwellRemaining = DWELL_SECONDS - elapsed;
        const nextSegment = direction.segments[arrivedAtOrder];
        if (dwellRemaining > 0) {
          const atStation = stationPosition(
            segment.to.code,
            model.bearing,
            0,
            nextSegment ? dwellRemaining + nextSegment.travelSeconds : null
          );
          if (atStation) atStation.nextStopCode = nextSegment ? nextSegment.to.code : null;
          return atStation;
        }
        elapsed -= DWELL_SECONDS;
      }
      return null;
    }

    function interpolateAtNow(model, now) {
      if (model.stoppedAtStation) {
        if (now < model.departureEpoch) {
          const nextSegment = model.directionModel.segments[model.stationOrder];
          const untilNextStop = (model.departureEpoch - now) / 1000 + (nextSegment ? nextSegment.travelSeconds : 0);
          const atStation = stationPosition(model.stationCode, model.bearing, 0, nextSegment ? untilNextStop : null);
          if (atStation) atStation.nextStopCode = nextSegment ? nextSegment.to.code : null;
          return atStation;
        }
        return interpolateAfterStation(model, now);
      }

      if (now >= model.arrivalEpoch) {
        if (now < model.departureEpoch) {
          const nextSegment = model.directionModel.segments[model.stationOrder];
          const untilNextStop = (model.departureEpoch - now) / 1000 + (nextSegment ? nextSegment.travelSeconds : 0);
          const atStation = stationPosition(model.stationCode, model.bearing, 1, nextSegment ? untilNextStop : null);
          if (atStation) atStation.nextStopCode = nextSegment ? nextSegment.to.code : null;
          return atStation;
        }
        return interpolateAfterStation(model, now);
      }

      return interpolateApproach(model, now);
    }

    function estimate(responses) {
      const candidates = [];
      for (const item of responses || []) {
        const model = lines.get(item.lineCode);
        if (!model || !item.response || Number(item.response.status) === 0) continue;
        const schedule = item.response.data && item.response.data[item.lineCode + '-' + item.stationCode];
        if (!schedule) continue;
        const feedTime = parseHkTime(item.response.sys_time || schedule.sys_time || schedule.curr_time || item.response.curr_time) || Date.now();
        const receivedAt = Number.isFinite(item.receivedAt) ? item.receivedAt : Date.now();
        for (const key of ['UP', 'DOWN']) {
          const trains = Array.isArray(schedule[key]) ? schedule[key] : [];
          for (const train of trains) {
            if (train.valid === 'N') continue;
            const resolved = resolveDirection(model, item.stationCode, train);
            if (!resolved) continue;
            const direction = resolved.direction;
            const etaEpoch = parseHkTime(train.time);
            const etaSeconds = Number.isFinite(etaEpoch)
              ? (etaEpoch - feedTime) / 1000
              : Number.isFinite(Number(train.ttnt)) ? Number(train.ttnt) * 60 : NaN;
            if (!Number.isFinite(etaSeconds) || etaSeconds < -30 || etaSeconds > 7200) continue;
            // Keep the ETA interval from the MTR server, but anchor its countdown
            // to the browser's clock so local timezone or clock skew cannot hide it.
            const etaLocalEpoch = receivedAt + etaSeconds * 1000;
            const targetIndex = resolved.stationIndex;
            let candidate;
            if (train.timetype === 'D') {
              const stop = direction.stops[targetIndex];
              const segment = direction.segments[targetIndex] || direction.segments[targetIndex - 1];
              const bearing = segment && segment.coords.length > 1
                ? pointAlong(segment.coords, targetIndex === direction.segments.indexOf(segment) ? 0 : 1).bearing
                : 0;
              const departureEpoch = etaLocalEpoch;
              let terminalTravelSeconds = 0;
              for (let index = targetIndex; index < resolved.destinationIndex; index += 1) {
                terminalTravelSeconds += direction.segments[index].travelSeconds;
                if (index + 1 < resolved.destinationIndex) terminalTravelSeconds += DWELL_SECONDS;
              }
              const terminalArrivalEpoch = departureEpoch + terminalTravelSeconds * 1000;
              const timeToArrival = etaSeconds - DWELL_SECONDS;
              if (timeToArrival <= 0) {
                candidate = {
                  lineCode: item.lineCode,
                  directionCode: direction.direction.code,
                  destinationCode: resolved.destinationCode,
                  routeCode: train.route || '',
                  stationCode: stop.code,
                  stoppedAtStation: true,
                  departureEpoch,
                  arrivalEpoch: departureEpoch,
                  terminalArrivalEpoch,
                  feedEpoch: receivedAt,
                  positionAlongMeters: direction.segments.slice(0, targetIndex).reduce((sum, part) => sum + part.lengthMeters, 0),
                  directionModel: direction,
                  stationOrder: targetIndex,
                  destinationOrder: resolved.destinationIndex,
                  lineColor: model.line.color,
                  targetEtaSeconds: etaSeconds,
                  bearing
                };
              } else {
                const located = locateSegment(direction, targetIndex, timeToArrival);
                if (!located) continue;
                const remainingInSegment = timeToArrival - located.downstreamSeconds;
                const progressAtFeed = clamp(1 - remainingInSegment / located.segment.travelSeconds, 0, 1);
                const feedPosition = pointAlong(located.segment.coords, progressAtFeed);
                candidate = {
                  lineCode: item.lineCode,
                  directionCode: direction.direction.code,
                  destinationCode: resolved.destinationCode,
                  routeCode: train.route || '',
                  stationCode: stop.code,
                  stoppedAtStation: false,
                  stopAtStationAfterArrival: true,
                  departureEpoch,
                  arrivalEpoch: departureEpoch - DWELL_SECONDS * 1000,
                  terminalArrivalEpoch,
                  segment: located.segment,
                  segmentIndex: located.segmentIndex,
                  downstreamSeconds: located.downstreamSeconds,
                  remainingInSegmentAtFeed: remainingInSegment,
                  feedEpoch: receivedAt,
                  directionModel: direction,
                  stationOrder: targetIndex,
                  destinationOrder: resolved.destinationIndex,
                  lineColor: model.line.color,
                  targetEtaSeconds: etaSeconds,
                  positionAlongMeters: located.segment.distanceFromStart + located.segment.lengthMeters * progressAtFeed,
                  bearing: feedPosition ? feedPosition.bearing : 0
                };
              }
            } else {
              const located = locateSegment(direction, targetIndex, Math.max(0, etaSeconds));
              if (!located) continue;
              let terminalArrivalEpoch = etaLocalEpoch;
              for (let index = targetIndex; index < resolved.destinationIndex; index += 1) {
                terminalArrivalEpoch += (DWELL_SECONDS + direction.segments[index].travelSeconds) * 1000;
              }
              const remainingInSegment = etaSeconds - located.downstreamSeconds;
              const progressAtFeed = clamp(1 - remainingInSegment / located.segment.travelSeconds, 0, 1);
              candidate = {
                lineCode: item.lineCode,
                directionCode: direction.direction.code,
                destinationCode: resolved.destinationCode,
                routeCode: train.route || '',
                stationCode: item.stationCode,
                stoppedAtStation: false,
                stopAtStationAfterArrival: true,
                arrivalEpoch: etaLocalEpoch,
                departureEpoch: etaLocalEpoch + DWELL_SECONDS * 1000,
                terminalArrivalEpoch,
                segment: located.segment,
                segmentIndex: located.segmentIndex,
                downstreamSeconds: located.downstreamSeconds,
                remainingInSegmentAtFeed: remainingInSegment,
                feedEpoch: receivedAt,
                directionModel: direction,
                stationOrder: targetIndex,
                destinationOrder: resolved.destinationIndex,
                lineColor: model.line.color,
                targetEtaSeconds: etaSeconds,
                positionAlongMeters: located.segment.distanceFromStart + located.segment.lengthMeters * progressAtFeed,
                bearing: 0
              };
              const feedPosition = pointAlong(located.segment.coords, progressAtFeed);
              candidate.bearing = feedPosition ? feedPosition.bearing : 0;
            }
            candidates.push(candidate);
          }
        }
      }

      candidates.sort((a, b) => a.targetEtaSeconds - b.targetEtaSeconds);
      const unique = [];
      for (const candidate of candidates) {
        const duplicateIndex = unique.findIndex(existing => existing.lineCode === candidate.lineCode
          && existing.directionCode === candidate.directionCode
          && existing.destinationCode === candidate.destinationCode
          && Math.abs(existing.terminalArrivalEpoch - candidate.terminalArrivalEpoch) < 95000
          && Math.abs(existing.positionAlongMeters - candidate.positionAlongMeters) < 1400);
        if (duplicateIndex < 0) unique.push(candidate);
      }
      return unique;
    }

    function featureCollection(models, now) {
      const features = [];
      for (const train of models || []) {
        const position = interpolateAtNow(train, now);
        if (!position) continue;
        const line = lines.get(train.lineCode).line;
        features.push({
          type: 'Feature',
          properties: {
            trainKey: train.displayKey || [train.lineCode, train.directionCode, train.destinationCode, train.routeCode, Math.round(train.terminalArrivalEpoch / 60000)].join(':'),
            lineCode: train.lineCode,
            lineName: line.en,
            destinationCode: train.destinationCode,
            nextStopCode: position.nextStopCode,
            nextStopEtaSeconds: position.remainingToNextStopSeconds,
            atStation: !!position.atStation,
            directionCode: train.directionCode,
            estimated: true,
            lineColor: train.lineColor,
            bearing: position.bearing,
            progress: position.progress,
            etaMinutes: Math.max(0, Math.ceil((train.arrivalEpoch - now) / 60000)),
            sourceStationCode: train.stationCode,
            stoppedAtStation: train.stoppedAtStation
          },
          geometry: { type: 'Point', coordinates: position.coordinate }
        });
      }
      return { type: 'FeatureCollection', features };
    }

    return { targets, estimate, featureCollection };
  }

  window.MtrLiveTrains = { createEstimator };
})();
