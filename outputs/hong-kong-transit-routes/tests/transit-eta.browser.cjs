const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const future = minutes => new Date(Date.now() + minutes * 60000).toISOString();
    await page.route('https://rt.data.gov.hk/**', async route => {
      const request = route.request(), url = request.url();
      if (request.method() === 'POST') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ busStop: [{ busStopId: '506-D010', busStopName: '榕樹灣', bus: [{ arrivalTimeInSecond: 180 }] }] }) });
      if (url.includes('/route-stop/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ stop: '000125', seq: 1, name_en: '榕樹灣' }] }) });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ eta: future(8) }] }) });
    });
    await page.route('https://data.etagmb.gov.hk/**', async route => {
      const url = route.request().url();
      if (url.includes('/eta/route-stop/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { eta: [{ eta_seq: 1, diff: 4 }, { eta_seq: 2, diff: 17 }] } }) });
      if (url.includes('/route-stop/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { route_stops: [{ stop_id: 20005056, stop_seq: 1, name_tc: '榕樹灣' }] } }) });
      if (url.includes('/stop/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { name_en: '榕樹灣', coordinates: { wgs84: { latitude: 22, longitude: 114 } } } }) });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { eta: [{ eta_seq: 1, diff: 4 }, { eta_seq: 2, diff: 17 }] } }) });
    });
    await page.route('https://www.hkkfeta.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ ETA: future(12) }] }) }));
    await page.setContent(`<html><body><div id="panel" class="detail"><strong>榕樹灣</strong><div class="routes"><div id="heading" class="eta-list-heading">4 routes</div><button class="route-link" data-route-id="1480"><span class="route-badge">1</span><span class="route-name">榕樹灣</span></button><button class="route-link" data-route-id="2004033"><span class="route-badge">49S</span><span class="route-name">榕樹灣</span></button><button class="route-link" data-route-id="1862"><span class="route-badge">506</span><span class="route-name">榕樹灣</span></button><button class="route-link" data-route-id="7009"><span class="route-badge"></span><span class="route-name">中環 - 榕樹灣</span></button></div></div></body></html>`);
    await page.addScriptTag({ content: fs.readFileSync('assets/kmb-eta.js', 'utf8') });
    await page.locator('.route-link:has(.eta-time)').first().waitFor();
    assert.equal(await page.locator('.route-link:has(.eta-time)').count(), 4);
    assert.deepEqual(await page.locator('[data-route-id="2004033"] .eta-time').allTextContents(), ['4', '17']);
    assert.deepEqual(await page.locator('[data-route-id="1862"] .eta-time').allTextContents(), ['3']);
    assert.deepEqual(await page.locator('[data-route-id="7009"] .eta-time').allTextContents(), ['12']);
    assert.deepEqual(await page.locator('[data-route-id="1480"] .eta-time').allTextContents(), ['8']);
    console.log('Browser: Citybus, GMB, MTR bus and HKKF ETA adapters render inline numeric arrivals.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
