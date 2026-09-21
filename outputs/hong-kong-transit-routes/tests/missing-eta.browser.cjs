const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const stops = [{ stop: 'A', long: 114, lat: 22 }, { stop: 'B', long: 114.001, lat: 22 }, { stop: 'C', long: 114.002, lat: 22 }];
    const routeStops = stops.map((stop, index) => ({ stop: stop.stop, route: '102', bound: 'O', service_type: '1', seq: index + 1 }));
    await page.route('https://data.etabus.gov.hk/**', async route => {
      const url = route.request().url();
      if (url.endsWith('/stop/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: stops }) });
      if (url.endsWith('/route-stop/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: routeStops }) });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ generated_timestamp: new Date().toISOString(), data: [{ route: '102', dir: 'O', service_type: 1, seq: 2, eta_seq: 1, eta: null }, { route: '102', dir: 'O', service_type: 1, seq: 2, eta_seq: 2, eta: new Date(Date.now() + 2 * 60000).toISOString() }] }) });
    });
    await page.setContent('<html><body><div id="heading"></div><button id="route" class="route-link">102</button></body></html>');
    await page.addScriptTag({ content: fs.readFileSync('assets/kmb-eta.js', 'utf8') });
    await page.evaluate(() => KmbEta.mount(document.querySelector('#heading'), { lang: 'en', station: { coordinates: [114.001, 22], name: 'Stop' }, routes: [{ id: '102', number: '102', neighbours: [{ before: [114, 22], after: [114.002, 22] }] }], targets: { 102: document.querySelector('#route') } }));
    await page.locator('#route .eta-time').waitFor();
    assert.deepEqual(await page.locator('#route .eta-time').allTextContents(), ['2']);
    console.log('Browser: missing KMB ETA values are omitted instead of rendered as zero.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
