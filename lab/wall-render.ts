// A round sealed wall and a round feed wall in Gray-Scott, rendered through the real shader at 6x
// zoom (offscreen), to look at the walls' edges.
//   node lab/run.mjs wall-render '{}'
import * as R from '../src/rule';
import { gpu, makeLab, log } from './lab';
import type { ViewOptions } from '../src/sim';

export default async function () {
  const N = 64, Z = 6, W = N * Z, lab = await makeLab(R.GRAY_SCOTT, N, {}, 'initial');
  const P4 = lab.layout.P * 4;
  const { state, params } = await lab.read();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d1 = Math.hypot(x + 0.5 - 20, y + 0.5 - 32), d2 = Math.hypot(x + 0.5 - 44, y + 0.5 - 32);
    params[(y * N + x) * P4] = d1 < 9.3 ? 1 : d2 < 9.3 ? 2 : 0;
  }
  lab.sim.load(state, params);
  await lab.run(200);
  const device = await gpu();
  const tex = device.createTexture({ size: [W, W], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const row = Math.ceil((W * 4) / 256) * 256;
  const view: ViewOptions = { mode: 'reagent', palette: 0, reagent: 1, low: 0, high: 0.4, tint: -1, tintLow: 0, tintHigh: 1, tintStrength: 0, hueShape: 1, hueOffset: 0, paramSlots: [] };
  const enc = device.createCommandEncoder();
  lab.sim.render(enc, tex.createView(), W, W, view);
  const buf = device.createBuffer({ size: row * W, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: row }, [W, W]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buf.getMappedRange());
  const img = new ImageData(W, W);
  for (let y = 0; y < W; y++) img.data.set(src.subarray(y * row, y * row + W * 4), y * W * 4);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  const c = document.createElement('canvas');
  c.width = c.height = W;
  c.getContext('2d')!.putImageData(img, 0, 0);
  await window.__save('walls.png', c.toDataURL('image/png'));
  log('saved walls.png');
}
