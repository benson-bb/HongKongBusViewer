// Run with NODE_PATH pointing to an installation of Playwright.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve('.');
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname), file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [], externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().startsWith('https://')) externalRequests.push(request.url()); });
    const blankPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/0C/xegAAAABJRU5ErkJggg==', 'base64');
    await page.route('https://**/*', route => route.request().resourceType() === 'image' ? route.fulfill({ contentType: 'image/png', body: blankPng }) : route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'load' });
    await page.locator('#map[data-route-lod][data-basemap="positron"]').waitFor({ timeout: 30000 });
    const options = await page.locator('#basemap option').evaluateAll(nodes => nodes.map(node => [node.value, node.textContent]));
    assert(options.some(([value, label]) => value === 'positron' && label === 'Positron'));
    assert(options.some(([value, label]) => value === 'fiord-color' && label === 'Fiord Color'));
    assert(!options.some(([value]) => value.startsWith('carto-')));
    await page.locator('#basemap').selectOption('fiord-color');
    await page.locator('#map[data-basemap="fiord-color"]').waitFor();
    await page.locator('#basemap').selectOption('positron');
    await page.locator('#map[data-basemap="positron"]').waitFor();
    assert(!externalRequests.some(url => url.includes('cartocdn.com')));
    assert.deepEqual(errors, []);
    console.log('Browser: Positron and Fiord Color replace CARTO and switch from the basemap control.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
