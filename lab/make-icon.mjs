// Make the app icons (public/icon-512.png, icon-192.png) from the U-skate world
// scene: three U-skates meet and freeze into a cluster of six negatons. Runs the
// scene in the dev server (needs `npx vite` on port 5173 and window.rdui), waits
// until the field stops changing, then renders b (0..0.4) with the lab's palette, centred on the cluster and scaled so it fills the maskable
// safe zone (the middle 80% circle).
//   node lab/make-icon.mjs [url]
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const SIZES = [512, 192];
const FILL = 0.62; // cluster radius (with its halo) as a fraction of the icon's half-width

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--disable-vulkan-surface'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${url}#rule=scene%3Auskate-world`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 3000));
  await page.evaluate(() => { window.rdui.settings.stepsPerFrame = 400; });
  const read = () => page.evaluate(async () => {
    const sim = window.rdui.sim, N = sim.width, { state } = await sim.readRegion(0, 0, N, N), S4 = sim.layout.S * 4;
    return Array.from({ length: N * N }, (_, c) => state[c * S4 + 1]);
  });
  let prev = null, b = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    b = await read();
    const diff = prev ? b.reduce((s, v, j) => s + Math.abs(v - prev[j]), 0) / b.length : 1;
    console.log(`settling: change ${diff.toExponential(1)}`);
    if (diff < 1e-6) break;
    prev = b;
  }
  for (const size of SIZES) {
    const png = await page.evaluate((b, size, FILL) => {
      const N = Math.round(Math.sqrt(b.length));
      // cluster centre: circular mean of the hole cells (the field wraps)
      let sx = 0, cx = 0, sy = 0, cy = 0, n = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (b[y * N + x] < 0.15) {
        const ax = (2 * Math.PI * x) / N, ay = (2 * Math.PI * y) / N;
        sx += Math.sin(ax); cx += Math.cos(ax); sy += Math.sin(ay); cy += Math.cos(ay); n++;
      }
      const mx = ((Math.atan2(sx, cx) / (2 * Math.PI)) * N + N) % N, my = ((Math.atan2(sy, cy) / (2 * Math.PI)) * N + N) % N;
      const wrap = (d) => ((d + N / 2) % N + N) % N - N / 2;
      let rmax = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (b[y * N + x] < 0.15) rmax = Math.max(rmax, Math.hypot(wrap(x - mx), wrap(y - my)));
      const radius = rmax + 7; // the pale halo around each dot
      const scale = (FILL * size) / 2 / radius; // output pixels per cell
      const at = (x, y) => b[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
      const sample = (x, y) => {
        const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      };
      // the lab's palette (lab.ts PAL), as the original icon
      const PAL = [[5, 8, 14], [20, 40, 90], [40, 130, 170], [240, 220, 140], [255, 255, 255]];
      const pal = (t) => { t *= PAL.length - 1; const i = Math.min(PAL.length - 2, Math.floor(t)), f = t - i; return PAL[i].map((c, k) => (c + (PAL[i + 1][k] - c) * f) / 255); };
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const g = cv.getContext('2d'), img = g.createImageData(size, size);
      for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
        // 3×3 supersampling
        const acc = [0, 0, 0];
        for (let sy2 = 0; sy2 < 3; sy2++) for (let sx2 = 0; sx2 < 3; sx2++) {
          const fx = mx + (px + (sx2 + 0.5) / 3 - size / 2) / scale - 0.5, fy = my + (py + (sy2 + 0.5) / 3 - size / 2) / scale - 0.5;
          const col = pal(Math.min(1, Math.max(0, sample(fx, fy) / 0.4)));
          for (let k = 0; k < 3; k++) acc[k] += col[k] / 9;
        }
        const o = (py * size + px) * 4;
        for (let k = 0; k < 3; k++) img.data[o + k] = Math.round(Math.min(1, Math.max(0, acc[k])) * 255);
        img.data[o + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      return cv.toDataURL('image/png').split(',')[1];
    }, b, size, FILL);
    writeFileSync(`public/icon-${size}.png`, Buffer.from(png, 'base64'));
    console.log(`wrote public/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
