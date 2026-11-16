// The recorder end to end: a few frames of a growing Gray-Scott ring, saved as lab/out/record-test/rec-test.mp4 (check a frame with ffmpeg).
import * as R from '../src/rule';
import { recordVideo } from '../src/record';
import { makeLab, gpu, log, seedDisk } from './lab';
export default async function () {
  const d = await gpu(), N = 128, lab = await makeLab(R.GRAY_SCOTT, N, { F: 0.037, k: 0.06 });
  await seedDisk(lab, 64, 64, 20, { a: 0.5, b: 0.25 });
  await lab.run(300);
  const view = () => ({ mode: 'reagent', palette: 0, reagent: 1, tint: -1, low: 0, high: 0.4, tintLow: 0, tintHigh: 1, tintStrength: 0, hueShape: 1, hueOffset: 0, paramSlots: [] }) as never;
  const blob = await recordVideo(d, lab.sim, view, { seconds: 1, fps: 10, stepsPerFrame: 50, scale: 2, bpp: 0.3 }, () => {}, () => false);
  log(`video ${blob.size} bytes`);
  const { state } = await lab.read(); let mx = 0, S4 = lab.layout.S * 4; for (let i = 0; i < N * N; i++) mx = Math.max(mx, state[i * S4 + 1]); log(`max b ${mx}`);
  const url = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(blob); });
  await window.__save('rec-test.mp4', url);
}
