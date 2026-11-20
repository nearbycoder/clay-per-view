// Opens a page of the dev server in headless Chrome and saves screenshots.
//   node tools/shot.mjs <path?query> <out.png> [--wait=3] [--size=1280x720] [--keys=Enter@2,KeyD@3:1.5] [--shots=name@sec,...] [--eval=js]
import { chromium } from 'playwright-core';

const [target, out, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.map((a) => a.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.join('=') || '1']));
const [w, h] = (opt.size ?? '1280x720').split('x').map(Number);
const base = opt.base ?? 'http://localhost:5199/';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: Number(opt.dpr ?? 1) });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (opt.log || m.type() === 'error' || m.type() === 'warning' || t.startsWith('CPV_')) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
const started = Date.now();
await page.goto(new URL(target, base).href, { waitUntil: 'load' });
const events = [];
for (const item of (opt.keys ?? '').split(',').filter(Boolean)) {
  const [key, when] = item.split('@');
  const [at, hold] = when.split(':').map(Number);
  events.push({ at, run: () => page.keyboard.down(key) });
  events.push({ at: at + (hold ?? 0.08), run: () => page.keyboard.up(key) });
}
for (const item of (opt.clicks ?? '').split(',').filter(Boolean)) {
  const [pt, when] = item.split('@');
  const [x, y] = pt.split(':').map(Number);
  events.push({ at: Number(when), run: () => page.mouse.click(x * w, y * h) });
}
const stem = out.replace(/\.png$/, '');
for (const item of (opt.shots ?? '').split(',').filter(Boolean)) {
  const [name, when] = item.split('@');
  events.push({ at: Number(when), run: () => page.screenshot({ path: `${stem}-${name}.png` }) });
}
const wait = Number(opt.wait ?? 3);
events.push({ at: wait, run: async () => {
  // --done=<seconds>: keep going until the game reports the scripted run finished (or the time is up).
  if (opt.done) {
    const limit = Date.now() + Number(opt.done) * 1000;
    while (Date.now() < limit && !(await page.evaluate(() => window.__cpvDone || window.__error))) await new Promise((r) => setTimeout(r, 250));
  }
  if (opt.eval) console.log('eval:', JSON.stringify(await page.evaluate(opt.eval)));
  await page.screenshot({ path: out });
} });
events.sort((a, b) => a.at - b.at);
for (const e of events) {
  const delay = e.at * 1000 - (Date.now() - started);
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  await e.run();
}
const info = await page.evaluate(() => ({ frames: window.__frames, error: window.__error }));
console.log(JSON.stringify(info));
for (const l of logs.slice(0, Number(opt.maxlog ?? 40))) console.log(l);
await browser.close();
