const test=require('node:test');
const assert=require('node:assert/strict');
const {indexMetadata,matchStop,filterEtas,minutesFrom}=require('../assets/kmb-eta.js');
const stops=[{stop:'A',long:114,lat:22},{stop:'B',long:114.001,lat:22},{stop:'C',long:114.002,lat:22},{stop:'X',long:114.001,lat:22.0001}];
const rows=['A','B','C'].map((stop,i)=>({stop,route:'1A',bound:'O',service_type:'1',seq:i+1}));
const station={coordinates:[114.001,22]};
const routes=[{number:'1A',neighbours:[{before:[114,22],after:[114.002,22]}]}];
test('matches coordinates and ordered neighbouring stops',()=>{
 const result=matchStop(indexMetadata(stops,rows),station,routes);
 assert.equal(result.matches[0].stop.stop,'B');assert.equal(result.matches[0].rows[0].bound,'O');
});
test('rejects the opposite direction even when its stop is closer',()=>{
 const reversed=['C','X','A'].map((stop,i)=>({stop,route:'1A',bound:'I',service_type:1,seq:i+1}));
 assert.equal(matchStop(indexMetadata(stops,reversed),station,routes).matches.length,0);
});
test('matches service variants independently at different platforms',()=>{
 const duplicate=rows.map(r=>({...r,stop:r.stop==='B'?'X':r.stop,service_type:2}));
 assert.deepEqual(matchStop(indexMetadata(stops,[...rows,...duplicate]),station,routes).matches.map(m=>m.stop.stop),['B','X']);
});
test('rejects ambiguous platforms within the same direction and variant, and missing evidence',()=>{
 const loop=[rows[0],rows[1],{...rows[1],stop:'X',seq:3},{...rows[2],seq:4}];
 const shortStops=stops.map(s=>({...s,long:s.stop==='A'?114.0005:s.stop==='C'?114.0015:s.long}));
 const nearPair=[{number:'1A',neighbours:[{before:[114.0005,22],after:[114.0015,22]}]}];
 assert.equal(matchStop(indexMetadata(shortStops,loop),station,nearPair).matches.length,0);
 assert.equal(matchStop(indexMetadata(stops,rows),station,[{number:'1A',neighbours:[{}]}]).matches.length,0);
});
test('filters ETA by route, direction, variant and stop sequence',()=>{
 const match=matchStop(indexMetadata(stops,rows),station,routes).matches[0];
 const good={route:'1A',dir:'O',service_type:1,seq:2,eta_seq:1};
 assert.deepEqual(filterEtas([good,{...good,dir:'I'},{...good,service_type:2},{...good,seq:3},{...good,route:'2'}],match),[good]);
});
test('one missing route does not hide another route; API requests can share a stop',()=>{
 const extra=rows.map(r=>({...r,route:'2'}));
 const route2={...routes[0],number:'2'};
 const result=matchStop(indexMetadata(stops,[...rows,...extra]),station,[...routes,route2,{number:'3',neighbours:[{...routes[0].neighbours[0],label:'3 → Central'}]}]);
 assert.equal(result.matches.length,1);assert.equal(result.matches[0].rows.length,2);
 assert.deepEqual(result.unresolved,[{number:'3',label:'3 → Central'}]);
});
test('normalized names distinguish nearby stops when distance alone is ambiguous',()=>{
 const named=stops.map(s=>({...s,long:s.stop==='A'?114.0005:s.stop==='C'?114.0015:s.long,name_tc:s.stop==='B'?'富城閣 (ED123)':'另一站'}));
 const loop=[rows[0],rows[1],{...rows[1],stop:'X',seq:3},{...rows[2],seq:4}];
 const result=matchStop(indexMetadata(named,loop),{...station,name:'富城閣, 柴灣道'},[{number:'1A',neighbours:[{before:[114.0005,22],after:[114.0015,22]}]}]);
 assert.equal(result.matches.length,1);assert.equal(result.matches[0].stop.stop,'B');
});
test('directions at separate stops remain separate and repeated local patterns do not duplicate rows',()=>{
 const inbound=['C','X','A'].map((stop,i)=>({stop,route:'1A',bound:'I',service_type:1,seq:i+1}));
 const both=[{number:'1A',neighbours:[...routes[0].neighbours,...routes[0].neighbours,{before:[114.002,22],after:[114,22]}]}];
 const result=matchStop(indexMetadata(stops,[...rows,...inbound]),station,both);
 assert.equal(result.matches.length,2);assert.equal(result.matches.flatMap(m=>m.rows).length,2);assert.equal(result.unresolved.length,0);
});
test('missing or expired arrivals are not coerced to zero minutes',()=>{
 const now=Date.now();
 assert.equal(minutesFrom(null),null);
 assert.equal(minutesFrom(''),null);
 assert.equal(minutesFrom(0),null);
 assert.equal(minutesFrom(new Date(now-1000).toISOString()),null);
 assert.equal(minutesFrom(new Date(now+1000).toISOString()),1);
});
