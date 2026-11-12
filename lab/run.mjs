// Run a lab experiment headlessly on the real GPU:
//   node lab/run.mjs <experiment> ['{"json":"config"}']
// Starts its own vite server (HMR off, so editing files can't reload a running
// experiment), loads /lab/<experiment>.ts and calls its default export(config). Lines logged via lab.log stream to stdout; frames
// saved with saveFrame land in lab/out/<experiment>/.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { createServer } from 'vite';

const [exp, cfgText = '{}'] = process.argv.slice(2);
const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'out', exp);
fs.mkdirSync(outDir, { recursive: true });
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
  await page.exposeFunction('__log', (line) => console.log(line));
  await page.exposeFunction('__save', (name, url) => fs.writeFileSync(path.join(outDir, name), Buffer.from(url.split(',')[1], 'base64')));
  await page.exposeFunction('__saveText', (name, text) => fs.writeFileSync(path.join(outDir, name), text));
  await page.goto(new URL('lab/blank.html', base).href);
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
