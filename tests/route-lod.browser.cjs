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
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const blankPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/0C/xegAAAABJRU5ErkJggg==', 'base64');
    await page.route('https://**/*', route => route.request().resourceType() === 'image' ? route.fulfill({ contentType: 'image/png', body: blankPng }) : route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'load' });
    try { await page.locator('#map[data-route-lod="low"]').waitFor({ timeout: 30000 }); }
    catch (error) { console.error(JSON.stringify({ pageErrors: errors, lod: await page.locator('#map').getAttribute('data-route-lod') })); throw error; }
    const originalCount = await page.locator('#count').innerText();
    await page.locator('#search').fill('1');
    await page.waitForFunction(value => document.querySelector('#count').textContent !== value, originalCount);
    const filteredCount = await page.locator('#count').innerText();
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    await zoomIn.click(); await zoomIn.click();
    await page.locator('#map[data-route-lod="intermediate"]').waitFor();
    assert.equal(await page.locator('#count').innerText(), filteredCount);
    await zoomIn.click(); await zoomIn.click(); await zoomIn.click();
    await page.locator('#map[data-route-lod="detail"]').waitFor();
    assert.equal(await page.locator('#count').innerText(), filteredCount);
    assert.deepEqual(errors, []);
    console.log('Browser: low geometry switches to the intermediate 328k geometry at the highest zoom while filters remain active.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
