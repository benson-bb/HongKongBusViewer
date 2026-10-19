const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const project = path.join(__dirname, '..');
const feed = path.join(project, 'data', 'gtfs');
const htmlPath = path.join(project, 'index.html');
const dayFields = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function csv(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else value += char;
  }
  values.push(value);
  return values;
}

async function readRows(file, visit) {
  const input = fs.createReadStream(path.join(feed, file), { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let columns;
  let index;
  for await (let line of lines) {
    if (columns === undefined) {
      line = line.replace(/^\uFEFF/, '');
      columns = csv(line);
      index = Object.fromEntries(columns.map((name, i) => [name, i]));
      continue;
    }
    if (line) visit(csv(line), index);
  }
  if (!columns) throw new Error(`Missing or empty GTFS file: ${file}`);
}

function timeSeconds(value) {
  const [hours, minutes, seconds = '0'] = value.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

function minuteOfHeadway(seconds) {
  return seconds / 60;
}

function dayMaskOrder(mask) {
  const order = ['1111100', '1111110', '1111111', '0000011', '0000010', '0000001', '0000000'];
  const index = order.indexOf(mask);
  return index < 0 ? order.length : index;
}

function findArrayEnd(source, start) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '[') depth++;
    else if (char === ']' && --depth === 0) return i + 1;
  }
  throw new Error('Could not find the end of stopPatternPacked data.');
}

async function buildSchedules() {
  for (const file of ['trips.txt', 'stop_times.txt', 'frequencies.txt', 'calendar.txt']) {
    if (!fs.existsSync(path.join(feed, file))) throw new Error(`Missing ${path.join(feed, file)}`);
  }

  const calendars = new Map();
  await readRows('calendar.txt', (row, index) => {
    const serviceId = row[index.service_id];
    calendars.set(serviceId, dayFields.map(day => row[index[day]] === '1' ? '1' : '0').join(''));
  });

  const trips = new Map();
  await readRows('trips.txt', (row, index) => {
    const tripId = row[index.trip_id];
    const parts = tripId.split('-');
    trips.set(tripId, {
      route: row[index.route_id],
      direction: parts.length > 2 ? parts[1] : '0',
      service: row[index.service_id]
    });
  });

  const groups = new Map();
  const tripsWithFrequency = new Set();
  const getGroup = trip => {
    const days = calendars.get(trip.service) || '0000000';
    const key = `${trip.route}|${trip.direction}|${days}`;
    if (!groups.has(key)) groups.set(key, { route: trip.route, direction: trip.direction, days, windows: [], times: new Set() });
    return groups.get(key);
  };

  await readRows('frequencies.txt', (row, index) => {
    const tripId = row[index.trip_id];
    const trip = trips.get(tripId);
    if (!trip) return;
    const group = getGroup(trip);
    const start = row[index.start_time];
    const end = row[index.end_time];
    const headway = Number(row[index.headway_secs]);
    if (!start || !end || !Number.isFinite(headway) || headway <= 0) return;
    group.windows.push({ start, end, headway });
    tripsWithFrequency.add(tripId);
  });

  await readRows('stop_times.txt', (row, index) => {
    if (row[index.stop_sequence] !== '1') return;
    const tripId = row[index.trip_id];
    const trip = trips.get(tripId);
    if (!trip || tripsWithFrequency.has(tripId)) return;
    const time = row[index.departure_time] || row[index.arrival_time];
    if (time) getGroup(trip).times.add(time.slice(0, 5));
  });

  const result = new Map();
  for (const group of groups.values()) {
    const windows = group.windows.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    const merged = [];
    for (const window of windows) {
      const previous = merged.at(-1);
      if (previous && timeSeconds(window.start) <= timeSeconds(previous.end)) {
        if (timeSeconds(window.end) > timeSeconds(previous.end)) previous.end = window.end;
        previous.min = Math.min(previous.min, window.headway);
        previous.max = Math.max(previous.max, window.headway);
      } else {
        merged.push({ start: window.start, end: window.end, min: window.headway, max: window.headway });
      }
    }

    const schedule = {
      d: group.days,
      w: merged.map(window => ({
        s: window.start.slice(0, 5),
        e: window.end.slice(0, 5),
        h: [minuteOfHeadway(window.min), minuteOfHeadway(window.max)]
      })),
      t: [...group.times].sort()
    };
    const key = `${group.route}|${group.direction}`;
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(schedule);
  }

  for (const schedules of result.values()) schedules.sort((a, b) => dayMaskOrder(a.d) - dayMaskOrder(b.d) || a.d.localeCompare(b.d));
  return result;
}

async function main() {
  const schedules = await buildSchedules();
  const html = fs.readFileSync(htmlPath, 'utf8');
  const marker = 'stopPatternPacked=';
  const markerAt = html.indexOf(marker);
  if (markerAt < 0) throw new Error('Could not find stopPatternPacked in index.html.');
  const start = markerAt + marker.length;
  const end = findArrayEnd(html, start);
  const patterns = JSON.parse(html.slice(start, end));
  let matched = 0;
  let missing = 0;

  for (const route of patterns) {
    for (const pattern of route.d || []) {
      delete pattern.t;
      pattern.q = schedules.get(`${route.i}|${pattern.d}`) || [];
      if (pattern.q.length) matched++;
      else missing++;
    }
  }

  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ routePatterns: patterns.reduce((n, route) => n + (route.d || []).length, 0), matched, missing, scheduledRouteDirections: schedules.size }, null, 2));
    return;
  }

  const nextHtml = html.slice(0, start) + JSON.stringify(patterns) + html.slice(end);
  fs.writeFileSync(htmlPath, nextHtml);
  console.log(JSON.stringify({ routePatterns: patterns.reduce((n, route) => n + (route.d || []).length, 0), matched, missing, scheduledRouteDirections: schedules.size, bytes: fs.statSync(htmlPath).size }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
