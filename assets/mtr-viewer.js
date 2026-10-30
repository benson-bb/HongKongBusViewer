(function () {
  'use strict';

  const DATA_URL = 'assets/mtr-network.json';
  const MTR_3D_DATA_URL = 'data/mtr-3d-railway.geojson';
  const ETA_URL = 'https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php';
  const REFRESH_MS = 20000;
  const ETA_RESPONSE_CACHE_TTL_MS = 5 * 60 * 1000;
  const TRAIN_REFRESH_MS = 30000;
  const TRAIN_RESPONSE_CACHE_TTL_MS = 3 * 60 * 1000;
  const TRAIN_MODEL_RETENTION_MS = 5 * 60 * 1000;
  const TRAIN_REQUEST_CONCURRENCY = 1;
  const TRAIN_REQUEST_GAP_MS = 350;
  const labels = {
    tc: {
      title: '香港港鐵路線圖', loading: '載入港鐵路線…', count: '條路線 · 個車站',
      basemap: '底圖', line: '路線', all: '全部路線', search: '搜尋',
      placeholder: '搜尋路線或車站', hideStations: '隱藏車站', showStations: '顯示車站',
      trainPositionsOn: '列車位置：開', trainPositionsOff: '列車位置：關', trainPositionsTitle: '按實時到站時間及路線長度推算位置，並非 GPS', trainLegend: '推算列車位置（非 GPS）', trainLegendLoading: '正在讀取列車到站資料…', trainLegendEmpty: '暫無可推算列車位置', trainLegendUnavailable: '暫時未能取得列車資料',
      rail3DOn: '3D 鐵路：開', rail3DOff: '3D 鐵路：關', rail3DTitle: '顯示按月台高度建立的港鐵立體路線', rail3DControls: '3D 設定', rail3DCollapse: '收起 3D 設定', rail3DExpand: '展開 3D 設定', rail3DOpacity: '底圖不透明度', rail3DExaggeration: '垂直誇大', rail3DLoading: '正在載入立體路線…', rail3DError: '暫時無法載入立體路線資料', rail3DStatus: '月台高度及範圍來自地政總署 CSDI；站間高度為平滑推算。', rail3DLegend: '站間高程為推算 · 青綠色輪廓為 CSDI 月台',
      trainNextStop: '下一站', trainNextEta: '預計到站', trainAtStation: '列車停靠中', trainEnRoute: '行駛中', trainTerminal: '終點站', trainEstimateNote: '位置及到站時間按 ETA 與路段距離推算，並非 GPS。',
      instruction: '選擇路線或車站查看資料及實時到站時間。',
      panelTitle: '路線車站', direction: '方向', noResults: '找不到相符路線或車站',
      chooseLine: '選擇路線', chooseStation: '選擇車站', trains: '列車到站時間',
      loadingEta: '正在載入實時資料…', refreshingEta: '更新中…', noTrains: '暫時沒有班次資料',
      unavailable: '暫時未能取得到站時間', updated: '更新時間', min: '分鐘',
      due: '即將到站', up: '上行', down: '下行', platform: '月台',
      delayed: '列車時間可能延誤', update: '更新到站時間',
      special: '港鐵目前有特別行車安排。', lineCount: '條路線', stationCount: '個車站',
      departure: '開出', arrival: '到達', network: '港鐵路線',
      fareCard: '八達通類別', fareOn: '車費：開', fareOff: '車費：關',
      fareTitle: '各站八達通車費', fareFrom: '由 {station} 出發', fareUnavailable: '此類別未有官方車費資料',
      hideEta: '隱藏到站資料', showEta: '顯示到站資料',
      adult: '成人', student: '學生', child: '小童', elderly: '長者', joyyou60: '樂悠咭 60+', disability: '殘疾人士'
    },
    en: {
      title: 'Hong Kong MTR Map', loading: 'Loading MTR lines…', count: 'lines · stations',
      basemap: 'Basemap', line: 'Line', all: 'All lines', search: 'Search',
      placeholder: 'Search a line or station', hideStations: 'Hide stations', showStations: 'Show stations',
      trainPositionsOn: 'Train positions: On', trainPositionsOff: 'Train positions: Off', trainPositionsTitle: 'Estimated from live ETAs and route lengths; not GPS positions', trainLegend: 'Estimated train positions (not GPS)', trainLegendLoading: 'Loading train ETAs…', trainLegendEmpty: 'No positions can be estimated right now', trainLegendUnavailable: 'Train data is temporarily unavailable',
      rail3DOn: '3D rail: On', rail3DOff: '3D rail: Off', rail3DTitle: 'Show MTR tracks at platform-based elevations', rail3DControls: '3D settings', rail3DCollapse: 'Collapse 3D settings', rail3DExpand: 'Expand 3D settings', rail3DOpacity: 'Basemap opacity', rail3DExaggeration: 'Vertical exaggeration', rail3DLoading: 'Loading 3D rail geometry…', rail3DError: '3D rail data could not be loaded', rail3DStatus: 'Platform elevations and outlines are from Lands Department CSDI; heights between stations are smoothed estimates.', rail3DLegend: 'Estimated track heights · teal outlines are CSDI platforms',
      trainNextStop: 'Next stop', trainNextEta: 'Estimated arrival', trainAtStation: 'At station', trainEnRoute: 'En route', trainTerminal: 'Terminus', trainEstimateNote: 'Position and arrival time are estimated from ETAs and segment lengths, not GPS.',
      instruction: 'Select a line or station to view details and live arrivals.',
      panelTitle: 'Line stations', direction: 'Direction', noResults: 'No matching lines or stations',
      chooseLine: 'Select a line', chooseStation: 'Select a station', trains: 'Train arrivals',
      loadingEta: 'Loading live information…', refreshingEta: 'Refreshing…', noTrains: 'No train times are available now',
      unavailable: 'Arrival information is temporarily unavailable', updated: 'Updated',
      due: 'Due', min: 'min', up: 'UP', down: 'DOWN', platform: 'Platform',
      delayed: 'Train times may be delayed', update: 'Refresh arrivals',
      special: 'MTR has special train service arrangements.', lineCount: 'lines', stationCount: 'stations',
      departure: 'Departing', arrival: 'Arriving', network: 'MTR network',
      fareCard: 'Octopus type', fareOn: 'Fares: On', fareOff: 'Fares: Off',
      fareTitle: 'Octopus fares to stations', fareFrom: 'From {station}', fareUnavailable: 'Official fare unavailable for this type',
      hideEta: 'Hide arrival information', showEta: 'Show arrival information',
      adult: 'Adult', student: 'Student', child: 'Child', elderly: 'Elderly', joyyou60: 'JoyYou 60+', disability: 'Disability'
    }
  };

  const el = {
    map: document.getElementById('map'),
    mapShell: document.querySelector('.map-shell'),
    error: document.getElementById('error'),
    pageTitle: document.getElementById('page-title'),
    count: document.getElementById('count'),
    basemap: document.getElementById('basemap'),
    lineSelect: document.getElementById('line-select'),
    search: document.getElementById('search'),
    searchResults: document.getElementById('search-results'),
    toggleStations: document.getElementById('toggle-stations'),
    toggleTrains: null,
    trainLegendItem: document.getElementById('train-legend-item'),
    trainLegendLabel: document.getElementById('train-legend-label'),
    rail3DLegend: document.getElementById('railway-3d-legend'),
    rail3DLegendLabel: document.getElementById('railway-3d-legend-label'),
    language: document.getElementById('language'),
    theme: document.getElementById('theme-toggle'),
    toolbar: document.getElementById('toolbar'),
    toolbarToggle: document.getElementById('toolbar-toggle'),
    detail: document.getElementById('detail'),
    instruction: document.getElementById('instruction'),
    panel: document.getElementById('route-panel'),
    panelTitle: document.getElementById('route-panel-title'),
    panelSubtitle: document.getElementById('route-panel-subtitle'),
    panelClose: document.getElementById('panel-close'),
    fareControls: document.getElementById('fare-controls'),
    fareCardControl: document.getElementById('fare-card-control'),
    fareCardLabel: document.getElementById('fare-card-label'),
    fareCard: document.getElementById('fare-card'),
    toggleFares: document.getElementById('toggle-fares'),
    fareLegend: document.getElementById('fare-legend'),
    fareLegendTitle: document.getElementById('fare-legend-title'),
    fareClasses: document.getElementById('fare-classes'),
    fareNote: document.getElementById('fare-note'),
    directionLabel: document.getElementById('direction-label'),
    directionSelect: document.getElementById('direction-select'),
    stationList: document.getElementById('station-list'),
    basemapLabel: document.getElementById('basemap-label'),
    lineLabel: document.getElementById('line-label'),
    searchLabel: document.getElementById('search-label')
  };

  let data, fareData, map, lang = 'tc', theme = 'light', selectedLine = null, selectedStation = null;
  let stationVisible = true, selectedDirection = null, etaController = null, etaTimer = null, etaCountdownTimer = null;
  let trainLocationsEnabled = false, trainLocationTimer = null, trainAnimationTimer = null;
  let trainLocationController = null, trainFetchToken = 0, trainFetchInProgress = false, trainLineSignature = '';
  let trainRetryAfter = 0;
  let trainFetchErrorCount = 0, trainHasFetched = false, trainVisibleCount = 0;
  let trainEstimator = null, trainLocationModels = [];
  const etaResponseCache = new Map();
  const trainResponseCache = new Map();
  const trainMarkers = new Map();
  const trainMarkerInfo = new Map();
  let trainPopup = null, openTrainKey = null, trainFollowKey = null, openTrainPopupHtml = '';
  let rail3DLayer = null, rail3DEnabled = false, rail3DData = null, rail3DDataPromise = null;
  let rail3DFilterCodes = null, rail3DOpacity = 0.48, rail3DExaggeration = 2, rail3DPreviousCamera = null;
  let rail3DControlButton = null, rail3DControlPanel = null, rail3DPanelContent = null, rail3DPanelCollapseButton = null;
  let rail3DStatus = null, rail3DOpacityValue = null, rail3DExaggerationValue = null, rail3DPanelCollapsed = false;
  const baseStylePaint = new Map();
  let fareMode = false, etaDetailsVisible = true, etaRouteFilter = null;
  const etaDirectionFilters = new Map();
  const lineByCode = new Map(), stationByCode = new Map(), stationsByCode = new Map(), fareByPair = new Map();
  const farePalette = ['#fde725', '#b5de2b', '#6ece58', '#35b779', '#1f9e89', '#26828e', '#31688e', '#3e4989', '#482878', '#440154'];

  const t = key => labels[lang][key] || key;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const lineName = line => lang === 'en' ? line.en : line.zh;
  const stopName = stop => lang === 'en' ? stop.en : stop.zh;
  const locale = () => lang === 'en' ? 'en-HK' : 'zh-HK';

  function setTheme(next) {
    theme = next;
    document.documentElement.dataset.theme = next;
    el.theme.setAttribute('aria-pressed', String(next === 'dark'));
    el.theme.setAttribute('aria-label', next === 'dark' ? 'Switch to light mode' : '切換深色模式');
    try { localStorage.setItem('mtr-viewer-theme', next); } catch (_) {}
  }

  function updateGeolocateLabel() {
    if (!map) return;
    const button = map.getContainer().querySelector('.maplibregl-ctrl-geolocate');
    if (!button) return;
    const label = lang === 'en' ? 'Find my location' : '尋找我的位置';
    button.title = label;
    button.setAttribute('aria-label', label);
  }

  function stationKey(code) {
    return String(code || '').trim().toUpperCase();
  }

  function formatFare(value) {
    if (!Number.isFinite(value)) return '—';
    return 'HK$' + (Number.isInteger(value) ? value : value.toFixed(1));
  }

  function naturalFareClasses(values, maximumClasses = 5) {
    const counts = new Map();
    for (const value of values) {
      if (Number.isFinite(value) && value >= 0) counts.set(value, (counts.get(value) || 0) + 1);
    }
    const unique = [...counts.keys()].sort((a, b) => a - b);
    const size = unique.length;
    const classCount = Math.min(maximumClasses, size);
    if (!classCount) return [];

    const prefixWeight = [0], prefixSum = [0], prefixSquares = [0];
    for (const value of unique) {
      const weight = counts.get(value);
      prefixWeight.push(prefixWeight[prefixWeight.length - 1] + weight);
      prefixSum.push(prefixSum[prefixSum.length - 1] + value * weight);
      prefixSquares.push(prefixSquares[prefixSquares.length - 1] + value * value * weight);
    }
    const segmentVariance = (start, end) => {
      const weight = prefixWeight[end] - prefixWeight[start];
      const sum = prefixSum[end] - prefixSum[start];
      const squares = prefixSquares[end] - prefixSquares[start];
      return Math.max(0, squares - sum * sum / weight);
    };
    const costs = Array.from({ length: classCount + 1 }, () => Array(size + 1).fill(Infinity));
    const starts = Array.from({ length: classCount + 1 }, () => Array(size + 1).fill(-1));
    costs[0][0] = 0;
    for (let classes = 1; classes <= classCount; classes++) {
      for (let end = classes; end <= size; end++) {
        for (let start = classes - 1; start < end; start++) {
          const prior = costs[classes - 1][start];
          if (!Number.isFinite(prior)) continue;
          const cost = prior + segmentVariance(start, end);
          if (cost < costs[classes][end]) {
            costs[classes][end] = cost;
            starts[classes][end] = start;
          }
        }
      }
    }
    const ranges = Array(classCount);
    let end = size;
    for (let classes = classCount; classes > 0; classes--) {
      const start = starts[classes][end];
      ranges[classes - 1] = { min: unique[start], max: unique[end - 1] };
      end = start;
    }
    return ranges.map((range, index) => ({
      ...range,
      color: farePalette[ranges.length === 1 ? Math.floor(farePalette.length / 2) : Math.round(index * (farePalette.length - 1) / (ranges.length - 1))]
    }));
  }

  function fareClassColor(value, classes) {
    if (!Number.isFinite(value)) return '#64748b';
    const match = classes.find(item => value <= item.max);
    return (match || classes[classes.length - 1] || {}).color || '#64748b';
  }

  function updateFareControls() {
    const visible = !!selectedStation;
    el.fareControls.hidden = !visible;
    el.toggleFares.textContent = fareMode ? t('fareOn') : t('fareOff');
    el.toggleFares.setAttribute('aria-pressed', String(fareMode));
    el.toggleFares.setAttribute('aria-label', fareMode ? t('fareOn') : t('fareOff'));
    el.toggleFares.setAttribute('aria-expanded', String(fareMode));
    el.fareCardControl.hidden = !fareMode;
    el.fareCardLabel.textContent = t('fareCard');
    for (const option of el.fareCard.options) option.textContent = t(option.value);
    el.fareLegend.hidden = !fareMode;
    el.fareLegendTitle.textContent = t('fareTitle');
    el.mapShell.classList.toggle('has-fare-controls', visible);
    el.mapShell.classList.toggle('fares-on', visible && fareMode);
    if (!visible) el.fareNote.textContent = '';
  }

  function updateFareDisplay() {
    if (!map || !map.getSource('mtr-fares') || !selectedStation || !fareMode) return;
    const origin = stationKey(selectedStation.feature.properties.code);
    const fareIndex = (fareData.cardTypes || []).indexOf(el.fareCard.value) + 2;
    const features = data.stations.features.map(feature => {
      const destination = stationKey(feature.properties.code);
      const row = fareByPair.get(origin + '|' + destination);
      const fare = row && fareIndex >= 2 ? row[fareIndex] : null;
      return {
        type: 'Feature',
        properties: { ...feature.properties, fare: Number.isFinite(fare) ? fare : null },
        geometry: feature.geometry
      };
    });
    const values = features.filter(feature => feature.properties.code !== origin)
      .map(feature => feature.properties.fare)
      .filter(value => Number.isFinite(value) && value >= 0);
    const fareClasses = naturalFareClasses(values);
    for (const feature of features) {
      const properties = feature.properties;
      const name = lang === 'en' ? properties.en : properties.zh;
      const fare = properties.fare;
      properties.fareColor = properties.code === origin ? '#172033' : fareClassColor(fare, fareClasses);
      properties.fareLabel = name + '\n' + formatFare(fare);
    }
    map.getSource('mtr-fares').setData({ type: 'FeatureCollection', features });
    const originName = lang === 'en' ? selectedStation.feature.properties.en : selectedStation.feature.properties.zh;
    el.fareNote.textContent = t('fareFrom').replace('{station}', originName) + ' · ' + t(el.fareCard.value) + (values.length ? '' : ' · ' + t('fareUnavailable'));
    el.fareClasses.innerHTML = fareClasses.map(item => {
      const range = formatFare(item.min) + (item.max === item.min ? '' : '–' + formatFare(item.max));
      return '<div class="fare-class" role="listitem"><span class="fare-class-swatch" style="background:' + item.color + '" aria-hidden="true"></span><span>' + esc(range) + '</span></div>';
    }).join('');
    updateFareControls();
  }

  function setMapStationVisibility() {
    if (!map) return;
    const visible = stationVisible;
    const settings = {
      stations: visible && !fareMode,
      'station-hit': visible,
      'station-labels': visible && !fareMode,
      'fare-stations': visible && fareMode,
      'fare-station-labels': visible && fareMode,
      'selected-station': !!selectedStation
    };
    for (const [id, show] of Object.entries(settings)) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
    }
  }

  function setFareMode(enabled) {
    fareMode = !!enabled && !!selectedStation;
    if (fareMode) {
      setRouteFilter(null);
      setStationFilter(null);
      updateFareDisplay();
    } else if (selectedStation) {
      setRouteFilter(selectedStation.lineCodes);
      setStationFilter(stationCodesForLines(selectedStation.lineCodes));
      if (map && map.getSource('mtr-fares')) map.getSource('mtr-fares').setData({ type: 'FeatureCollection', features: [] });
    } else if (selectedLine) {
      setRouteFilter([selectedLine.code]);
      setStationFilter(stationCodesForLines([selectedLine.code]));
    } else {
      setRouteFilter(null);
      setStationFilter(null);
    }
    updateFareControls();
    setMapStationVisibility();
    syncTrainLocationScope();
  }

  function fillLineOptions() {
    const all = document.createElement('option');
    all.value = '';
    all.textContent = t('all');
    el.lineSelect.replaceChildren(all);
    for (const line of data.lines) {
      const option = document.createElement('option');
      option.value = line.code;
      option.textContent = line.code + ' · ' + lineName(line);
      el.lineSelect.append(option);
    }
  }

  function applyLanguage() {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant';
    document.title = t('title');
    el.pageTitle.textContent = t('title');
    el.basemapLabel.textContent = t('basemap');
    el.lineLabel.textContent = t('line');
    el.searchLabel.textContent = t('search');
    el.search.placeholder = t('placeholder');
    el.toggleStations.textContent = stationVisible ? t('hideStations') : t('showStations');
    updateTrainToggle();
    updateRail3DControl();
    updateGeolocateLabel();
    el.directionLabel.textContent = t('direction');
    el.language.value = lang;
    updateFareControls();
    if (data) {
      fillLineOptions();
      el.lineSelect.value = selectedLine ? selectedLine.code : '';
      el.count.textContent = data.lines.length + ' ' + t('lineCount') + ' · ' + data.stations.features.length + ' ' + t('stationCount');
      if (selectedLine) showLine(selectedLine, false);
      if (selectedStation) {
        const old = selectedStation;
        const wasFareMode = fareMode;
        selectStation(old.feature, old.lineCodes, false);
        if (wasFareMode) setFareMode(true);
        if (map && map.getLayer('station-labels')) map.setLayoutProperty('station-labels', 'text-field', ['get', lang === 'en' ? 'en' : 'zh']);
      }
    }
    if (map && map.getLayer('station-labels')) {
      map.setLayoutProperty('station-labels', 'text-field', ['get', lang === 'en' ? 'en' : 'zh']);
    }
    if (fareMode) updateFareDisplay();
    if (selectedStation) refreshEta();
    renderSearchResults();
  }

  function lineBadge(line, extraClass) {
    return '<span class="line-badge' + (extraClass ? ' ' + extraClass : '') + '" style="background:' + esc(line.color) + '">' + esc(line.code) + '</span>';
  }

  function stationCodesForLines(codes) {
    const stations = new Set();
    for (const code of codes || []) {
      const line = lineByCode.get(code);
      if (!line) continue;
      for (const direction of line.directions) for (const stop of direction.stations) stations.add(stop.code);
    }
    return [...stations];
  }

  function setRouteFilter(codes) {
    rail3DFilterCodes = codes && codes.length ? codes.slice() : null;
    if (rail3DLayer) rail3DLayer.setFilter(rail3DFilterCodes);
    if (!map || !map.getLayer('route-lines')) return;
    const codeFilter = codes && codes.length ? ['match', ['get', 'code'], codes, true, false] : null;
    const isBranch = ['boolean', ['get', 'branch'], false];
    const mainFilter = codeFilter ? ['all', codeFilter, ['!', isBranch]] : ['!', isBranch];
    const branchFilter = codeFilter ? ['all', codeFilter, isBranch] : isBranch;
    if (map.getLayer('route-lines')) map.setFilter('route-lines', mainFilter);
    if (map.getLayer('route-casing')) map.setFilter('route-casing', mainFilter);
    if (map.getLayer('route-branch-lines')) map.setFilter('route-branch-lines', branchFilter);
    if (map.getLayer('route-branch-casing')) map.setFilter('route-branch-casing', branchFilter);
    if (map.getLayer('route-hit')) map.setFilter('route-hit', codeFilter);
  }

  function setStationFilter(codes) {
    if (!map || !map.getLayer('stations')) return;
    const filter = codes && codes.length ? ['in', ['get', 'code'], ['literal', codes]] : null;
    map.setFilter('stations', filter);
    if (map.getLayer('station-hit')) map.setFilter('station-hit', filter);
    if (map.getLayer('station-labels')) map.setFilter('station-labels', filter);
    if (map.getLayer('fare-stations')) map.setFilter('fare-stations', filter);
    if (map.getLayer('fare-station-labels')) map.setFilter('fare-station-labels', filter);
  }

  function filterLine(code, shouldFit) {
    selectedLine = code ? lineByCode.get(code) || null : null;
    el.lineSelect.value = selectedLine ? selectedLine.code : '';
    setRouteFilter(selectedLine ? [selectedLine.code] : null);
    setStationFilter(selectedLine ? stationCodesForLines([selectedLine.code]) : null);
    if (shouldFit && selectedLine) fitLine(selectedLine);
    if (!selectedLine && shouldFit && map) map.flyTo({ center: [114.16, 22.34], zoom: 9.7, duration: 600 });
    syncTrainLocationScope();
  }

  function fitLine(line) {
    if (!line || !line.geometry || !map) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const segment of line.geometry.coordinates || []) {
      for (const coordinate of segment) bounds.extend(coordinate);
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: { top: 45, right: 340, bottom: 80, left: 45 }, maxZoom: 13.2, duration: 500 });
  }

  function directionText(direction) {
    if (!direction.stations.length) return direction.code;
    return stopName(direction.stations[0]) + ' → ' + stopName(direction.stations[direction.stations.length - 1]);
  }

  function setPanelOpen(open) {
    el.panel.classList.toggle('open', open);
    el.panel.setAttribute('aria-hidden', String(!open));
  }

  function renderLineDetail(line) {
    if (!line) return;
    el.detail.classList.remove('muted');
    el.detail.classList.remove('eta-collapsed');
    el.detail.innerHTML = '<h3>' + lineBadge(line) + '<span>' + esc(lineName(line)) + '</span></h3><div class="station-meta">' + esc(line.code) + ' · ' + line.directions.length + ' ' + esc(lang === 'en' ? 'service patterns' : '個行車方向') + '</div><div class="eta-note">' + esc(lang === 'en' ? 'Select a station to see live arrivals.' : '選擇車站查看實時到站時間。') + '</div>';
  }

  function updateEtaToggle() {
    const toggle = el.detail.querySelector('.detail-eta-toggle');
    el.detail.classList.toggle('eta-collapsed', !!toggle && !etaDetailsVisible);
    if (!toggle) return;
    const label = t(etaDetailsVisible ? 'hideEta' : 'showEta');
    toggle.setAttribute('aria-expanded', String(etaDetailsVisible));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  }

  function showLine(line, shouldFit) {
    if (!line) return;
    if (etaController) etaController.abort();
    etaController = null;
    selectedStation = null;
    fareMode = false;
    updateFareControls();
    if (map && map.getLayer('selected-station')) map.setFilter('selected-station', ['==', ['get', 'code'], '']);
    selectedLine = line;
    el.lineSelect.value = line.code;
    filterLine(line.code, false);
    if (shouldFit) fitLine(line);
    el.panelTitle.innerHTML = lineBadge(line) + '<span>' + esc(lineName(line)) + '</span>';
    el.panelSubtitle.textContent = line.code + ' · ' + line.directions.length + ' ' + (lang === 'en' ? 'directions' : '個方向');
    const current = selectedDirection || (line.directions[0] && line.directions[0].code);
    el.directionSelect.replaceChildren();
    for (const direction of line.directions) {
      const option = document.createElement('option');
      option.value = direction.code;
      option.textContent = directionText(direction);
      el.directionSelect.append(option);
    }
    selectedDirection = line.directions.some(direction => direction.code === current) ? current : (line.directions[0] && line.directions[0].code);
    el.directionSelect.value = selectedDirection || '';
    renderStationList();
    setPanelOpen(true);
    renderLineDetail(line);
    if (shouldFit) el.search.value = '';
  }

  function renderStationList() {
    const direction = selectedLine && selectedLine.directions.find(item => item.code === selectedDirection);
    if (!direction) { el.stationList.replaceChildren(); return; }
    const fragment = document.createDocumentFragment();
    for (const stop of direction.stations) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'station-row' + (selectedStation && selectedStation.feature.properties.code === stop.code ? ' selected' : '');
      button.dataset.stationCode = stop.code;
      button.dataset.lineCode = selectedLine.code;
      button.innerHTML = '<span class="sequence">' + String(stop.sequence).padStart(2, '0') + '</span><span class="station-name">' + esc(stopName(stop)) + '<small>' + esc(lang === 'en' ? stop.zh : stop.en) + '</small></span>';
      fragment.append(button);
    }
    el.stationList.replaceChildren(fragment);
  }

  function stationNameFromCode(code) {
    const station = stationByCode.get(stationKey(code));
    return station ? stopName(station) : code;
  }

  function formatTime(value) {
    if (!value) return '—';
    const parsed = new Date(String(value).replace(' ', 'T') + '+08:00');
    if (Number.isNaN(parsed.getTime())) return String(value);
    return new Intl.DateTimeFormat(locale(), { timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false }).format(parsed);
  }

  function parseHkEpoch(value) {
    if (!value) return NaN;
    const text = String(value).trim();
    const normalized = text.includes('T') ? text : text.replace(' ', 'T');
    const parsed = new Date(normalized + (/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? '' : '+08:00'));
    return parsed.getTime();
  }

  function minutesUntil(train, schedule, receivedAt) {
    const arrival = parseHkEpoch(train.time);
    const current = (schedule && (schedule.curr_time || schedule.sys_time)) || '';
    const serverNow = parseHkEpoch(current);
    const now = Number.isFinite(serverNow)
      ? serverNow + (Number.isFinite(receivedAt) ? Math.max(0, Date.now() - receivedAt) : 0)
      : Date.now();
    if (Number.isFinite(arrival) && Number.isFinite(now)) return Math.max(0, Math.ceil((arrival - now) / 60000));
    const numeric = Number(train.ttnt);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
  }

  function relativeText(minutes) {
    if (minutes === null) return '—';
    if (minutes <= 0) return t('due');
    return minutes + ' ' + t('min');
  }

  function formatUpdatedTime(timestamp) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
    return new Intl.DateTimeFormat(locale(), { timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(timestamp));
  }

  function etaCacheKey(stationCode, lineCode) {
    return stationKey(stationCode) + ':' + lineCode;
  }

  function cachedEtaResults(stationCode, lineCodes) {
    const results = {};
    const now = Date.now();
    for (const code of lineCodes) {
      const key = etaCacheKey(stationCode, code);
      const entry = etaResponseCache.get(key);
      if (entry && now - entry.receivedAt <= ETA_RESPONSE_CACHE_TTL_MS) results[code] = entry;
      else {
        if (entry) etaResponseCache.delete(key);
        results[code] = { loading: true };
      }
    }
    return results;
  }

  function latestEtaReceivedAt(results) {
    const timestamps = Object.values(results || {}).map(result => result && Number(result.receivedAt)).filter(Number.isFinite);
    return timestamps.length ? Math.max(...timestamps) : NaN;
  }

  function etaRouteTag(line) {
    const active = etaRouteFilter === line.code;
    return '<button type="button" class="line-badge eta-route-tag' + (active ? ' active' : '') + '" data-eta-route-tag="' + esc(line.code) + '" aria-label="' + esc(lineName(line) + ' (' + line.code + ')') + '" aria-pressed="' + String(active) + '" style="background:' + esc(line.color) + '">' + esc(line.code) + '</button>';
  }

  function applyEtaTagFilters() {
    el.detail.querySelectorAll('.eta-line[data-eta-line]').forEach(section => {
      const lineCode = section.dataset.etaLine;
      section.hidden = !!etaRouteFilter && etaRouteFilter !== lineCode;
      const activeDirection = etaDirectionFilters.get(lineCode);
      section.querySelectorAll('[data-eta-route-tag]').forEach(tag => {
        const active = etaRouteFilter === tag.dataset.etaRouteTag;
        tag.classList.toggle('active', active);
        tag.setAttribute('aria-pressed', String(active));
      });
      section.querySelectorAll('[data-eta-direction-tag]').forEach(tag => {
        const active = activeDirection === tag.dataset.etaDirectionTag;
        tag.classList.toggle('active', active);
        tag.setAttribute('aria-pressed', String(active));
      });
      section.querySelectorAll('.eta-direction[data-eta-direction]').forEach(direction => {
        direction.hidden = !!activeDirection && activeDirection !== direction.dataset.etaDirection;
      });
    });
  }

  function renderTrain(train, schedule, receivedAt) {
    const minutes = minutesUntil(train, schedule, receivedAt);
    const urgency = minutes !== null && minutes <= 3 ? ' imminent' : minutes !== null && minutes <= 8 ? ' soon' : '';
    const time = formatTime(train.time);
    const arrivalEpoch = parseHkEpoch(train.time);
    const referenceEpoch = parseHkEpoch(schedule && (schedule.curr_time || schedule.sys_time));
    const countdownData = Number.isFinite(arrivalEpoch) && Number.isFinite(referenceEpoch)
      ? ' data-arrival-epoch="' + arrivalEpoch + '" data-reference-epoch="' + referenceEpoch + '" data-reference-received="' + (Number.isFinite(receivedAt) ? receivedAt : Date.now()) + '"'
      : '';
    const destination = stationNameFromCode(train.dest || '');
    const trainType = train.timetype === 'A' ? t('arrival') : train.timetype === 'D' ? t('departure') : '';
    const routeVia = train.route === 'RAC' ? (lang === 'en' ? 'via Racecourse' : '經馬場') : '';
    const platform = train.plat ? t('platform') + ' ' + train.plat : '';
    const details = [trainType, destination, routeVia, platform].filter(Boolean).join(' · ');
    return '<div class="train-row"><span class="eta-min' + urgency + '"' + countdownData + '>' + esc(relativeText(minutes)) + '</span><span class="train-dest">' + esc(details) + '</span><span class="train-time">' + esc(time) + '</span></div>';
  }

  function renderEtaResult(line, station, result) {
    const title = '<div class="eta-line-title">' + etaRouteTag(line) + '<span>' + esc(lineName(line)) + '</span></div>';
    const lineStart = '<div class="eta-line" data-eta-line="' + esc(line.code) + '">';
    if (!result || result.loading) return lineStart + title + '<div class="eta-note">' + esc(t('loadingEta')) + '</div></div>';
    if (result && result.error) return lineStart + title + '<div class="eta-note">' + esc(result.error) + '</div></div>';
    const response = result && result.response;
    if (!response || response.status === 0) {
      const message = response && response.message ? response.message : t('unavailable');
      return lineStart + title + '<div class="eta-note">' + esc(message) + '</div></div>';
    }
    const schedule = response.data && response.data[line.code + '-' + station.code];
    const groups = [];
    for (const key of ['UP', 'DOWN']) {
      const trains = schedule && Array.isArray(schedule[key]) ? schedule[key].filter(train => train.valid !== 'N') : [];
      if (!trains.length) continue;
      const heading = key === 'UP' ? t('up') : t('down');
      const directionClass = key === 'UP' ? ' eta-direction-up' : ' eta-direction-down';
      const active = etaDirectionFilters.get(line.code) === key;
      groups.push('<div class="eta-direction' + directionClass + '" data-eta-direction="' + key + '"><button type="button" class="eta-direction-title" data-eta-direction-tag="' + key + '" aria-pressed="' + String(active) + '">' + esc(heading) + '</button><div class="eta-trains">' + trains.map(train => renderTrain(train, schedule, result.receivedAt)).join('') + '</div></div>');
    }
    if (!groups.length) {
      const note = response.isdelay === 'Y' ? t('delayed') : t('noTrains');
      return lineStart + title + '<div class="eta-note">' + esc(note) + '</div></div>';
    }
    const delayNote = response.isdelay === 'Y' ? '<div class="eta-note">' + esc(t('delayed')) + '</div>' : '';
    return lineStart + title + groups.join('') + delayNote + '</div>';
  }

  function renderStationDetail(loading, results, updatedAt, refreshing) {
    if (!selectedStation) return;
    const station = selectedStation.feature.properties;
    const lineCodes = selectedStation.lineCodes;
    const lineBadges = lineCodes.map(code => lineByCode.get(code)).filter(Boolean).map(line => lineBadge(line, 'station-line-badge')).join('');
    const names = '<h3><span>' + esc(lang === 'en' ? station.en : station.zh) + '</span><span class="station-line-badges" aria-label="' + esc(lang === 'en' ? 'Lines serving this station' : '途經此站的路線') + '">' + lineBadges + '</span></h3><div class="station-meta">' + esc(lang === 'en' ? station.zh : station.en) + ' · ' + esc(station.code) + '</div>';
    const toggle = '<button type="button" class="detail-eta-toggle" aria-controls="station-eta" aria-expanded="' + String(etaDetailsVisible) + '" aria-label="' + esc(t(etaDetailsVisible ? 'hideEta' : 'showEta')) + '" title="' + esc(t(etaDetailsVisible ? 'hideEta' : 'showEta')) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    const refreshStatus = refreshing ? '<span class="eta-refreshing" aria-live="polite">' + esc(t('refreshingEta')) + '</span>' : '';
    const heading = '<div class="eta-heading"><strong>' + esc(t('trains')) + '</strong><span class="eta-updated">' + (updatedAt ? esc(t('updated') + ' ' + updatedAt) : '') + refreshStatus + '</span></div>';
    const scrollTop = el.detail.scrollTop;
    if (loading) {
      el.detail.classList.remove('muted');
      el.detail.innerHTML = names + toggle + '<div class="station-eta" id="station-eta">' + heading + '<div class="eta-note">' + esc(t('loadingEta')) + '</div></div>';
      el.detail.scrollTop = scrollTop;
      updateEtaToggle();
      applyEtaTagFilters();
      return;
    }
    const blocks = lineCodes.map(code => {
      const line = lineByCode.get(code);
      return line ? renderEtaResult(line, station, results[code]) : '';
    }).join('');
    el.detail.classList.remove('muted');
    el.detail.innerHTML = names + toggle + '<div class="station-eta" id="station-eta">' + heading + (blocks || '<div class="eta-note">' + esc(t('unavailable')) + '</div>') + '</div>';
    el.detail.scrollTop = scrollTop;
    updateEtaToggle();
    applyEtaTagFilters();
    updateEtaCountdowns();
  }

  function updateEtaCountdowns() {
    if (document.hidden) return;
    const now = Date.now();
    el.detail.querySelectorAll('.eta-min[data-arrival-epoch]').forEach(node => {
      const arrival = Number(node.dataset.arrivalEpoch);
      const reference = Number(node.dataset.referenceEpoch);
      const receivedAt = Number(node.dataset.referenceReceived);
      if (!Number.isFinite(arrival) || !Number.isFinite(reference) || !Number.isFinite(receivedAt)) return;
      const effectiveNow = reference + Math.max(0, now - receivedAt);
      const minutes = Math.max(0, Math.ceil((arrival - effectiveNow) / 60000));
      node.textContent = relativeText(minutes);
      node.classList.toggle('imminent', minutes <= 3);
      node.classList.toggle('soon', minutes > 3 && minutes <= 8);
    });
  }

  async function refreshEta() {
    if (!selectedStation) return;
    if (etaController) etaController.abort();
    const controller = new AbortController();
    etaController = controller;
    const selection = selectedStation;
    const token = selection.token;
    const results = cachedEtaResults(selection.feature.properties.code, selection.lineCodes);
    const hasCachedResults = Object.values(results).some(result => result && result.response);
    const initialUpdatedAt = latestEtaReceivedAt(results);
    if (hasCachedResults) renderStationDetail(false, results, formatUpdatedTime(initialUpdatedAt), true);
    else renderStationDetail(true, results, '', true);
    await Promise.all(selection.lineCodes.map(async code => {
      const query = new URLSearchParams({ line: code, sta: selection.feature.properties.code, lang: lang === 'en' ? 'EN' : 'TC' });
      try {
        const response = await fetch(ETA_URL + '?' + query.toString(), { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const body = await response.json();
        const receivedAt = Date.now();
        if (Number(body.status) !== 0) {
          const entry = { response: body, receivedAt };
          etaResponseCache.set(etaCacheKey(selection.feature.properties.code, code), entry);
          results[code] = entry;
        } else if (!results[code] || results[code].loading) {
          results[code] = { response: body, receivedAt };
        }
        if (!controller.signal.aborted && selectedStation && selectedStation.token === token) {
          renderStationDetail(false, results, formatUpdatedTime(latestEtaReceivedAt(results)), true);
        }
      } catch (error) {
        if (error.name === 'AbortError') return;
        if (!results[code] || results[code].loading) results[code] = { error: t('unavailable') };
        if (selectedStation && selectedStation.token === token) {
          renderStationDetail(false, results, formatUpdatedTime(latestEtaReceivedAt(results)), true);
        }
      }
    }));
    if (controller.signal.aborted || !selectedStation || selectedStation.token !== token) return;
    renderStationDetail(false, results, formatUpdatedTime(latestEtaReceivedAt(results)), false);
  }

  function selectStation(feature, lineCodes, shouldFit) {
    if (!feature) return;
    const properties = feature.properties || {};
    const codes = [...new Set((properties.lineCodes || lineCodes || []).filter(code => lineByCode.has(code)))];
    if (!codes.length) return;
    if (!selectedStation || selectedStation.feature.properties.code !== properties.code) etaDetailsVisible = true;
    const keepFareMode = !!selectedStation && fareMode;
    etaRouteFilter = null;
    etaDirectionFilters.clear();
    if (etaController) etaController.abort();
    etaController = null;
    const token = (selectedStation ? selectedStation.token : 0) + 1;
    selectedStation = { feature, lineCodes: codes, token };
    selectedLine = null;
    selectedDirection = null;
    el.lineSelect.value = '';
    el.stationList.replaceChildren();
    setPanelOpen(false);
    setRouteFilter(codes);
    setStationFilter(stationCodesForLines(codes));
    if (map && map.getLayer('selected-station')) map.setFilter('selected-station', ['==', ['get', 'code'], properties.code]);
    if (shouldFit && map) map.flyTo({ center: feature.geometry.coordinates, zoom: Math.max(map.getZoom(), 13), duration: 500 });
    fareMode = false;
    updateFareControls();
    setMapStationVisibility();
    renderStationDetail(true);
    refreshEta();
    if (keepFareMode) setFareMode(true);
    else syncTrainLocationScope();
  }

  function clearStationSelection() {
    clearAllSelection();
  }

  function clearAllSelection() {
    if (etaController) etaController.abort();
    etaController = null;
    selectedStation = null;
    etaRouteFilter = null;
    etaDirectionFilters.clear();
    fareMode = false;
    etaDetailsVisible = true;
    selectedLine = null;
    selectedDirection = null;
    el.lineSelect.value = '';
    filterLine('', false);
    if (map && map.getLayer('selected-station')) map.setFilter('selected-station', ['==', ['get', 'code'], '']);
    el.stationList.replaceChildren();
    setPanelOpen(false);
    el.detail.classList.add('muted');
    el.detail.classList.remove('eta-collapsed');
    el.detail.textContent = t('instruction');
    updateFareControls();
    setMapStationVisibility();
    syncTrainLocationScope();
  }

  function toggleStationSelection(feature, lineCodes, shouldFit) {
    if (selectedStation && selectedStation.feature.properties.code === feature.properties.code) {
      clearStationSelection();
      return;
    }
    selectStation(feature, lineCodes, shouldFit);
  }

  function setBasemap(name) {
    if (!map || !map.isStyleLoaded()) return;
    for (const base of TrailstaBasemaps.names) {
      for (const id of TrailstaBasemaps.layerIds(base)) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', name === base ? 'visible' : 'none');
      }
    }
    if (map.getLayer('osm-basemap')) map.setLayoutProperty('osm-basemap', 'visibility', name === 'osm' ? 'visible' : 'none');
    if (rail3DEnabled) setBasemapOpacity(rail3DOpacity);
  }

  function basemapOpacityProperties(layer) {
    if (layer.type === 'background') return ['background-opacity'];
    if (layer.type === 'fill') return ['fill-opacity'];
    if (layer.type === 'line') return ['line-opacity'];
    if (layer.type === 'raster') return ['raster-opacity'];
    if (layer.type === 'symbol') return ['icon-opacity', 'text-opacity'];
    if (layer.type === 'circle') return ['circle-opacity'];
    if (layer.type === 'fill-extrusion') return ['fill-extrusion-opacity'];
    if (layer.type === 'heatmap') return ['heatmap-opacity'];
    return [];
  }

  function setBasemapOpacity(value) {
    if (!map || !map.isStyleLoaded()) return;
    const opacity = Math.max(0.2, Math.min(1, Number(value) || 1));
    const styleLayers = map.getStyle().layers || [];
    for (const layer of styleLayers) {
      if (layer.type !== 'background' && !['trailsta-openmaptiles', 'osm'].includes(layer.source)) continue;
      for (const property of basemapOpacityProperties(layer)) {
        const key = layer.id + ':' + property;
        if (!baseStylePaint.has(key)) baseStylePaint.set(key, layer.paint?.[property]);
        const original = baseStylePaint.get(key);
        const scaled = opacity >= 0.999
          ? (original === undefined ? 1 : original)
          : (original === undefined ? opacity : ['*', original, opacity]);
        try { map.setPaintProperty(layer.id, property, scaled); } catch (_) { /* Some third-party styles omit type-specific opacity properties. */ }
      }
    }
  }

  function setStationsVisible(visible) {
    stationVisible = visible;
    el.toggleStations.setAttribute('aria-pressed', String(visible));
    el.toggleStations.textContent = visible ? t('hideStations') : t('showStations');
    setMapStationVisibility();
  }

  function closeSearch() {
    el.searchResults.classList.remove('open');
    el.search.setAttribute('aria-expanded', 'false');
  }

  function renderSearchResults() {
    const query = el.search.value.trim().toLocaleLowerCase();
    if (!query || !data) { closeSearch(); return; }
    const results = [];
    for (const line of data.lines) {
      const lineText = (line.code + ' ' + line.zh + ' ' + line.en).toLocaleLowerCase();
      if (lineText.includes(query)) results.push({ kind: 'line', line, label: line.code + ' · ' + lineName(line), subtitle: t('network') });
    }
    for (const feature of data.stations.features) {
      const station = feature.properties;
      const text = (station.code + ' ' + station.zh + ' ' + station.en).toLocaleLowerCase();
      if (text.includes(query)) {
        const line = lineByCode.get(station.lineCodes[0]);
        results.push({ kind: 'station', feature, line, label: lang === 'en' ? station.en : station.zh, subtitle: (line ? line.code + ' · ' + lineName(line) : '') + ' · ' + station.code });
      }
    }
    const fragment = document.createDocumentFragment();
    for (const result of results.slice(0, 12)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'search-result';
      button.dataset.kind = result.kind;
      if (result.kind === 'line') button.dataset.lineCode = result.line.code;
      else button.dataset.stationCode = result.feature.properties.code;
      const badge = result.line ? lineBadge(result.line) : '<span class="line-badge">MTR</span>';
      button.innerHTML = badge + '<span><strong>' + esc(result.label) + '</strong><small>' + esc(result.subtitle) + '</small></span>';
      fragment.append(button);
    }
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'search-result';
      empty.textContent = t('noResults');
      fragment.append(empty);
    }
    el.searchResults.replaceChildren(fragment);
    el.searchResults.classList.add('open');
    el.search.setAttribute('aria-expanded', 'true');
  }

  function selectSearchResult(button) {
    if (button.dataset.kind === 'line') {
      const line = lineByCode.get(button.dataset.lineCode);
      if (line) showLine(line, true);
    } else if (button.dataset.kind === 'station') {
      const feature = stationsByCode.get(button.dataset.stationCode);
      if (feature) {
        selectStation(feature, feature.properties.lineCodes, true);
      }
    }
    closeSearch();
  }

  function makeStyle() {
    return {
      version: 8,
      glyphs: TrailstaBasemaps.glyphs,
      sprite: TrailstaBasemaps.sprite,
      sources: {
        'trailsta-openmaptiles': TrailstaBasemaps.source,
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256, minzoom: 0, maxzoom: 19,
          attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>'
        }
      },
      layers: TrailstaBasemaps.layers('positron', true)
        .concat(TrailstaBasemaps.layers('fiord-color', false))
        .concat([{ id: 'osm-basemap', type: 'raster', source: 'osm', layout: { visibility: 'none' } }])
    };
  }

  function addMapLayers() {
    map.addSource('mtr-routes', { type: 'geojson', data: data.routes });
    map.addSource('mtr-stations', { type: 'geojson', data: data.stations });
    map.addSource('mtr-fares', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'route-casing', type: 'line', source: 'mtr-routes', filter: ['!', ['boolean', ['get', 'branch'], false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5, 13, 8, 17, 10], 'line-opacity': 0.93 }
    });
    map.addLayer({
      id: 'route-lines', type: 'line', source: 'mtr-routes', filter: ['!', ['boolean', ['get', 'branch'], false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.3, 13, 4.1, 17, 5.2], 'line-opacity': 0.9 }
    });
    map.addLayer({
      id: 'route-branch-casing', type: 'line', source: 'mtr-routes', filter: ['boolean', ['get', 'branch'], false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5, 13, 8, 17, 10], 'line-opacity': 0.93, 'line-dasharray': [2.3, 1.4] }
    });
    map.addLayer({
      id: 'route-branch-lines', type: 'line', source: 'mtr-routes', filter: ['boolean', ['get', 'branch'], false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.3, 13, 4.1, 17, 5.2], 'line-opacity': 0.9, 'line-dasharray': [2.3, 1.4] }
    });
    map.addLayer({
      id: 'route-hit', type: 'line', source: 'mtr-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-width': 15, 'line-opacity': 0.01 }
    });
    rail3DLayer = Mtr3DRailways.createLayer(maplibregl);
    rail3DLayer.setFilter(rail3DFilterCodes);
    rail3DLayer.setExaggeration(rail3DExaggeration);
    rail3DLayer.setVisible(rail3DEnabled);
    if (rail3DData) rail3DLayer.setData(rail3DData);
    map.addLayer(rail3DLayer);
    if (rail3DEnabled) {
      for (const id of ['route-casing', 'route-lines', 'route-branch-casing', 'route-branch-lines']) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
      }
    }
    map.addLayer({
      id: 'station-hit', type: 'circle', source: 'mtr-stations', minzoom: 8.5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8.5, 8, 12, 10, 16, 12],
        'circle-color': '#000000', 'circle-opacity': 0.01, 'circle-stroke-width': 0
      }
    });
    map.addLayer({
      id: 'stations', type: 'circle', source: 'mtr-stations', minzoom: 8.5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          8.5, 2.8,
          12, 4.5,
          16, 6
        ],
        'circle-color': '#ffffff',
        'circle-stroke-color': ['case', ['get', 'isInterchange'], '#111827', ['get', 'color']],
        'circle-stroke-width': 1.8
      }
    });
    map.addLayer({
      id: 'selected-station', type: 'circle', source: 'mtr-stations', minzoom: 8.5,
      filter: ['==', ['get', 'code'], ''],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          8.5, 6,
          14, 9
        ],
        'circle-color': ['case', ['get', 'isInterchange'], '#ffffff', ['get', 'color']],
        'circle-stroke-color': ['case', ['get', 'isInterchange'], '#111827', '#ffffff'],
        'circle-stroke-width': 2.5
      }
    });
    map.addLayer({
      id: 'station-labels', type: 'symbol', source: 'mtr-stations', minzoom: 12,
      layout: { 'text-field': ['get', lang === 'en' ? 'en' : 'zh'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-max-width': 9, 'text-allow-overlap': false },
      paint: { 'text-color': '#1e293b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4, 'text-halo-blur': 0.3 }
    });
    map.addLayer({
      id: 'fare-stations', type: 'circle', source: 'mtr-fares', minzoom: 8.5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8.5, 3.2, 12, 5.2, 16, 7],
        'circle-color': ['get', 'fareColor'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.7
      },
      layout: { visibility: 'none' }
    });
    map.addLayer({
      id: 'fare-station-labels', type: 'symbol', source: 'mtr-fares', minzoom: 10.5,
      layout: { visibility: 'none', 'text-field': ['get', 'fareLabel'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 10.5, 10, 14, 12], 'text-offset': [0, 1], 'text-anchor': 'top', 'text-max-width': 12, 'text-allow-overlap': false, 'text-ignore-placement': false },
      paint: { 'text-color': '#172033', 'text-halo-color': '#ffffff', 'text-halo-width': 1.8, 'text-halo-blur': 0.3 }
    });
    updateTrainToggle();
    renderTrainLocationSource();
    function stationAtPoint(point) {
      if (map.getZoom() < 8.5 || (!stationVisible && !selectedStation)) return null;
      const eligibleCodes = selectedLine
        ? new Set(stationCodesForLines([selectedLine.code]))
        : selectedStation && !fareMode ? new Set(stationCodesForLines(selectedStation.lineCodes)) : null;
      const candidates = stationVisible
        ? eligibleCodes ? data.stations.features.filter(feature => eligibleCodes.has(feature.properties.code)) : data.stations.features
        : [selectedStation.feature];
      return MtrHitTest.nearestFeature(
        candidates,
        point,
        feature => map.project(feature.geometry.coordinates),
        16,
        feature => (!eligibleCodes || eligibleCodes.has(feature.properties.code)) && (!selectedLine || (feature.properties.lineCodes || []).includes(selectedLine.code))
      );
    }
    function handleMapClick(event) {
      // A map click releases camera follow but leaves the train information popup open.
      if (trainFollowKey) trainFollowKey = null;
      // Query station coordinates in screen space first. Rendered-feature hit tests
      // can miss circle layers in some MapLibre/browser combinations, especially when
      // the nearly transparent hit layer is involved.
      let station = stationAtPoint(event.point);
      if (!station) {
        const stationLayers = stationVisible
          ? ['selected-station', 'fare-stations', 'stations', 'station-hit']
          : selectedStation ? ['selected-station'] : [];
        if (stationLayers.length) station = map.queryRenderedFeatures(event.point, { layers: stationLayers })[0];
      }
      if (!station) station = map.queryRenderedFeatures(event.point, { layers: ['station-labels', 'fare-station-labels'] })[0];
      if (station) {
        const feature = stationsByCode.get(station.properties.code) || station;
        toggleStationSelection(feature, feature.properties.lineCodes, false);
        return;
      }
      const route = map.queryRenderedFeatures(event.point, { layers: ['route-hit'] })[0];
      if (route) {
        const line = lineByCode.get(route.properties.code);
        if (line) {
          if (selectedLine && selectedLine.code === line.code) clearAllSelection();
          else showLine(line, false);
        }
        return;
      }
      if (selectedLine || selectedStation) clearAllSelection();
    }
    map.on('click', handleMapClick);
    map.on('mousemove', event => {
      const station = stationAtPoint(event.point);
      const route = station ? null : map.queryRenderedFeatures(event.point, { layers: ['route-hit'] })[0];
      map.getCanvas().style.cursor = station || route ? 'pointer' : '';
    });
    map.on('mouseenter', 'station-hit', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'station-hit', () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', 'stations', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'stations', () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', 'selected-station', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'selected-station', () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', 'station-labels', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'station-labels', () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', 'route-hit', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'route-hit', () => { map.getCanvas().style.cursor = ''; });
    const bounds = new maplibregl.LngLatBounds();
    for (const feature of data.routes.features) {
      const segments = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      for (const segment of segments) for (const coordinate of segment) bounds.extend(coordinate);
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 36, maxZoom: 10.2, duration: 0 });
  }

  function updateTrainToggle() {
    if (el.toggleTrains) {
      el.toggleTrains.setAttribute('aria-pressed', String(trainLocationsEnabled));
      el.toggleTrains.setAttribute('aria-label', t(trainLocationsEnabled ? 'trainPositionsOn' : 'trainPositionsOff'));
      el.toggleTrains.title = t('trainPositionsTitle');
    }
    if (el.trainLegendItem) el.trainLegendItem.hidden = !trainLocationsEnabled;
    updateTrainLegend();
  }

  function createTrainToggleControl() {
    let container;
    let button;
    return {
      onAdd() {
        container = document.createElement('div');
        container.className = 'maplibregl-ctrl maplibregl-ctrl-group train-toggle-control';
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'train-map-toggle';
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10a3 3 0 0 1 3 3v9a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V6a3 3 0 0 1 3-3Zm0 3v6h10V6H7Zm1 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM9 3V1m6 2V1m-7 21 2-3m6 0 2 3"/></svg>';
        button.addEventListener('click', () => setTrainLocationsEnabled(!trainLocationsEnabled));
        container.append(button);
        el.toggleTrains = button;
        updateTrainToggle();
        return container;
      },
      onRemove() {
        if (container && container.parentNode) container.parentNode.removeChild(container);
        el.toggleTrains = null;
      }
    };
  }

  function updateRail3DControl() {
    if (rail3DControlButton) {
      rail3DControlButton.setAttribute('aria-pressed', String(rail3DEnabled));
      rail3DControlButton.setAttribute('aria-label', t(rail3DEnabled ? 'rail3DOn' : 'rail3DOff'));
      rail3DControlButton.title = t('rail3DTitle');
      rail3DControlButton.classList.toggle('active', rail3DEnabled);
    }
    if (rail3DControlPanel) {
      rail3DControlPanel.hidden = !rail3DEnabled;
      rail3DControlPanel.classList.toggle('collapsed', rail3DPanelCollapsed);
    }
    if (rail3DPanelContent) rail3DPanelContent.hidden = rail3DPanelCollapsed;
    if (rail3DPanelCollapseButton) {
      rail3DPanelCollapseButton.setAttribute('aria-expanded', String(!rail3DPanelCollapsed));
      rail3DPanelCollapseButton.setAttribute('aria-label', t(rail3DPanelCollapsed ? 'rail3DExpand' : 'rail3DCollapse'));
      rail3DPanelCollapseButton.title = t(rail3DPanelCollapsed ? 'rail3DExpand' : 'rail3DCollapse');
    }
    if (rail3DOpacityValue) rail3DOpacityValue.textContent = Math.round(rail3DOpacity * 100) + '%';
    if (rail3DExaggerationValue) rail3DExaggerationValue.textContent = rail3DExaggeration.toFixed(1) + '×';
    if (rail3DControlContainer) {
      rail3DControlContainer._rail3DOpacityTitle.textContent = t('rail3DOpacity');
      rail3DControlContainer._rail3DExaggerationTitle.textContent = t('rail3DExaggeration');
      rail3DControlContainer._rail3DPanelTitle.textContent = t('rail3DControls');
      rail3DControlContainer._rail3DOpacityRange.value = String(Math.round(rail3DOpacity * 100));
      rail3DControlContainer._rail3DExaggerationRange.value = String(rail3DExaggeration);
    }
    if (rail3DStatus) rail3DStatus.textContent = t(rail3DStatusKey);
    if (el.rail3DLegendLabel) el.rail3DLegendLabel.textContent = t('rail3DLegend');
    if (el.rail3DLegend) el.rail3DLegend.hidden = !rail3DEnabled;
  }

  let rail3DStatusKey = 'rail3DStatus';

  async function ensureRail3DData() {
    if (rail3DData) return rail3DData;
    if (!rail3DDataPromise) {
      rail3DDataPromise = fetch(MTR_3D_DATA_URL, { cache: 'force-cache' }).then(response => {
        if (!response.ok) throw new Error('3D rail data request failed (' + response.status + ')');
        return response.json();
      }).then(geojson => {
        if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) throw new Error('3D rail data is not a GeoJSON FeatureCollection');
        rail3DData = geojson;
        if (rail3DLayer) {
          rail3DLayer.setData(geojson);
          rail3DLayer.setFilter(rail3DFilterCodes);
          rail3DLayer.setExaggeration(rail3DExaggeration);
        }
        return geojson;
      }).catch(error => {
        rail3DDataPromise = null;
        throw error;
      });
    }
    return rail3DDataPromise;
  }

  async function setRail3DEnabled(enabled) {
    if (!map) return;
    const next = !!enabled;
    if (next === rail3DEnabled) return;
    if (next) rail3DPreviousCamera = { pitch: map.getPitch(), bearing: map.getBearing() };
    rail3DEnabled = next;
    rail3DStatusKey = next ? 'rail3DLoading' : 'rail3DStatus';
    if (rail3DLayer) {
      rail3DLayer.setFilter(rail3DFilterCodes);
      rail3DLayer.setExaggeration(rail3DExaggeration);
      rail3DLayer.setVisible(next);
    }
    for (const id of ['route-casing', 'route-lines', 'route-branch-casing', 'route-branch-lines']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', next ? 'none' : 'visible');
    }
    if (next) {
      setBasemapOpacity(rail3DOpacity);
      map.easeTo({ pitch: 55, duration: 500 });
      updateRail3DControl();
      try {
        await ensureRail3DData();
        if (rail3DEnabled) rail3DStatusKey = 'rail3DStatus';
      } catch (error) {
        console.warn('MTR 3D rail data is unavailable:', error);
        rail3DStatusKey = 'rail3DError';
        // A late fetch failure should only roll back the mode if it is still
        // active; the user may have switched back to 2D while it was loading.
        if (!rail3DEnabled) {
          updateRail3DControl();
          return;
        }
        rail3DEnabled = false;
        if (rail3DLayer) rail3DLayer.setVisible(false);
        for (const id of ['route-casing', 'route-lines', 'route-branch-casing', 'route-branch-lines']) {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
        }
        setBasemapOpacity(1);
        if (rail3DPreviousCamera) map.easeTo({ pitch: rail3DPreviousCamera.pitch, bearing: rail3DPreviousCamera.bearing, duration: 400 });
      }
    } else {
      setBasemapOpacity(1);
      if (rail3DPreviousCamera) map.easeTo({ pitch: rail3DPreviousCamera.pitch, bearing: rail3DPreviousCamera.bearing, duration: 500 });
    }
    updateRail3DControl();
  }

  function createRail3DControl() {
    let container, button;
    return {
      onAdd() {
        container = document.createElement('div');
        container.className = 'maplibregl-ctrl mtr-3d-control';
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'mtr-3d-toggle';
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Z"/><path d="m3.5 7.2 8.5 4 8.5-4M12 11.2V21M7.5 5l9 4"/></svg>';
        button.addEventListener('click', () => setRail3DEnabled(!rail3DEnabled));
        const panel = document.createElement('div');
        panel.className = 'mtr-3d-panel';
        panel.hidden = true;
        const panelHeader = document.createElement('div');
        panelHeader.className = 'mtr-3d-panel-header';
        const panelTitle = document.createElement('span');
        panelTitle.className = 'mtr-3d-panel-title';
        const collapseButton = document.createElement('button');
        collapseButton.type = 'button';
        collapseButton.className = 'mtr-3d-panel-collapse';
        collapseButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
        collapseButton.addEventListener('click', () => {
          rail3DPanelCollapsed = !rail3DPanelCollapsed;
          updateRail3DControl();
        });
        panelHeader.append(panelTitle, collapseButton);
        const panelContent = document.createElement('div');
        panelContent.className = 'mtr-3d-panel-content';
        const opacityLabel = document.createElement('label');
        opacityLabel.className = 'mtr-3d-range-label';
        const opacityTitle = document.createElement('span');
        opacityTitle.className = 'mtr-3d-range-title';
        const opacityOutput = document.createElement('output');
        opacityOutput.className = 'mtr-3d-range-value';
        const opacityRange = document.createElement('input');
        opacityRange.type = 'range'; opacityRange.min = '20'; opacityRange.max = '100'; opacityRange.step = '1';
        opacityRange.value = String(Math.round(rail3DOpacity * 100));
        opacityRange.addEventListener('input', () => {
          rail3DOpacity = Number(opacityRange.value) / 100;
          if (rail3DEnabled) setBasemapOpacity(rail3DOpacity);
          updateRail3DControl();
        });
        opacityLabel.append(opacityTitle, opacityOutput, opacityRange);

        const exaggerationLabel = document.createElement('label');
        exaggerationLabel.className = 'mtr-3d-range-label';
        const exaggerationTitle = document.createElement('span');
        exaggerationTitle.className = 'mtr-3d-range-title';
        const exaggerationOutput = document.createElement('output');
        exaggerationOutput.className = 'mtr-3d-range-value';
        const exaggerationRange = document.createElement('input');
        exaggerationRange.type = 'range'; exaggerationRange.min = '1'; exaggerationRange.max = '8'; exaggerationRange.step = '0.5';
        exaggerationRange.value = String(rail3DExaggeration);
        exaggerationRange.addEventListener('input', () => {
          rail3DExaggeration = Number(exaggerationRange.value);
          if (rail3DLayer) rail3DLayer.setExaggeration(rail3DExaggeration);
          updateRail3DControl();
        });
        exaggerationLabel.append(exaggerationTitle, exaggerationOutput, exaggerationRange);
        const status = document.createElement('small');
        status.className = 'mtr-3d-status';
        panelContent.append(opacityLabel, exaggerationLabel, status);
        panel.append(panelHeader, panelContent);
        container.append(panel, button);
        for (const eventName of ['click', 'mousedown', 'dblclick', 'touchstart', 'wheel']) {
          container.addEventListener(eventName, event => event.stopPropagation());
        }
        rail3DControlButton = button;
        rail3DControlPanel = panel;
        rail3DPanelContent = panelContent;
        rail3DPanelCollapseButton = collapseButton;
        rail3DStatus = status;
        rail3DOpacityValue = opacityOutput;
        rail3DExaggerationValue = exaggerationOutput;
        updateRail3DControl();
        // Keep references to the translated labels and controls on the button.
        container._rail3DOpacityTitle = opacityTitle;
        container._rail3DExaggerationTitle = exaggerationTitle;
        container._rail3DPanelTitle = panelTitle;
        container._rail3DOpacityRange = opacityRange;
        container._rail3DExaggerationRange = exaggerationRange;
        rail3DControlContainer = container;
        updateRail3DControl();
        return container;
      },
      onRemove() {
        if (container?.parentNode) container.parentNode.removeChild(container);
        rail3DControlButton = null; rail3DControlPanel = null; rail3DPanelContent = null; rail3DPanelCollapseButton = null; rail3DStatus = null;
        rail3DOpacityValue = null; rail3DExaggerationValue = null; rail3DControlContainer = null;
      }
    };
  }

  let rail3DControlContainer = null;

  function currentTrainLineCodes() {
    if (!data) return [];
    if (fareMode || (!selectedLine && !selectedStation)) return data.lines.map(line => line.code);
    if (selectedLine) return [selectedLine.code];
    return selectedStation ? selectedStation.lineCodes : [];
  }

  function trainCacheKey(lineCode, stationCode) {
    return lineCode + ':' + stationKey(stationCode);
  }

  function cachedTrainResponses(lineCodes, now) {
    const allowedLines = new Set(lineCodes || []);
    const currentTime = Number.isFinite(now) ? now : Date.now();
    const responses = [];
    for (const [key, entry] of trainResponseCache) {
      if (currentTime - entry.receivedAt > TRAIN_RESPONSE_CACHE_TTL_MS) {
        trainResponseCache.delete(key);
        continue;
      }
      if (allowedLines.has(entry.lineCode)) responses.push(entry);
    }
    return responses;
  }

  function estimateDistanceMeters(a, b) {
    const toRadians = value => value * Math.PI / 180;
    const lat1 = toRadians(a[1]), lat2 = toRadians(b[1]);
    const deltaLat = lat2 - lat1;
    const deltaLon = toRadians(b[0] - a[0]);
    const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }

  function stableTrainKey(model) {
    return [model.lineCode, model.directionCode, model.destinationCode, model.routeCode,
      Math.round(model.terminalArrivalEpoch / 60000), Math.round((model.positionAlongMeters || 0) / 300)].join(':');
  }

  function mergeTrainEstimates(currentModels, incomingModels, lineCodes, now) {
    const allowedLines = new Set(lineCodes || []);
    const active = [];
    const occupied = new Set();

    for (const model of currentModels || []) {
      if (!allowedLines.has(model.lineCode)) continue;
      const lastUpdateEpoch = Number.isFinite(model.lastUpdateEpoch)
        ? model.lastUpdateEpoch
        : Number.isFinite(model.feedEpoch) ? model.feedEpoch : now;
      if (now - lastUpdateEpoch > TRAIN_MODEL_RETENTION_MS) continue;
      const feature = trainEstimator.featureCollection([model], now).features[0];
      if (!feature) continue;
      active.push({ ...model, displayKey: model.displayKey || stableTrainKey(model), lastUpdateEpoch });
    }

    const orderedIncoming = (incomingModels || []).slice().sort((a, b) => (b.feedEpoch || 0) - (a.feedEpoch || 0));
    for (const model of orderedIncoming) {
      if (!allowedLines.has(model.lineCode)) continue;
      const receivedAt = Number.isFinite(model.feedEpoch) ? model.feedEpoch : now;
      if (now - receivedAt > TRAIN_MODEL_RETENTION_MS) continue;
      const feature = trainEstimator.featureCollection([model], now).features[0];
      if (!feature) continue;

      let matchedIndex = -1;
      let bestScore = Infinity;
      for (let index = 0; index < active.length; index += 1) {
        if (occupied.has(index)) continue;
        const existing = active[index];
        if (existing.lineCode !== model.lineCode
          || existing.directionCode !== model.directionCode
          || existing.destinationCode !== model.destinationCode
          || (existing.routeCode && model.routeCode && existing.routeCode !== model.routeCode)) continue;
        if (Math.abs(existing.terminalArrivalEpoch - model.terminalArrivalEpoch) > 6 * 60 * 1000) continue;
        const existingFeature = trainEstimator.featureCollection([existing], now).features[0];
        if (!existingFeature) continue;
        const distance = estimateDistanceMeters(existingFeature.geometry.coordinates, feature.geometry.coordinates);
        if (distance > 5000) continue;
        const score = distance + Math.abs(existing.terminalArrivalEpoch - model.terminalArrivalEpoch) / 1000 * 8;
        if (score < bestScore) {
          bestScore = score;
          matchedIndex = index;
        }
      }

      if (matchedIndex >= 0) {
        occupied.add(matchedIndex);
        const existing = active[matchedIndex];
        if (receivedAt > existing.lastUpdateEpoch) {
          active[matchedIndex] = {
            ...model,
            displayKey: existing.displayKey,
            lastUpdateEpoch: receivedAt
          };
        }
        continue;
      }

      let displayKey = stableTrainKey(model);
      let suffix = 1;
      while (active.some(existing => existing.displayKey === displayKey)) displayKey = stableTrainKey(model) + ':' + suffix++;
      active.push({ ...model, displayKey, lastUpdateEpoch: receivedAt });
    }
    return active;
  }

  function refreshTrainEstimatesFromCache(lineCodes) {
    if (!trainEstimator) return;
    const allowedLines = lineCodes || currentTrainLineCodes();
    const responses = cachedTrainResponses(allowedLines);
    const incoming = trainEstimator.estimate(responses);
    trainLocationModels = mergeTrainEstimates(trainLocationModels, incoming, allowedLines, Date.now());
    if (responses.length) trainHasFetched = true;
    renderTrainLocationSource();
  }

  function trainPopupHtml(info) {
    const properties = info.properties;
    const line = lineByCode.get(properties.lineCode);
    const destination = stationByCode.get(properties.destinationCode);
    const nextStop = properties.nextStopCode && stationByCode.get(properties.nextStopCode);
    const direction = line && line.directions.find(item => item.code === properties.directionCode);
    const etaSeconds = Number(properties.nextStopEtaSeconds);
    const etaText = properties.nextStopCode
      ? (Number.isFinite(etaSeconds) ? etaSeconds <= 20 ? t('due') : Math.ceil(etaSeconds / 60) + ' ' + t('min') : '—')
      : t('trainTerminal');
    return '<div class="train-popup">'
      + '<div class="train-popup-title">' + (line ? lineBadge(line) : '') + '<strong>' + esc(line ? lineName(line) : properties.lineCode) + '</strong></div>'
      + '<div class="train-popup-direction">' + esc((lang === 'en' ? 'To ' : '往') + (destination ? stopName(destination) : properties.destinationCode)) + '</div>'
      + '<div class="train-popup-state">' + esc(t(properties.atStation ? 'trainAtStation' : 'trainEnRoute')) + (direction ? ' · ' + esc(directionText(direction)) : '') + '</div>'
      + '<div class="train-popup-row"><span>' + esc(t('trainNextStop')) + '</span><strong>' + esc(nextStop ? stopName(nextStop) : t('trainTerminal')) + '</strong></div>'
      + '<div class="train-popup-row"><span>' + esc(t('trainNextEta')) + '</span><strong>' + esc(etaText) + '</strong></div>'
      + '<small>' + esc(t('trainEstimateNote')) + '</small></div>';
  }

  function toggleTrainPopup(info) {
    if (openTrainKey === info.id && trainPopup) {
      trainPopup.remove();
      trainPopup = null;
      openTrainKey = null;
      trainFollowKey = null;
      openTrainPopupHtml = '';
      return;
    }
    if (trainPopup) trainPopup.remove();
    openTrainKey = info.id;
    trainFollowKey = info.id;
    openTrainPopupHtml = trainPopupHtml(info);
    const popup = new maplibregl.Popup({ className: 'train-info-popup', closeButton: true, closeOnClick: false, offset: 18, maxWidth: '300px' })
      .setLngLat(info.coordinates)
      .setHTML(openTrainPopupHtml)
      .addTo(map);
    centerOnTrain(info.coordinates, 500);
    popup.on('close', () => {
      if (trainPopup === popup) {
        trainPopup = null;
        openTrainKey = null;
        trainFollowKey = null;
        openTrainPopupHtml = '';
      }
    });
    trainPopup = popup;
  }

  function centerOnTrain(coordinates, duration) {
    if (!map || !coordinates) return;
    const center = map.getCenter();
    if (estimateDistanceMeters([center.lng, center.lat], coordinates) < 4) return;
    map.easeTo({ center: coordinates, duration: duration || 700, essential: true });
  }

  function onTrainMarkerClick(id, event) {
    event.preventDefault();
    event.stopPropagation();
    const info = trainMarkerInfo.get(id);
    if (info) toggleTrainPopup(info);
  }

  function renderTrainLocationSource() {
    if (!map || !trainEstimator) return;
    const collection = trainEstimator.featureCollection(trainLocationModels, Date.now());
    const active = new Set();
    for (const feature of collection.features) {
      const properties = feature.properties;
      const id = properties.trainKey;
      active.add(id);
      let marker = trainMarkers.get(id);
      if (!marker) {
        const element = document.createElement('div');
        element.className = 'train-map-marker';
        element.setAttribute('role', 'button');
        element.tabIndex = 0;
        element.setAttribute('aria-label', lang === 'en' ? 'Show train information' : '查看列車資料');
        element.innerHTML = '<span class="train-map-marker-face"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 22 22H2Z" fill="currentColor" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></span>';
        element.addEventListener('click', event => onTrainMarkerClick(id, event));
        element.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') onTrainMarkerClick(id, event);
        });
        marker = new maplibregl.Marker({ element, anchor: 'center', rotationAlignment: 'map' })
          .setLngLat(feature.geometry.coordinates).addTo(map);
        trainMarkers.set(id, marker);
      }
      const element = marker.getElement();
      element.style.setProperty('--train-marker-color', properties.lineColor || '#2563eb');
      const destinationName = stationByCode.get(properties.destinationCode);
      const accessibleDestination = destinationName ? stopName(destinationName) : properties.destinationCode;
      element.title = properties.lineCode + ' · ' + (lang === 'en' ? 'to ' : '往')
        + accessibleDestination
        + (lang === 'en' ? ' · estimated' : ' · 推算位置');
      element.setAttribute('aria-label', properties.lineCode + ' · ' + (lang === 'en' ? 'to ' : '往') + accessibleDestination + ' · ' + t('trainNextStop') + ': ' + (properties.nextStopCode ? (stationByCode.get(properties.nextStopCode) ? stopName(stationByCode.get(properties.nextStopCode)) : properties.nextStopCode) : t('trainTerminal')));
      // Keep the same geographic fix at every zoom; MapLibre handles projection.
      marker.setLngLat(feature.geometry.coordinates);
      marker.setRotation(Number(properties.bearing) || 0);
      trainMarkerInfo.set(id, { id, properties, coordinates: feature.geometry.coordinates.slice() });
    }
    for (const [id, marker] of trainMarkers) {
      if (!active.has(id)) {
        marker.remove();
        trainMarkers.delete(id);
        trainMarkerInfo.delete(id);
      }
    }
    if (openTrainKey && trainPopup) {
      const info = trainMarkerInfo.get(openTrainKey);
      if (info) {
        trainPopup.setLngLat(info.coordinates);
        if (trainFollowKey === openTrainKey) centerOnTrain(info.coordinates, 900);
        const popupHtml = trainPopupHtml(info);
        if (popupHtml !== openTrainPopupHtml) {
          trainPopup.setHTML(popupHtml);
          openTrainPopupHtml = popupHtml;
        }
      }
      else {
        trainPopup.remove();
        trainPopup = null;
        openTrainKey = null;
        trainFollowKey = null;
        openTrainPopupHtml = '';
      }
    }
    trainVisibleCount = collection.features.length;
    updateTrainLegend();
  }

  function updateTrainLegend() {
    if (!el.trainLegendLabel) return;
    if (!trainLocationsEnabled) {
      el.trainLegendLabel.textContent = t('trainLegend');
    } else if (trainFetchInProgress) {
      el.trainLegendLabel.textContent = trainVisibleCount > 0 ? t('trainLegend') + ' · ' + trainVisibleCount : t('trainLegendLoading');
    } else if (trainVisibleCount > 0) {
      el.trainLegendLabel.textContent = t('trainLegend') + ' · ' + trainVisibleCount;
    } else if (trainFetchErrorCount > 0 && trainHasFetched) {
      el.trainLegendLabel.textContent = t('trainLegendUnavailable');
    } else if (trainHasFetched) {
      el.trainLegendLabel.textContent = t('trainLegendEmpty');
    } else {
      el.trainLegendLabel.textContent = t('trainLegendLoading');
    }
  }

  function syncTrainLocationScope() {
    if (!trainLocationsEnabled || !trainEstimator) return;
    const signature = currentTrainLineCodes().sort().join('|');
    if (signature === trainLineSignature) return;
    trainLineSignature = signature;
    trainFetchToken += 1;
    if (trainLocationController) trainLocationController.abort();
    trainLocationController = null;
    trainFetchInProgress = false;
    refreshTrainEstimatesFromCache(currentTrainLineCodes());
    refreshTrainLocations();
  }

  async function refreshTrainLocations() {
    if (!trainLocationsEnabled || !trainEstimator || document.hidden || trainFetchInProgress) return;
    if (Date.now() < trainRetryAfter) return;
    const targets = trainEstimator.targets(currentTrainLineCodes());
    if (!targets.length) {
      trainLocationModels = [];
      renderTrainLocationSource();
      return;
    }
    trainFetchInProgress = true;
    trainFetchErrorCount = 0;
    updateTrainLegend();
    const token = ++trainFetchToken;
    const controller = new AbortController();
    trainLocationController = controller;
    let nextIndex = 0;
    let rateLimited = false;
    const worker = async () => {
      while (!controller.signal.aborted && !rateLimited) {
        const index = nextIndex++;
        if (index >= targets.length) return;
        const target = targets[index];
        const query = new URLSearchParams({ line: target.lineCode, sta: target.stationCode, lang: lang === 'en' ? 'EN' : 'TC' });
        try {
          const response = await fetch(ETA_URL + '?' + query.toString(), { signal: controller.signal, cache: 'no-store' });
          if (response.status === 429) {
            trainRetryAfter = Date.now() + 60000;
            trainFetchErrorCount += 1;
            rateLimited = true;
            return;
          }
          if (!response.ok) {
            trainFetchErrorCount += 1;
            return;
          }
          const body = await response.json();
          if (Number(body.status) !== 0) {
            trainResponseCache.set(trainCacheKey(target.lineCode, target.stationCode), {
              ...target,
              response: body,
              receivedAt: Date.now()
            });
          } else {
            trainFetchErrorCount += 1;
          }
          if (token === trainFetchToken && trainLocationsEnabled) {
            refreshTrainEstimatesFromCache(currentTrainLineCodes());
          }
        } catch (error) {
          if (error.name === 'AbortError') return;
          trainFetchErrorCount += 1;
        }
        if (TRAIN_REQUEST_GAP_MS > 0 && !controller.signal.aborted) {
          await new Promise(resolve => {
            const timer = setTimeout(resolve, TRAIN_REQUEST_GAP_MS);
            controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
          });
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(TRAIN_REQUEST_CONCURRENCY, targets.length) }, () => worker()));
      if (!controller.signal.aborted && token === trainFetchToken && trainLocationsEnabled) {
        refreshTrainEstimatesFromCache(currentTrainLineCodes());
        trainHasFetched = true;
      }
    } finally {
      if (token === trainFetchToken) {
        trainFetchInProgress = false;
        trainLocationController = null;
        updateTrainLegend();
      }
    }
  }

  function setTrainLocationsEnabled(enabled) {
    trainLocationsEnabled = !!enabled;
    updateTrainToggle();
    clearInterval(trainLocationTimer);
    clearInterval(trainAnimationTimer);
    trainLocationTimer = null;
    trainAnimationTimer = null;
    if (trainLocationsEnabled) {
      trainLineSignature = currentTrainLineCodes().sort().join('|');
      refreshTrainEstimatesFromCache(currentTrainLineCodes());
      refreshTrainLocations();
      trainLocationTimer = setInterval(refreshTrainLocations, TRAIN_REFRESH_MS);
      trainAnimationTimer = setInterval(renderTrainLocationSource, 1000);
      return;
    }
    trainFetchToken += 1;
    if (trainLocationController) trainLocationController.abort();
    trainLocationController = null;
    trainFetchInProgress = false;
    trainLineSignature = '';
    trainLocationModels = [];
    trainVisibleCount = 0;
    trainHasFetched = false;
    trainFetchErrorCount = 0;
    updateTrainLegend();
    renderTrainLocationSource();
  }

  function startEtaTimer() {
    clearInterval(etaTimer);
    etaTimer = setInterval(() => {
      if (selectedStation && !document.hidden) refreshEta();
    }, REFRESH_MS);
    clearInterval(etaCountdownTimer);
    etaCountdownTimer = setInterval(updateEtaCountdowns, 1000);
  }

  async function start() {
    try {
      const [response, faresResponse] = await Promise.all([
        fetch(DATA_URL, { cache: 'no-cache' }),
        fetch('assets/mtr-fares.json', { cache: 'no-cache' })
      ]);
      if (!response.ok) throw new Error('MTR network data could not be loaded (' + response.status + ')');
      if (!faresResponse.ok) throw new Error('MTR fare data could not be loaded (' + faresResponse.status + ')');
      [data, fareData] = await Promise.all([response.json(), faresResponse.json()]);
      trainEstimator = window.MtrLiveTrains.createEstimator(data);
      for (const pair of fareData.pairs || []) fareByPair.set(pair[0] + '|' + pair[1], pair);
      for (const line of data.lines) lineByCode.set(line.code, line);
      for (const feature of data.stations.features) {
        const code = stationKey(feature.properties.code);
        stationByCode.set(code, feature.properties);
        stationsByCode.set(code, feature);
      }
      for (const line of data.lines) {
        for (const feature of data.stations.features) {
          if (feature.properties.lineCodes.includes(line.code) && !feature.properties.color) feature.properties.color = line.color;
        }
      }
      fillLineOptions();
      el.count.textContent = data.lines.length + ' ' + t('lineCount') + ' · ' + data.stations.features.length + ' ' + t('stationCount');
      map = new maplibregl.Map({
        container: 'map', center: [114.16, 22.34], zoom: 9.7,
        attributionControl: false, canvasContextAttributes: { antialias: true }, style: makeStyle()
      });
      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      map.addControl(new maplibregl.GeolocateControl(), 'top-right');
      map.addControl(createTrainToggleControl(), 'top-right');
      map.addControl(createRail3DControl(), 'top-right');
      map.addControl(new maplibregl.AttributionControl({
        compact: true,
        customAttribution: '<a href="' + esc(data.sources.routeShapes) + '" target="_blank" rel="noopener noreferrer">MTR route relations on OpenStreetMap Wiki</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors (ODbL)</a> · <a href="' + esc(data.sources.routeStations) + '" target="_blank" rel="noopener noreferrer">MTR Corporation station data</a> · <a href="https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-indoor-mtr-station-map" target="_blank" rel="noopener noreferrer">Platform elevations and shapes: Lands Department via CSDI</a>'
      }), 'bottom-right');
      map.on('load', () => {
        addMapLayers();
        if (selectedStation) {
          setRouteFilter(fareMode ? null : selectedStation.lineCodes);
          setStationFilter(fareMode ? null : stationCodesForLines(selectedStation.lineCodes));
          map.setFilter('selected-station', ['==', ['get', 'code'], selectedStation.feature.properties.code]);
          if (fareMode) updateFareDisplay();
        } else if (selectedLine) {
          filterLine(selectedLine.code, false);
        }
        setStationsVisible(true);
        setMapStationVisibility();
        setBasemap(el.basemap.value);
        updateTrainToggle();
        renderTrainLocationSource();
        if (trainLocationsEnabled) refreshTrainLocations();
      });
      map.on('error', event => {
        if (event && event.error && /webgl/i.test(event.error.message || '')) showError('The interactive map requires WebGL. Enable browser hardware acceleration.');
      });
      startEtaTimer();
      applyLanguage();
    } catch (error) {
      showError(error.message || String(error));
    }
  }

  function showError(message) {
    el.error.style.display = 'flex';
    el.error.textContent = message;
  }

  el.lineSelect.addEventListener('change', () => {
    if (el.lineSelect.value) showLine(lineByCode.get(el.lineSelect.value), true);
    else {
      clearAllSelection();
      if (map) map.flyTo({ center: [114.16, 22.34], zoom: 9.7, duration: 600 });
    }
  });
  el.directionSelect.addEventListener('change', () => {
    selectedDirection = el.directionSelect.value;
    renderStationList();
  });
  el.stationList.addEventListener('click', event => {
    const button = event.target.closest('button[data-station-code]');
    if (!button) return;
    const feature = stationsByCode.get(button.dataset.stationCode);
    if (feature) toggleStationSelection(feature, [button.dataset.lineCode], true);
  });
  el.detail.addEventListener('click', event => {
    const routeTag = event.target.closest('[data-eta-route-tag]');
    if (routeTag) {
      const lineCode = routeTag.dataset.etaRouteTag;
      etaRouteFilter = etaRouteFilter === lineCode ? null : lineCode;
      applyEtaTagFilters();
      return;
    }
    const directionTag = event.target.closest('[data-eta-direction-tag]');
    if (directionTag) {
      const lineCode = directionTag.closest('.eta-line').dataset.etaLine;
      const direction = directionTag.dataset.etaDirectionTag;
      if (etaDirectionFilters.get(lineCode) === direction) etaDirectionFilters.delete(lineCode);
      else etaDirectionFilters.set(lineCode, direction);
      applyEtaTagFilters();
      return;
    }
    if (event.target.closest('.detail-eta-toggle')) {
      etaDetailsVisible = !etaDetailsVisible;
      updateEtaToggle();
    }
  });
  el.panelClose.addEventListener('click', () => setPanelOpen(false));
  el.toggleStations.addEventListener('click', () => setStationsVisible(!stationVisible));
  el.toggleFares.addEventListener('click', () => setFareMode(!fareMode));
  el.fareCard.addEventListener('change', () => {
    if (fareMode) updateFareDisplay();
  });
  el.basemap.addEventListener('change', () => setBasemap(el.basemap.value));
  el.language.addEventListener('change', () => {
    lang = el.language.value === 'en' ? 'en' : 'tc';
    try { localStorage.setItem('mtr-viewer-lang', lang); } catch (_) {}
    applyLanguage();
  });
  el.theme.addEventListener('click', () => setTheme(theme === 'dark' ? 'light' : 'dark'));
  el.toolbarToggle.addEventListener('click', () => {
    const collapsed = el.toolbar.classList.toggle('collapsed');
    el.toolbarToggle.setAttribute('aria-expanded', String(!collapsed));
  });
  el.search.addEventListener('input', renderSearchResults);
  el.search.addEventListener('focus', renderSearchResults);
  el.search.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSearch();
    if (event.key === 'Enter') {
      const first = el.searchResults.querySelector('button[data-kind]');
      if (first) selectSearchResult(first);
    }
  });
  el.searchResults.addEventListener('click', event => {
    const button = event.target.closest('button[data-kind]');
    if (button) selectSearchResult(button);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.search-wrap')) closeSearch();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && trainLocationController) {
      trainFetchToken += 1;
      trainLocationController.abort();
      trainLocationController = null;
      trainFetchInProgress = false;
    } else if (!document.hidden) {
      if (selectedStation) refreshEta();
      if (trainLocationsEnabled) refreshTrainLocations();
    }
  });

  try {
    if (localStorage.getItem('mtr-viewer-theme') === 'dark') setTheme('dark');
    if (localStorage.getItem('mtr-viewer-lang') === 'en') lang = 'en';
  } catch (_) {}
  el.language.value = lang;
  start();
})();
