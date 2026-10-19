(function (root) {
  'use strict';

  const KMB_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb/';
  const CITYBUS_BASE = 'https://rt.data.gov.hk/v2/transport/citybus/';
  const CITYBUS_V1_BASE = 'https://rt.data.gov.hk/v1/transport/citybus-nwfb/';
  const GMB_BASE = 'https://data.etagmb.gov.hk/';
  const MTR_URL = 'https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule';
  const HKKF_BASE = 'https://www.hkkfeta.com/';
  const words = {
    en: ['Live arrivals · public operators', 'Loading arrivals…', 'No reliable stop match. Live arrivals unavailable.', 'Arrival service unavailable. Please retry.', 'No arrival prediction available.', 'Updated', 'Due', 'min', 'Refresh', 'Last successful update'],
    tc: ['即時到站 · 公共交通營辦商', '正在載入到站時間…', '未能可靠配對車站，暫無即時到站資料。', '到站服務暫時無法連線，請重試。', '暫無預計到站時間。', '更新時間', '即將到站', '分鐘', '重新整理', '上次成功更新'],
    sc: ['实时到站 · 公共交通运营商', '正在加载到站时间…', '未能可靠匹配车站，暂无实时到站资料。', '到站服务暂时无法连接，请重试。', '暂无预计到站时间。', '更新时间', '即将到站', '分钟', '刷新', '上次成功更新']
  };
  const distance = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] + b[1]) * Math.PI / 360), a[1] - b[1]) * 111195;
  const key = r => [r.route, r.bound || r.dir, String(r.service_type)].join('|');
  const normalizeNamePart = name => String(name || '')
    .replace(/\([A-Z]{1,4}\d+\)|（[A-Z]{1,4}\d+）/gi, '')
    .replace(/[邨臺綫]/gu, character => ({ 邨: '村', 臺: '台', 綫: '线' })[character])
    .replace(/[\s\p{P}]/gu, '').toLowerCase();
  const nameParts = name => String(name || '').split(/[,，|]|<br\s*\/?\s*>/i)
    .map(normalizeNamePart).filter(Boolean);
  const normalizeName = name => nameParts(name)[0] || '';
  const sameStopName = (first, second) => {
    const firstParts = nameParts(first), secondParts = nameParts(second);
    return firstParts.some(part => part.length >= 3 && secondParts.includes(part));
  };
  let embeddedAgencies;
  function agencyForRoute(route) {
    if (route.agency || route.a) return route.agency || route.a;
    if (embeddedAgencies) return embeddedAgencies.get(String(route.id || route.number)) || '';
    embeddedAgencies = new Map();
    if (typeof document === 'undefined') return '';
    for (const script of document.scripts) {
      const source = script.textContent || '';
      if (!source.includes('const packed=')) continue;
      for (const match of source.matchAll(/"i":"([^"]+)","a":"([^"]+)"/g)) embeddedAgencies.set(match[1], match[2]);
    }
    return embeddedAgencies.get(String(route.id || route.number)) || '';
  }
  const isCitybusJointRoute = route => /(^|\+)CTB($|\+)/.test(agencyForRoute(route));

  function indexMetadata(stops, routeStops) {
    const byId = new Map(stops.map(s => [s.stop, s]));
    const groups = new Map(), atStop = new Map();
    for (const row of routeStops) {
      if (!byId.has(row.stop)) continue;
      const k = key(row);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(row);
      if (!atStop.has(row.stop)) atStop.set(row.stop, []);
      atStop.get(row.stop).push(row);
    }
    for (const group of groups.values()) group.sort((a, b) => Number(a.seq) - Number(b.seq));
    return { stops, byId, groups, atStop };
  }

  function matchStop(meta, station, routes) {
    const nearby = meta.stops.filter(stop => distance(station.coordinates, [+stop.long, +stop.lat]) <= 60);
    const selected = new Map(), unresolved = [];
    const name = normalizeName(station.name);
    for (const route of routes) for (const pair of route.neighbours.length ? route.neighbours : [{}]) {
      const candidates = new Map();
      for (const stop of nearby) for (const row of meta.atStop.get(stop.stop) || []) {
        if (row.route !== route.number) continue;
        const group = meta.groups.get(key(row)), position = group.indexOf(row);
        let checks = 0, neighbourDistance = 0, valid = true;
        for (const [offset, point] of [[-1, pair.before], [1, pair.after]]) {
          if (!point) continue;
          const other = meta.byId.get(group[position + offset]?.stop);
          const d = other ? distance(point, [+other.long, +other.lat]) : Infinity;
          if (d > 100) { valid = false; break; }
          checks++; neighbourDistance += d;
        }
        if (!valid || !checks) continue;
        const sameName = name && [stop.name_tc, stop.name_sc, stop.name_en].some(n => normalizeName(n) === name);
        const score = (sameName ? 80 : 0) - distance(station.coordinates, [+stop.long, +stop.lat]) - neighbourDistance / checks * 0.25;
        const k = key(row);
        if (!candidates.has(k)) candidates.set(k, []);
        candidates.get(k).push({ stop, row, score });
      }
      let resolved = false;
      for (const group of candidates.values()) {
        group.sort((a, b) => b.score - a.score);
        const best = group[0];
        if (group[1] && best.score - group[1].score < 20) continue;
        resolved = true;
        if (!selected.has(best.stop.stop)) selected.set(best.stop.stop, { stop: best.stop, rows: [] });
        const rows = selected.get(best.stop.stop).rows;
        const existing = rows.find(r => key(r) === key(best.row) && Number(r.seq) === Number(best.row.seq));
        const target = String(route.id || route.number);
        if (existing) { if (!existing.targets.includes(target)) existing.targets.push(target); }
        else rows.push({ ...best.row, targets: [target] });
      }
      if (!resolved) unresolved.push({ number: route.number, label: pair.label || route.number });
    }
    return { matches: [...selected.values()], unresolved: [...new Map(unresolved.map(r => [r.number + '|' + r.label, r])).values()] };
  }

  function filterEtas(rows, match) {
    const allowed = new Set(match.rows.map(r => key(r) + '|' + Number(r.seq)));
    return rows.filter(r => allowed.has(key(r) + '|' + Number(r.seq)))
      .sort((a, b) => String(a.route).localeCompare(String(b.route), 'en', { numeric: true }) || String(a.dir).localeCompare(String(b.dir)) || Number(a.eta_seq) - Number(b.eta_seq));
  }

  async function requestUrl(url, options = {}, signal) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 15000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); }
  }
  async function request(resource, signal) {
    const body = await requestUrl(KMB_BASE + resource, {}, signal);
    if (!Array.isArray(body.data)) throw new Error('Invalid API response');
    return body;
  }
  const dataArray = body => Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  const minutesFrom = value => {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.max(1, Math.ceil(value)) : null;
    if (typeof value !== 'string' || !value.trim()) return null;
    const text = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) > 0 ? Math.max(1, Math.ceil(Number(text))) : null;
    const time = Date.parse(text), remaining = time - Date.now();
    return Number.isFinite(time) && remaining > 0 ? Math.max(1, Math.ceil(remaining / 60000)) : null;
  };

  let metadata, metadataDay, pending;
  const day = () => Math.floor((Date.now() + 3 * 3600000) / 86400000);
  async function getMetadata() {
    if (metadata && metadataDay === day()) return metadata;
    if (pending) return pending;
    pending = (async () => {
      let saved;
      try { saved = JSON.parse(localStorage.getItem('kmb-metadata-v1')); } catch (_) { /* Storage can be disabled. */ }
      if (!saved || saved.day !== day() || !Array.isArray(saved.stops) || !Array.isArray(saved.routes)) {
        const [stops, routes] = await Promise.all([request('stop/'), request('route-stop/')]);
        saved = { day: day(), stops: stops.data, routes: routes.data };
        try { localStorage.setItem('kmb-metadata-v1', JSON.stringify(saved)); } catch (_) { /* Memory cache still works. */ }
      }
      metadata = indexMetadata(saved.stops, saved.routes); metadataDay = saved.day;
      return metadata;
    })();
    try { return await pending; } finally { pending = null; }
  }

  function etaFromCitybusBody(body) {
    return dataArray(body).map(row => minutesFrom(row.eta ?? row.estimated_arrival_time ?? row.arrivalTime))
      .filter(Number.isFinite).map(minutes => ({ minutes }));
  }
  async function citybusEta(route, options, signal) {
    const company = route.company || 'CTB';
    const citybusFetch = async path => requestUrl(CITYBUS_BASE + path, {}, signal).catch(() => requestUrl(CITYBUS_V1_BASE + path, {}, signal).catch(() => null));
    const stationId = String(options.station.id || '').padStart(6, '0');
    const direct = await citybusFetch('eta/' + encodeURIComponent(company) + '/' + encodeURIComponent(stationId) + '/' + encodeURIComponent(route.number));
    let values = direct ? etaFromCitybusBody(direct) : [];
    if (!values.length) {
      const seen = new Set();
      for (const p of route.patterns || []) {
        const direction = Number(p.direction) === 2 ? 'outbound' : 'inbound';
        const body = await citybusFetch('route-stop/' + encodeURIComponent(company) + '/' + encodeURIComponent(route.number) + '/' + direction);
        const rows = dataArray(body), stationName = normalizeName(options.station.name);
        const apiStop = rows.find(r => [r.name_en, r.name_tc, r.name_sc, r.stop_name_en, r.stop_name_tc, r.stop_name_sc, r.name].some(n => normalizeName(n) === stationName)) || rows.find(r => Number(r.seq || r.stop_seq) === p.stopIndex + 1) || rows[p.stopIndex];
        if (!apiStop?.stop) continue;
        const eta = await citybusFetch('eta/' + encodeURIComponent(company) + '/' + encodeURIComponent(apiStop.stop) + '/' + encodeURIComponent(route.number));
        for (const item of etaFromCitybusBody(eta)) { if (!seen.has(item.minutes)) { seen.add(item.minutes); values.push(item); } }
      }
    }
    if (!values.length && route.inferred) {
      const seen = new Set();
      for (const direction of ['inbound', 'outbound']) {
        const body = await citybusFetch('route-stop/' + encodeURIComponent(company) + '/' + encodeURIComponent(route.number) + '/' + direction);
        const stationName = normalizeName(options.station.name), rows = dataArray(body);
        let candidates = rows.filter(r => [r.name_en, r.name_tc, r.name_sc, r.stop_name_en, r.stop_name_tc, r.stop_name_sc, r.name].some(n => normalizeName(n) === stationName));
        if (!candidates.length && route.inferred) {
          const detailed = await Promise.all(rows.slice(0, 100).map(async row => {
            const stopId = row.stop || row.stop_id; if (!stopId) return null;
            const stop = await citybusFetch('stop/' + encodeURIComponent(stopId));
            const point = stop?.data; if (!point) return null;
            const d = distance(options.station.coordinates, [+point.long, +point.lat]);
            return { ...row, d, name_en: point.name_en, name_tc: point.name_tc, name_sc: point.name_sc };
          }));
          candidates = detailed.filter(Boolean).sort((a, b) => a.d - b.d).filter(row => row.d <= 120).slice(0, 2);
        }
        for (const candidate of candidates.slice(0, 2)) {
          const stopId = candidate.stop || candidate.stop_id;
          if (!stopId) continue;
          const eta = await citybusFetch('eta/' + encodeURIComponent(company) + '/' + encodeURIComponent(stopId) + '/' + encodeURIComponent(route.number));
          for (const item of etaFromCitybusBody(eta)) { if (!seen.has(item.minutes)) { seen.add(item.minutes); values.push(item); } }
        }
      }
    }
    return values;
  }
  function gmbCoordinates(body) {
    const data = body?.data || body || {}, point = data.coordinates?.wgs84 || data.coordinates || data;
    const lat = Number(point.latitude ?? point.lat), lon = Number(point.longitude ?? point.lon ?? point.lng);
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lon, lat] : null;
  }
  async function gmbEta(route, options, signal) {
    const values = [];
    const patterns = route.patterns || [];
    if (!patterns.length && route.inferred) {
      const matches = [];
      for (const routeSeq of [1, 2]) {
        const body = await requestUrl(GMB_BASE + 'route-stop/' + encodeURIComponent(route.routeId) + '/' + routeSeq, {}, signal).catch(() => null);
        const rows = body?.data?.route_stops || dataArray(body);
        const stationName = normalizeName(options.station.name);
        const details = await Promise.all(rows.map(async row => {
          const stopId = row.stop_id ?? row.stopId ?? row.stop;
          if (!stopId) return null;
          const named = [row.name_en, row.name_tc, row.name_sc, row.name].some(name => sameStopName(name, options.station.name));
          if (named) return { routeSeq, stopSeq: Number(row.stop_seq ?? row.stopSeq ?? row.seq), named: true };
          if (!Number.isFinite(options.station.coordinates[0])) return null;
          const stop = await requestUrl(GMB_BASE + 'stop/' + encodeURIComponent(stopId), {}, signal).catch(() => null);
          const point = gmbCoordinates(stop);
          return point ? { routeSeq, stopSeq: Number(row.stop_seq ?? row.stopSeq ?? row.seq), point, named: false } : null;
        }));
        const named = details.filter(Boolean).find(item => item.named);
        const closest = details.filter(item => item?.point).sort((a, b) => distance(a.point, options.station.coordinates) - distance(b.point, options.station.coordinates))[0];
        if (named) matches.push(named); else if (closest && Number.isFinite(options.station.coordinates[0]) && distance(closest.point, options.station.coordinates) <= 120) matches.push(closest);
      }
      route.patterns = matches;
    }
    for (const p of route.patterns || []) {
      const path = 'eta/route-stop/' + encodeURIComponent(route.routeId) + '/' + encodeURIComponent(p.routeSeq) + '/' + encodeURIComponent(p.stopSeq);
      const body = await requestUrl(GMB_BASE + path, {}, signal).catch(() => null);
      const data = body?.data, rows = Array.isArray(data) ? data : Array.isArray(data?.eta) ? data.eta : [];
      for (const row of rows) {
        const minutes = minutesFrom(row.diff ?? row.eta ?? row.timestamp);
        if (Number.isFinite(minutes)) values.push({ minutes, key: row.eta_seq || row.timestamp });
      }
    }
    return values;
  }
  function mtrStopGroups(routeName) {
    const line = String(routeName || '').toUpperCase(), groups = new Map();
    for (const row of root.MtrBusStops || []) {
      const routeId = String(row[0] || '').toUpperCase(), referenceId = String(row[8] || routeId).toUpperCase();
      if (![routeId, referenceId].some(id => id === line || id.startsWith(line + '-'))) continue;
      const groupKey = referenceId + '|' + String(row[1] || '');
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(row);
    }
    for (const rows of groups.values()) rows.sort((a, b) => Number(a[2]) - Number(b[2]));
    return [...groups.values()];
  }
  function mtrStopMatch(pattern, groups, options, liveStops) {
    const localStops = pattern.stops || [], index = Number(pattern.stopIndex), local = localStops[index];
    if (!local?.coordinates || !Number.isFinite(index)) return [];
    const candidates = [];
    for (const group of groups) for (let i = 0; i < group.length; i++) {
      const row = group[i], id = String(row[3] || ''), schedule = liveStops.get(id);
      if (!schedule) continue;
      const point = [+row[5], +row[4]], direct = distance(options.station.coordinates, point);
      const nameMatch = sameStopName(options.station.name, row[6]) || sameStopName(options.station.name, row[7]);
      if (direct > (nameMatch ? 240 : 140)) continue;
      let contextMatches = 0, contextDistance = 0;
      for (const offset of [-1, 1]) {
        const neighbour = localStops[index + offset];
        if (!neighbour?.coordinates) continue;
        const choices = group.filter((_, j) => offset < 0 ? j < i : j > i);
        const nearest = choices.reduce((best, candidate) => {
          const d = distance(neighbour.coordinates, [+candidate[5], +candidate[4]]);
          return d < best ? d : best;
        }, Infinity);
        if (nearest <= 140) { contextMatches++; contextDistance += nearest; }
      }
      candidates.push({ schedule, id, direct, nameMatch, contextMatches, contextDistance,
        score: direct - (nameMatch ? 35 : 0) + (contextMatches ? contextDistance / contextMatches * 0.35 : 35) });
    }
    candidates.sort((a, b) => b.contextMatches - a.contextMatches || a.score - b.score);
    const best = candidates[0];
    if (!best) return [];
    const runnerUp = candidates.find(candidate => candidate.id !== best.id);
    if (runnerUp && best.contextMatches === 0 && runnerUp.contextMatches === 0 && runnerUp.score - best.score < 24) return [];
    return [best.schedule];
  }
  function mtrMinutes(bus) {
    const arrivalRaw = bus.arrivalTimeInSecond;
    const arrival = arrivalRaw == null || String(arrivalRaw).trim() === '' ? NaN : Number(arrivalRaw);
    if (Number.isFinite(arrival) && arrival >= 0 && arrival < 108000) return Math.ceil(arrival / 60);
    const departureRaw = bus.departureTimeInSecond;
    const departure = departureRaw == null || String(departureRaw).trim() === '' ? NaN : Number(departureRaw);
    if (Number.isFinite(departure) && departure > 0 && departure < 108000) return Math.ceil(departure / 60);
    return minutesFrom(bus.arrivalTimeText);
  }
  async function mtrEta(route, options, signal, scheduleCache) {
    const language = options.lang === 'en' ? 'en' : 'zh', cacheKey = language + '|' + route.routeName;
    let schedule = scheduleCache?.get(cacheKey);
    if (!schedule) {
      schedule = requestUrl(MTR_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language, routeName: route.routeName }) }, signal).catch(() => null);
      scheduleCache?.set(cacheKey, schedule);
    }
    const body = await schedule;
    const busStops = Array.isArray(body?.busStop) ? body.busStop : [];
    const liveStops = new Map(busStops.map(stop => [String(stop.busStopId || ''), stop]));
    const groups = mtrStopGroups(route.routeName), matched = new Map();
    for (const pattern of route.patterns || []) for (const stop of mtrStopMatch(pattern, groups, options, liveStops)) matched.set(String(stop.busStopId), stop);
    const values = [];
    for (const [stopId, stop] of matched) for (const bus of stop.bus || []) {
      const minutes = mtrMinutes(bus);
      if (Number.isFinite(minutes)) values.push({ minutes, key: [stopId, bus.busId || bus.vehicleId || bus.busNo || minutes].join('|') });
    }
    return values;
  }
  function ferryRouteId(name) {
    const value = String(name || '');
    const central = /中環|Central/i.test(value), sok = /索罟灣|Sok Kwu Wan/i.test(value), yung = /榕樹灣|Yung Shue Wan/i.test(value), peng = /坪洲|Peng Chau/i.test(value), hei = /喜靈洲|Hei Ling Chau/i.test(value);
    if (central && sok) return 1;
    if (central && yung) return 2;
    if (central && peng) return 3;
    if (peng && hei) return 4;
    return null;
  }
  async function ferryEta(route, signal) {
    const id = ferryRouteId(route.name);
    if (!id) return [];
    const directions = Number.isFinite(route.stopIndex) ? [route.stopIndex <= 0 ? 'outbound' : 'inbound'] : ['outbound', 'inbound'];
    const rows = [];
    for (const direction of directions) { const body = await requestUrl(HKKF_BASE + 'opendata/eta/' + id + '/' + direction, {}, signal).catch(() => null); rows.push(...dataArray(body)); }
    return rows.map(row => minutesFrom(row.ETA ?? row.eta ?? row.diff)).filter(Number.isFinite).map(minutes => ({ minutes }));
  }
  async function providerValues(route, options, signal, meta, mtrScheduleCache) {
    if (route.provider === 'kmb') {
      const result = matchStop(meta, options.station, [route]);
      if (!result.matches.length) return [];
      const values = [];
      for (const match of result.matches) {
        const body = await request('stop-eta/' + encodeURIComponent(match.stop.stop), signal);
        const stamp = Date.parse(body.generated_timestamp);
        if (!Number.isFinite(stamp) || Date.now() - stamp > 120000) continue;
        for (const row of filterEtas(body.data, match)) {
          const minutes = minutesFrom(row.eta);
          if (Number.isFinite(minutes)) values.push({ minutes, key: [row.eta, row.dir, row.dest_en].join('|') });
        }
      }
      return values;
    }
    if (route.provider === 'citybus') return citybusEta(route, options, signal);
    if (route.provider === 'gmb') return gmbEta(route, options, signal);
    if (route.provider === 'mtr') return mtrEta(route, options, signal, mtrScheduleCache);
    if (route.provider === 'ferry') return ferryEta(route, signal);
    return [];
  }

  function mount(container, options) {
    const w = words[options.lang] || words.tc;
    const controls = document.createElement('span'); controls.className = 'eta-controls';
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'eta-refresh'; refresh.title = w[8]; refresh.setAttribute('aria-label', w[8]);
    refresh.innerHTML = '<svg viewBox="0 0 12 12" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M0.999324 6C0.999324 4.95059 1.32951 3.92778 1.94311 3.07645C2.55672 2.22512 3.42263 1.58844 4.41819 1.25658C5.41375 0.92473 6.48848 0.914531 7.49016 1.22743C8.49184 1.54033 9.36968 2.16047 9.99932 3H7.99932C7.86672 3 7.73954 3.05268 7.64577 3.14645C7.552 3.24021 7.49932 3.36739 7.49932 3.5C7.49932 3.63261 7.552 3.75979 7.64577 3.85355C7.73954 3.94732 7.86672 4 7.99932 4H10.9993C11.1319 4 11.2591 3.94732 11.3529 3.85355C11.4466 3.75979 11.4993 3.63261 11.4993 3.5V0.5C11.4993 0.367392 11.4466 0.240215 11.3529 0.146447C11.2591 0.0526785 11.1319 0 10.9993 0C10.8667 0 10.7395 0.0526785 10.6458 0.146447C10.552 0.240215 10.4993 0.367392 10.4993 0.5V2.031C9.58579 0.995509 8.34305 0.306811 6.98076 0.0810945C5.61847 -0.144622 4.22002 0.10646 3.02134 0.79198C1.82265 1.4775 0.897112 2.5555 0.400856 3.84411C-0.0954005 5.13271 -0.131993 6.55306 0.297251 7.86551C0.726495 9.17796 1.5953 10.3022 2.7571 11.0485C3.91889 11.7949 5.30256 12.1176 6.67466 11.9623C8.04677 11.8071 9.32332 11.1833 10.289 10.1962C11.2546 9.20912 11.8502 7.91918 11.9753 6.544C11.986 6.41251 11.9443 6.28213 11.8593 6.18125C11.7743 6.08037 11.6529 6.01718 11.5215 6.00544C11.3901 5.9937 11.2594 6.03436 11.1578 6.11857C11.0563 6.20277 10.9921 6.3237 10.9793 6.455C10.8642 7.73794 10.2585 8.92698 9.2883 9.77429C8.31811 10.6216 7.05836 11.0618 5.7716 11.0031C4.48484 10.9445 3.27036 10.3915 2.3813 9.45939C1.49224 8.52732 0.997183 7.28809 0.999324 6Z" fill="currentColor"/></svg>';
    const status = document.createElement('span'); status.className = 'eta-sr-only'; status.setAttribute('role', 'status'); status.textContent = w[1]; controls.append(refresh, status); container.append(controls);
    const baseRoutes = (options.routes || []).map(route => ({ ...route, provider: route.provider || 'kmb' }));
    const targets = new Map();
    for (const route of baseRoutes) {
      const id = String(route.id || route.number), element = options.targets?.[id]; if (!element) continue;
      const times = document.createElement('span'); times.className = 'eta-times'; times.title = w[1]; element.classList.add('has-eta'); element.append(times); targets.set(id, times);
    }
    const inferred = [];
    for (const button of container.parentElement?.querySelectorAll('button.route-link[data-route-id]') || []) {
      const id = String(button.dataset.routeId); if (targets.has(id)) continue;
      const number = button.querySelector('.route-badge')?.textContent?.trim() || id;
      const name = button.querySelector('.route-name')?.textContent?.trim() || '';
      let provider = 'citybus', route = { provider, id, number, company: 'CTB', inferred: true, name };
      if (/^20\d{4,}$/.test(id)) route = { provider: 'gmb', id, number, routeId: id, inferred: true, name };
      else if (/^18\d{2,}$/.test(id) || /^(?:506|K(?:12|14|17|18|51|51A|52|52A|52P|53|53S|54|54A|58|65|65A|66|68|73|74|75A|75P|75S|76|76S))$/i.test(number)) route = { provider: 'mtr', id, number, routeName: number, inferred: true, name };
      else if (/^7\d{3,}$/.test(id)) route = { provider: 'ferry', id, number, name: name || number, inferred: true };
      inferred.push(route);
      const element = options.targets?.[id] || button, times = document.createElement('span'); times.className = 'eta-times'; times.title = w[1]; element.classList.add('has-eta'); element.append(times); targets.set(id, times);
    }
    const jointCitybusRoutes = baseRoutes.filter(isCitybusJointRoute).map(route => ({ ...route, provider: 'citybus', company: 'CTB', inferred: true }));
    const allRoutes = baseRoutes.concat(jointCitybusRoutes, inferred);
    let disposed = false, timer, controller, busy = false, lastSuccess;
    const time = stamp => new Date(stamp).toLocaleTimeString(options.lang === 'en' ? 'en-GB' : 'zh-HK', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    function clear(message) { for (const element of targets.values()) { element.replaceChildren(); element.title = message; } }
    function dispose() { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', visibility); observer.disconnect(); }
    const observer = new MutationObserver(() => { if (!controls.isConnected) dispose(); }); observer.observe(document.body, { childList: true, subtree: true });
    async function update() {
      if (disposed || busy || document.hidden) return;
      clearTimeout(timer); busy = true; refresh.disabled = true; controller = new AbortController();
      try {
        const needKmb = allRoutes.some(r => r.provider === 'kmb');
        const meta = needKmb ? await getMetadata() : null; if (disposed) return;
        clear(w[1]); const unavailable = [], allValues = new Map(), stamp = Date.now();
        const mtrScheduleCache = new Map();
        await Promise.all(allRoutes.map(async route => {
          try {
            const values = await providerValues(route, { ...options, station: { ...options.station, id: options.station.id } }, controller.signal, meta, mtrScheduleCache);
            if (!values.length) { unavailable.push(route.number || route.name || route.routeName); return; }
            const id = String(route.id || route.number);
            allValues.set(id, (allValues.get(id) || []).concat(values));
          } catch (_) { unavailable.push(route.number || route.name || route.routeName); }
        }));
        if (disposed) return;
        if (!allValues.size) throw new Error('No fresh arrivals');
        for (const [id, values] of allValues) {
          const element = targets.get(id); if (!element) continue;
          const seen = new Set(); values.sort((a, b) => a.minutes - b.minutes);
          for (const value of values) {
            const unique = value.key || String(value.minutes); if (seen.has(unique)) continue; seen.add(unique);
            if (element.childElementCount >= 3) break;
            const prediction = document.createElement('span'); prediction.className = 'eta-time eta-' + (value.minutes <= 5 ? 'soon' : value.minutes <= 15 ? 'later' : 'distant'); prediction.textContent = String(value.minutes);
            const label = String(value.minutes) + ' ' + w[7] + ' · ' + routeLabelFor(allRoutes, id); prediction.title = label; prediction.setAttribute('aria-label', label); element.append(prediction);
          }
        }
        lastSuccess = new Date(stamp).toISOString(); status.textContent = w[5] + ': ' + time(lastSuccess) + ' HKT';
        if (unavailable.length) status.textContent += ' · ' + (options.lang === 'en' ? 'Unavailable: ' : options.lang === 'sc' ? '暂无到站资料：' : '暫無到站資料：') + [...new Set(unavailable)].join(' / ');
        refresh.title = w[8] + ' · ' + w[5] + ': ' + time(lastSuccess) + ' HKT';
      } catch (_) { if (!disposed) { clear(w[3]); status.textContent = w[3] + (lastSuccess ? ' ' + w[9] + ': ' + time(lastSuccess) + ' HKT' : ''); } }
      finally { busy = false; refresh.disabled = false; if (!disposed && !document.hidden) timer = setTimeout(update, 60000); }
    }
    function visibility() { clearTimeout(timer); if (!document.hidden) update(); else controller?.abort(); }
    document.addEventListener('visibilitychange', visibility); refresh.addEventListener('click', update); update(); return dispose;
  }
  function routeLabelFor(routes, id) { const route = (routes || []).find(r => String(r.id || r.number) === String(id)); return route?.number || route?.routeName || ''; }

  function installAutoMount() {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const scan = () => {
      for (const container of document.querySelectorAll('.routes > div')) {
        if (container.querySelector('.eta-controls')) continue;
        const detail = container.closest('.detail'), buttons = [...(detail || container.parentElement).querySelectorAll('button.route-link[data-route-id]')];
        if (!buttons.length) continue;
        const targets = Object.fromEntries(buttons.map(button => [button.dataset.routeId, button]));
        const stationName = detail?.querySelector('strong')?.textContent?.trim() || '';
        mount(container, { lang: document.documentElement.lang || 'tc', station: { coordinates: [NaN, NaN], name: stationName }, routes: [], targets });
      }
    };
    const start = () => { scan(); new MutationObserver(scan).observe(document.body, { childList: true, subtree: true }); };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  const api = { mount, indexMetadata, matchStop, filterEtas, distance, minutesFrom, ferryRouteId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.KmbEta = api; root.TransitEta = api; installAutoMount(); }
})(typeof window !== 'undefined' ? window : globalThis);
