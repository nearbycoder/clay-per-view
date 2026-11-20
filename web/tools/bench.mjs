// Frame-rate probe for the renderer test scene (dev/scene.html): headless Chrome with vsync and the frame-rate limit off.
//   node tools/bench.mjs "dev/scene.html?..." [--wait=8] [--size=1920x1080] [--eval=js] [--out=file.png]
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const [target, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.map((a) => a.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.join('=') || '1']));
const [w, h] = (opt.size ?? '1920x1080').split('x').map(Number);
const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'];
if (!opt.vsync) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(new URL(target, 'http://localhost:5199/').href, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, Number(opt.wait ?? 8) * 1000));
const perf = await page.evaluate(() => window.__perf);
console.log(target, JSON.stringify(perf));
if (opt.eval) {
  const value = await page.evaluate(opt.eval);
  if (opt.dump && typeof value === 'string' && value.startsWith('data:image/png;base64,')) writeFileSync(opt.dump, Buffer.from(value.split(',')[1], 'base64'));
  else console.log('eval:', JSON.stringify(value));
}
if (opt.out) await page.screenshot({ path: opt.out });
for (const l of logs.slice(0, 12)) console.log(l);
await browser.close();
