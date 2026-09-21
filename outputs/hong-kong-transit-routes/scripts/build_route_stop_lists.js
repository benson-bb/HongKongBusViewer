const fs = require('fs');
const path = require('path');

const project = path.join(__dirname, '..');
const feed = path.join(project, 'data', 'gtfs');
const output = path.join(project, 'data', 'route-stop-patterns.json');

function csv(line) {
  const out=[]; let value='', quoted=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++}else quoted=!quoted}
    else if(c===','&&!quoted){out.push(value);value=''}else value+=c;
  }
  out.push(value); return out;
}

function rows(name, visit) {
  const lines=fs.readFileSync(path.join(feed,name),'utf8').replace(/^\uFEFF/,'').split(/\r?\n/);
  const header=csv(lines[0]), index=Object.fromEntries(header.map((x,i)=>[x,i]));
  for(let i=1;i<lines.length;i++)if(lines[i])visit(csv(lines[i]),index);
}

const cleanStops=new Map(JSON.parse(fs.readFileSync(path.join(project,'data','stop-routes.json'),'utf8')).map(s=>[String(s[0]),s[1]]));
const selected=new Map(), byKey=new Map(), tripKeys=new Map(), startTimes=new Map();
rows('trips.txt',(r,i)=>{
  const route=r[i.route_id],trip=r[i.trip_id],parts=trip.split('-'),direction=parts.length>2?parts[1]:'0',key=route+'|'+direction;
  tripKeys.set(trip,key);
  if(!byKey.has(key)){const pattern={route,direction,key,stops:[]};byKey.set(key,pattern);selected.set(trip,pattern)}
});
rows('stop_times.txt',(r,i)=>{
  const trip=r[i.trip_id],key=tripKeys.get(trip),time=r[i.departure_time]||r[i.arrival_time]||'';
  if(key&&String(r[i.stop_sequence])==='1'&&time){if(!startTimes.has(key))startTimes.set(key,new Set());startTimes.get(key).add(time.slice(0,5))}
  const pattern=selected.get(trip);if(!pattern)return;
  const id=String(r[i.stop_id]),name=(cleanStops.get(id)||id).replace(/\/?<BR>/gi,' / ');
  pattern.stops.push([id,name]);
});
const grouped=new Map();
for(const pattern of byKey.values()){
  if(!pattern.stops.length)continue;
  const first=pattern.stops[0][1],last=pattern.stops[pattern.stops.length-1][1];
  if(!grouped.has(pattern.route))grouped.set(pattern.route,[]);
  grouped.get(pattern.route).push({d:pattern.direction,l:first+' → '+last,t:[...(startTimes.get(pattern.key)||[])].sort(),s:pattern.stops});
}
const result=[...grouped].map(([i,d])=>({i,d}));
fs.writeFileSync(output,JSON.stringify(result));
console.log(JSON.stringify({routes:result.length,patterns:result.reduce((n,r)=>n+r.d.length,0),bytes:fs.statSync(output).size}));
