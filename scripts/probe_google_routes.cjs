// One diagnostic request only. Do not store or put Google geometry on MapLibre.
const fs=require('node:fs'),path=require('node:path');
const data=path.resolve(__dirname,'../data');
async function main(){
 const key=process.env.google_routes_api;
 if(!key) throw Error('User environment variable google_routes_api is unavailable.');
 const report=JSON.parse(fs.readFileSync(path.join(data,'csdi-coverage.json'),'utf8'));
 const candidates=report.missing.filter(r=>r.stops.length>=2);
 console.log(JSON.stringify({uncoveredDirections:candidates.length,estimatedCalls:candidates.reduce((n,r)=>n+Math.ceil((r.stops.length-1)/11),0)}));
 const target=candidates[0];if(!target)return;
 const ledgerPath=path.join(data,'google-request-ledger.json');
 let ledger={};try{ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));}catch{}
 const month=new Date().toISOString().slice(0,7);
 if((ledger[month]||0)>=9000)throw Error('Local monthly guard reached.');
 // Reserve before transmission, including failed/uncertain requests. Never retry automatically.
 ledger[month]=(ledger[month]||0)+1;fs.writeFileSync(ledgerPath,JSON.stringify(ledger));
 const points=target.stops.slice(0,12),waypoint=p=>({location:{latLng:{latitude:p[1],longitude:p[0]}}});
 const r=await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{
  method:'POST',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'routes.polyline.encodedPolyline,routes.distanceMeters'},
  body:JSON.stringify({origin:waypoint(points[0]),destination:waypoint(points.at(-1)),intermediates:points.slice(1,-1).map(waypoint),travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE'})
 });
 const body=await r.json();
 console.log(JSON.stringify({status:r.status,route:target.route,agency:target.agency,direction:target.direction,requestedStops:points.length,hasPolyline:!!body.routes?.[0]?.polyline?.encodedPolyline,errorStatus:body.error?.status,errorReasons:body.error?.details?.map(d=>d.reason).filter(Boolean)}));
 if(!r.ok)process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
