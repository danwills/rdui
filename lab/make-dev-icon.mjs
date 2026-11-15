// Make the dev build's icons (public/icon-dev-512.png, icon-dev-192.png): the app icons with an
// orange DEV badge, kept inside the maskable safe zone (the middle 80% circle) so launchers'
// round crops don't cut it. The local build (npm run build) installs with these; the cloud
// build (npm run deploy) keeps the plain ones.
//   node lab/make-dev-icon.mjs
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'fs';

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: true });
try {
  const page = await browser.newPage();
  for (const size of [512, 192]) {
    const src = `data:image/png;base64,${readFileSync(`public/icon-${size}.png`).toString('base64')}`;
    const png = await page.evaluate(async (src, size) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      // a pill low in the safe zone: its corners are 0.36·size from the centre (the safe circle is 0.4·size)
      const w = 0.44 * size, h = 0.15 * size, x = (size - w) / 2, y = 0.645 * size;
      g.beginPath();
      g.roundRect(x, y, w, h, h / 2);
      g.fillStyle = '#ff8a1f';
      g.fill();
      g.lineWidth = size * 0.012;
      g.strokeStyle = '#0b1020';
      g.stroke();
      g.fillStyle = '#0b1020';
      g.font = `900 ${Math.round(h * 0.72)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('DEV', size / 2, y + h / 2 + h * 0.04);
      return cv.toDataURL('image/png').split(',')[1];
    }, src, size);
    writeFileSync(`public/icon-dev-${size}.png`, Buffer.from(png, 'base64'));
    console.log(`wrote public/icon-dev-${size}.png`);
  }
} finally {
  await browser.close();
}
