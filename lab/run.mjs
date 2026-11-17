// Run a lab experiment headlessly on the real GPU:
//   node lab/run.mjs <experiment> ['{"json":"config"}']
// Starts its own vite server (HMR off, so editing files can't reload a running
// experiment), loads /lab/<experiment>.ts and calls its default export(config). Lines logged via lab.log stream to stdout; frames
// saved with saveFrame land in lab/out/<experiment>/. For the live viewer (node lab/live.mjs) it also writes the run's log,
// its saved frames and a snapshot every LAB_LIVE steps (default 1000; 0 for none) to lab/out/_live/.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { createServer } from 'vite';

const [exp, cfgText = '{}'] = process.argv.slice(2);
const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'out', exp);
fs.mkdirSync(outDir, { recursive: true });
const liveDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'out', '_live');
fs.mkdirSync(liveDir, { recursive: true });
const liveEvery = Number(process.env.LAB_LIVE ?? 1000);
// this run: its name and config, a fresh log, a frame counter (the viewer keeps the last few)
let liveN = 0;
fs.writeFileSync(path.join(liveDir, 'run.json'), JSON.stringify({ exp, cfg: cfgText, started: Date.now(), frames: 0 }));
fs.writeFileSync(path.join(liveDir, 'log.txt'), '');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const server = await createServer({ root, logLevel: 'error', server: { port: 0, hmr: false, watch: null } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome-stable',
  headless: 'new',
  protocolTimeout: 0,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--disable-vulkan-surface'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.exposeFunction('__log', (line) => { console.log(line); fs.appendFileSync(path.join(liveDir, 'log.txt'), line + '\n'); });
  await page.exposeFunction('__live', (url, caption) => {
    // written aside then renamed, so the viewer never reads half a frame
    const name = `frame-${String(liveN++ % 8)}.png`, tmp = path.join(liveDir, name + '.tmp');
    fs.writeFileSync(tmp, Buffer.from(url.split(',')[1], 'base64'));
    fs.renameSync(tmp, path.join(liveDir, name));
    fs.writeFileSync(path.join(liveDir, 'run.json'), JSON.stringify({ exp, cfg: cfgText, started: Date.now(), frames: liveN, last: name, caption }));
  });
  await page.exposeFunction('__save', (name, url) => {
    fs.mkdirSync(path.dirname(path.join(outDir, name)), { recursive: true });
    fs.writeFileSync(path.join(outDir, name), Buffer.from(url.split(',')[1], 'base64'));
  });
  await page.exposeFunction('__saveText', (name, text) => fs.writeFileSync(path.join(outDir, name), text));
  await page.goto(new URL('lab/blank.html', base).href);
  await page.evaluate((n) => { window.__liveEvery = n; }, liveEvery);
  const result = await page.evaluate(async (exp, cfg) => {
    const m = await import(`/lab/${exp}.ts`);
    return JSON.stringify(await m.default(cfg));
  }, exp, JSON.parse(cfgText));
  if (result && result !== 'undefined') {
    fs.writeFileSync(path.join(outDir, 'result.json'), result);
    console.log('result →', path.join(outDir, 'result.json'));
  }
} finally {
  await browser.close();
  await server.close();
}
