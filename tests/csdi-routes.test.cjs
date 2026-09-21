const {test}=require('node:test');
const assert=require('node:assert/strict');
const {apply,encode,decode,literal,buildLodGeoJson}=require('../scripts/refresh_csdi_routes.cjs');
const html='const packed='+JSON.stringify([{i:'42',s:'1',a:'KMB',e:['old-out','old-in']}])+';const stopPatternPacked='+JSON.stringify([{i:'42',d:[{d:'2',s:[['a'],['b']]},{d:'1',s:[['b'],['a']]}]}])+';const stopPacked='+JSON.stringify([['a','A',114.1,22.3],['b','B',114.2,22.4]])+';';
function feature(seq,paths){return {type:'Feature',properties:{ROUTE_ID:42,ROUTE_SEQ:seq,ROUTE_NAMEE:'1'},geometry:{type:'MultiLineString',coordinates:paths}};}
test('matches direction code and preserves the other direction',()=>{
 const line=[[114.2,22.4],[114.15,22.36],[114.1,22.3]];
 const result=apply(html,[{id:'official',features:[feature(2,[line])]}]);
 const route=literal(result.html,'packed').value[0];
  assert.equal(route.e[0],encode([[114.1,22.3],[114.15,22.36],[114.2,22.4]]));
 assert.equal(route.l.length,2);assert.deepEqual(decode(route.l[0][1]).at(0),[114.1,22.3]);
 assert.equal(route.e[1],'old-in');assert.equal(result.report.matched,1);
});
test('does not bridge disconnected roads or choose duplicate identities',()=>{
 const a=[[[114.1,22.3],[114.11,22.31]],[[114.19,22.39],[114.2,22.4]]];
 for(const features of [[feature(2,a)],[feature(2,[a[0]]),feature(2,[a[1]])]]){
  const result=apply(html,[{id:'official',features}]);
  assert.deepEqual(literal(result.html,'packed').value[0].e,['old-out','old-in']);
 }
});
test('joins contiguous official stop-to-stop road segments',()=>{
 const result=apply(html,[{id:'official',features:[feature(2,[[[114.1,22.3],[114.15,22.36]],[[114.15,22.36],[114.2,22.4]]])]}]);
 assert.equal(literal(result.html,'packed').value[0].e[0],encode([[114.1,22.3],[114.15,22.36],[114.2,22.4]]));
});
test('exports each LOD as GeoJSON with route direction metadata',()=>{
 const result=apply(html,[{id:'official',features:[feature(2,[[[114.1,22.3],[114.15,22.36],[114.2,22.4]]])]}]);
 const patterns=literal(html,'stopPatternPacked').value,geojson=buildLodGeoJson(result.routes,patterns,0,'low');
 assert.equal(geojson.type,'FeatureCollection');assert.equal(geojson.features.length,2);
 assert.deepEqual(geojson.features[0].properties,{route_id:'42',route_number:'1',route_name:undefined,agency:'KMB',direction:'2',pattern_index:0,lod:'low',geometry_provider:'CSDI Transport Department'});
 assert.deepEqual(geojson.features[0].geometry.coordinates,decode(result.routes[0].l[0][0]));
});
