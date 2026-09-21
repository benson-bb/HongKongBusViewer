const fs = require('fs');
const path = require('path');

const feed = path.join(__dirname, '..', 'data', 'gtfs');
const out = path.join(__dirname, '..', 'data', 'route-data.json');

function csv(line) {
  const a = []; let s = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { s += '"'; i++; }
      else q = !q;
    } else if (c === ',' && !q) { a.push(s); s = ''; }
    else s += c;
  }
  a.push(s); return a;
}

function rows(name, fn) {
  const lines = fs.readFileSync(path.join(feed, name), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const head = csv(lines[0]);
  const ix = Object.fromEntries(head.map((x, i) => [x, i]));
  for (let i = 1; i < lines.length; i++) if (lines[i]) fn(csv(lines[i]), ix);
}

const routes = new Map();
rows('routes.txt', (r, i) => routes.set(r[i.route_id], {
  id: r[i.route_id], agency: r[i.agency_id], short: r[i.route_short_name], long: r[i.route_long_name]
}));

const stops = new Map();
rows('stops.txt', (r, i) => stops.set(r[i.stop_id], [+r[i.stop_lon], +r[i.stop_lat]]));

const selected = new Map();
const seenDirection = new Set();
rows('trips.txt', (r, i) => {
  const route = r[i.route_id], trip = r[i.trip_id];
  const parts = trip.split('-');
  const dir = parts.length > 2 ? parts[1] : '0';
  const key = route + '|' + dir;
  if (!seenDirection.has(key)) { seenDirection.add(key); selected.set(trip, {route, dir, pts: []}); }
});

rows('stop_times.txt', (r, i) => {
  const trip = selected.get(r[i.trip_id]);
  if (!trip) return;
  const p = stops.get(r[i.stop_id]);
  if (p) trip.pts.push(p);
});

function simplify(points, tolerance = 0.002) {
  if (points.length <= 2) return points;
  const sq = tolerance * tolerance;
  function dist(p, a, b) {
    let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
    if (dx || dy) { const t = Math.max(0, Math.min(1, ((p[0]-x)*dx + (p[1]-y)*dy)/(dx*dx+dy*dy))); x += dx*t; y += dy*t; }
    dx = p[0]-x; dy = p[1]-y; return dx*dx+dy*dy;
  }
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length-1] = 1;
  const stack = [[0, points.length-1]];
  while (stack.length) {
    const [a,b] = stack.pop(); let best = sq, idx = -1;
    for (let j=a+1;j<b;j++) { const d=dist(points[j],points[a],points[b]); if(d>best){best=d;idx=j;} }
    if(idx>=0){keep[idx]=1;stack.push([a,idx],[idx,b]);}
  }
  return points.filter((_,i)=>keep[i]).map(p=>[+p[0].toFixed(5),+p[1].toFixed(5)]);
}

const grouped = new Map();
for (const t of selected.values()) {
  if (t.pts.length < 2 || !routes.has(t.route)) continue;
  const m = routes.get(t.route);
  if (!grouped.has(m.id)) grouped.set(m.id, {i:m.id,a:m.agency,s:m.short,n:m.long,p:[]});
  grouped.get(m.id).p.push(simplify(t.pts));
}

const result = [...grouped.values()];
fs.writeFileSync(out, JSON.stringify(result));
console.log(JSON.stringify({routes: routes.size, mapped: result.length, patterns: selected.size, bytes: fs.statSync(out).size}));
