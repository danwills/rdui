// Does the absorbing border eat gliders cleanly?
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, absorber, blobs, log, STARTERS } from './lab';

export default async function () {
  for (const k of [0.068, 0.072, 0.075]) {
    const lab = await makeLab(GS_HISTORY_WAVE, 256);
    await absorber(lab, 12, { k });
    lab.place(STARTERS('starter-glider-hw-axis'), 150, 128);
    const out = [];
    for (let t = 0; t < 12000; t += 1000) {
      await lab.run(1000);
      const bs = blobs((await lab.read()).state, 256, lab.layout.S, 1, 0.2);
      out.push(bs.map((b) => `${b.x.toFixed(0)},${b.y.toFixed(0)}`).join('|') || '-');
    }
    log(`k=${k}:`, out.join('  '));
  }
}
