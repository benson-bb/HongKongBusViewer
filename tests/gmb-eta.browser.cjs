const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    let routeStopCalls = 0, etaCalls = 0;
    await page.route('https://data.etagmb.gov.hk/**', async route => {
      const url = route.request().url();
      if (url.includes('/eta/route-stop/')) {
        etaCalls++;
        assert.ok(url.endsWith('/eta/route-stop/2002085/1/2'));
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { enabled: true, eta: [{ eta_seq: 1, diff: 4 }] } }) });
      }
      if (url.includes('/route-stop/')) {
        routeStopCalls++;
        const routeStops = url.endsWith('/route-stop/2002085/1')
          ? [{ stop_seq: 2, stop_id: 20020852, name_tc: '雅竹街，竹園南村雅園樓', name_en: 'Ya Chuk Street, Chuk Yuen South Estate' }]
          : [{ stop_seq: 1, stop_id: 20020851, name_tc: '其他街道', name_en: 'Other Street' }];
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { route_stops: routeStops } }) });
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { coordinates: { wgs84: { latitude: 22, longitude: 114 } } } }) });
    });
    await page.setContent('<html><body><div class="detail"><strong>竹園南邨趣園樓, 雅竹街</strong><div class="routes"><div id="heading">1 route</div><button class="route-link" data-route-id="2002085"><span class="route-badge">18M</span><span class="route-name">Test route</span></button></div></div></body></html>');
    await page.addScriptTag({ content: fs.readFileSync('assets/kmb-eta.js', 'utf8') });
    await page.locator('[data-route-id="2002085"] .eta-time').waitFor();
    assert.deepEqual(await page.locator('[data-route-id="2002085"] .eta-time').allTextContents(), ['4']);
    assert.equal(routeStopCalls, 2);
    assert.equal(etaCalls, 1);
    console.log('Browser: GMB route_stops match reversed stop-name components and request the correct 18M ETA endpoint.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
