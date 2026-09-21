// Run with NODE_PATH pointing to an installation of Playwright.
const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const stops=[{stop:'A',long:114,lat:22},{stop:'B',long:114.001,lat:22},{stop:'C',long:114.002,lat:22},{stop:'X',long:114.001,lat:22.0001}];
  const routeStops=stops.slice(0,3).map((s,i)=>({stop:s.stop,route:'1A',bound:'O',service_type:'1',seq:i+1}));
  routeStops.push(...routeStops.map(r=>({...r,route:'2',stop:r.stop==='B'?'X':r.stop})));
  let failure=false,etaCalls=0;
  await page.route('https://data.etabus.gov.hk/**',async route=>{
   const url=route.request().url();let data;
   if(url.endsWith('/stop/')) data=stops;
   else if(url.endsWith('/route-stop/')) data=routeStops;
   else {etaCalls++;if(failure===true || failure==='X'&&url.endsWith('/X'))return route.fulfill({status:503,body:'unavailable'});data=[2,8,20].map((minutes,i)=>({route:url.endsWith('/X')?'2':'1A',dir:'O',service_type:1,seq:2,eta_seq:i+1,dest_en:'Terminus',eta:new Date(Date.now()+minutes*60000).toISOString(),rmk_en:i===0?'<img src=x onerror=alert(1)>':''}));}
   await route.fulfill({contentType:'application/json',body:JSON.stringify({generated_timestamp:new Date().toISOString(),data})});
  });
  await page.setContent('<html><style>:root{--text:#172033;--panel:white;--border:#cbd3df;--muted:#647084;--bg:#f4f6f8;--focus:#2563eb}body{font-family:system-ui}#panel{width:286px;padding:12px}.route-link{display:grid;width:100%;padding:8px 4px;grid-template-columns:auto minmax(0,1fr);gap:8px;border:0;border-bottom:1px solid #cbd3df;background:transparent;text-align:left}.route-name{min-width:0}</style><body><div id="panel"><div id="heading" class="eta-list-heading">3 routes</div><button class="route-link" data-id="1A"><b>1A</b><span class="route-name">Terminus</span></button><button class="route-link" data-id="2"><b>2</b><span class="route-name">Terminus</span></button><button class="route-link" data-id="3"><b>3</b><span class="route-name">Terminus</span></button></div></body></html>');
  await page.addStyleTag({content:fs.readFileSync('assets/kmb-eta.css','utf8')});
  await page.clock.install();
  await page.addScriptTag({content:fs.readFileSync('assets/kmb-eta.js','utf8')});
  await page.evaluate(()=>KmbEta.mount(document.querySelector('#heading'),{lang:'en',targets:Object.fromEntries([...document.querySelectorAll('[data-id]')].map(e=>[e.dataset.id,e])),station:{coordinates:[114.001,22]},routes:['1A','2','3'].map(number=>({number,neighbours:[{before:[114,22],after:[114.002,22]}]}))}));
  await page.locator('.route-link:has(.eta-time)').first().waitFor();assert.match(await page.locator('.route-link:has(.eta-time)').first().innerText(),/1A.*Terminus/s);
  assert.equal(await page.locator('.route-link:has(.eta-time)').count(),2);assert.equal(etaCalls,2);
  const first=page.locator('.route-link:has(.eta-time)').first();
  assert.equal(await first.locator('.eta-time').count(),3);
  assert.equal(await first.locator('.eta-soon').count(),1);assert.equal(await first.locator('.eta-later').count(),1);assert.equal(await first.locator('.eta-distant').count(),1);
  assert.equal(await page.getByRole('button',{name:'Refresh',exact:true}).innerText(),'');
  assert.equal(await page.locator('.eta-refresh svg').count(),1);
  assert.equal(await page.locator('.eta-panel,.eta-row,.eta-legend').count(),0);assert.deepEqual(await first.locator('.eta-time').allTextContents(),['2','8','20']);
  const routeBox=await first.locator('b').boundingBox(),timesBox=await first.locator('.eta-times').boundingBox();
  assert(timesBox.x>routeBox.x);assert(Math.abs(timesBox.y-routeBox.y)<10);
  assert(await page.locator('#panel').evaluate(e=>e.scrollWidth<=e.clientWidth));
  await page.screenshot({path:'work/kmb/inline-arrivals.png'});
  await page.clock.fastForward(60000);
  await page.waitForFunction(()=>!document.querySelector('.eta-refresh').disabled);
  assert.equal(etaCalls,4,'Automatically requests both stops after one minute');
  assert.match(await page.locator('[role=status]').innerText(),/Unavailable: 3/);
  assert.equal(await page.locator('#panel img').count(),0);
  assert.match(await page.locator('[role=status]').innerText(),/HKT/);
  failure='X';await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.eta-refresh').disabled);
  assert.equal(await page.locator('.route-link:has(.eta-time)').count(),1);assert.match(await page.locator('.route-link:has(.eta-time)').innerText(),/1A/);
  assert.match(await page.locator('[role=status]').innerText(),/Unavailable: 3 \/ 2/);
  failure=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Please retry'}).waitFor();assert.equal(await page.locator('.route-link:has(.eta-time)').count(),0);
  const before=etaCalls;
  await page.evaluate(()=>document.querySelector('#panel').remove());await page.clock.fastForward(61000);
  assert.equal(etaCalls,before);assert.deepEqual(errors,[]);
  console.log('Browser: numeric arrivals added to original bus buttons, no separate list; color bands, icon label, minute refresh, partial failures and disposal verified.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
