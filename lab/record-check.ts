// The recorder end to end, offscreen: a short Gray-Scott video, saved for ffprobe.
//   node lab/run.mjs record-check '{"seconds":2,"fps":15}'
import * as R from '../src/rule';
import { recordVideo } from '../src/record';
import { gpu, makeLab, log } from './lab';
import type { ViewOptions } from '../src/sim';

export default async function (cfg: { seconds?: number; fps?: number; scale?: number }) {
  const lab = await makeLab(R.GRAY_SCOTT, 256, {}, 'initial');
  await lab.run(500);
  const device = await gpu();
  const view: ViewOptions = { mode: 'reagent', palette: 117, reagent: 1, low: 0, high: 0.4, tint: -1, tintLow: 0, tintHigh: 1, tintStrength: 0, hueShape: 1, hueOffset: 0, paramSlots: [] };
  const t0 = performance.now();
  const blob = await recordVideo(device, lab.sim, () => view, { seconds: cfg.seconds ?? 2, fps: cfg.fps ?? 15, stepsPerFrame: 20, scale: cfg.scale ?? 1, bpp: 0.25 }, () => {}, () => false);
  log(`${blob.size} bytes in ${(performance.now() - t0).toFixed(0)} ms`);
  const url = await new Promise<string>((r) => { const f = new FileReader(); f.onload = () => r(f.result as string); f.readAsDataURL(blob); });
  await window.__save('check.mp4', url);
  log('saved check.mp4');
}
