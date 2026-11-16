// Recording the sim as a video file. The recorder steps the sim itself, frame by frame (the main
// loop pauses meanwhile), so the video has exactly the asked-for frame rate and length however slow
// the device is: each frame is the sim after `stepsPerFrame` more steps, rendered as the view shows
// it, encoded with WebCodecs (H.264, else VP9) and muxed into an MP4.
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { Simulation, ViewOptions } from './sim';
import { el, section, button } from './ui';
import { ladder } from './ladder';

export interface RecordOptions {
  seconds: number;
  fps: number;
  /** Sim steps between video frames. */
  stepsPerFrame: number;
  /** Video size as a multiple of the sim's grid (rounded to even pixels). */
  scale: number;
  /** Bits per pixel per frame (about 0.1 is light, 0.6 near lossless for these fields). */
  bpp: number;
}

const CODECS: [string, 'avc' | 'vp9'][] = [['avc1.640034', 'avc'], ['avc1.4d0034', 'avc'], ['avc1.42003e', 'avc'], ['vp09.00.51.08', 'vp9']];

/** Records `o.seconds` of video from `sim`; `progress(done, total)` after each frame; stops early (with what it has) when `cancelled()`. */
export async function recordVideo(device: GPUDevice, sim: Simulation, view: () => ViewOptions, o: RecordOptions,
  progress: (done: number, total: number) => void, cancelled: () => boolean): Promise<Blob> {
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const width = even(sim.width * o.scale), height = even(sim.height * o.scale);
  const total = Math.max(1, Math.round(o.seconds * o.fps));
  const bitrate = Math.round(Math.min(80e6, Math.max(5e5, o.bpp * width * height * o.fps)));
  let chosen: [string, 'avc' | 'vp9'] | null = null;
  for (const c of CODECS) {
    const sup = await VideoEncoder.isConfigSupported({ codec: c[0], width, height, bitrate, framerate: o.fps }).catch(() => null);
    if (sup?.supported) { chosen = c; break; }
  }
  if (!chosen) throw new Error(`this browser can't encode ${width}×${height} video (no H.264 or VP9 encoder for that size)`);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: chosen[1], width, height, frameRate: o.fps }, fastStart: 'in-memory' });
  let failure: unknown = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) });
  encoder.configure({ codec: chosen[0], width, height, bitrate, framerate: o.fps, latencyMode: 'quality' });

  // each frame is rendered into a texture and read back (a WebGPU OffscreenCanvas's transferToImageBitmap
  // gave black frames), in the format the render pipeline draws in (the canvas's preferred one)
  const format = navigator.gpu.getPreferredCanvasFormat();
  const target = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const stride = Math.ceil((width * 4) / 256) * 256;
  const readback = device.createBuffer({ size: stride * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const us = 1e6 / o.fps;
  try {
    for (let i = 0; i < total && !cancelled(); i++) {
      if (failure) throw failure;
      const enc = device.createCommandEncoder();
      if (i > 0) sim.step(enc, o.stepsPerFrame);
      sim.render(enc, target.createView(), width, height, view());
      enc.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: stride }, [width, height]);
      device.queue.submit([enc.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const frame = new VideoFrame(new Uint8Array(readback.getMappedRange()), {
        format: format === 'bgra8unorm' ? 'BGRX' : 'RGBX', codedWidth: width, codedHeight: height,
        layout: [{ offset: 0, stride }], timestamp: Math.round(i * us), duration: Math.round(us),
      });
      readback.unmap();
      encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(o.fps * 2)) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 4));
      progress(i + 1, total);
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    target.destroy();
    readback.destroy();
  }
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

export interface RecordEnv {
  device: GPUDevice;
  sim(): Simulation;
  view(): ViewOptions;
  /** The sim's current steps per frame (the default between video frames). */
  stepsPerFrame(): number;
  /** Pauses the main loop (true) or puts it back as it was (false). */
  hold(on: boolean): void;
  name(): string;
}

/** The Record section of the panel. */
export function recordSection(env: RecordEnv) {
  const num = (value: string, min: number, title: string) => {
    const i = el('input', { type: 'number', class: 'num', min: String(min), step: 'any', value, title });
    i.addEventListener('keydown', (e) => e.stopPropagation());
    return i;
  };
  const secs = num('10', 0.1, 'length of the video, in seconds');
  const fps = num('30', 1, 'video frames per second');
  const steps = num('', 1, 'sim steps between video frames (empty: the sim\'s steps/frame)');
  const scale = el('select', {}, ...[[0.5, '½'], [1, '1×'], [2, '2×'], [4, '4×']].map(([v, t]) => el('option', { value: String(v) }, String(t))));
  scale.value = '1';
  const quality = el('select', {}, ...[[0.1, 'light'], [0.25, 'good'], [0.6, 'high']].map(([v, t]) => el('option', { value: String(v) }, String(t))));
  quality.value = '0.25';
  const row = (label: string, input: HTMLElement, hint = '') => el('label', { class: 'row' }, el('span', {}, label), input, el('output', {}, hint));
  const stepsOut = el('output');
  const stepsRow = el('label', { class: 'row' }, el('span', {}, 'steps/frame'), steps, stepsOut);
  for (const [box, lo] of [[secs, 0.1], [fps, 1], [steps, 1]] as [HTMLInputElement, number][]) {
    ladder(box, {
      get: () => Number(box.value) || (box === steps ? env.stepsPerFrame() : lo),
      set: (v) => { box.value = String(box === secs ? +v.toPrecision(6) : Math.round(v)); update(); },
      range: box === secs ? [0, 60] : box === fps ? [1, 120] : [1, 500], clamp: [lo, 1e6],
    });
    box.addEventListener('input', () => update());
  }
  const info = el('p', { class: 'hint' });
  const status = el('p', { class: 'hint' });
  const bar = el('progress', { max: '1', value: '0', class: 'rec-progress' });
  bar.style.display = 'none';
  let running = false, stop = false;
  const go = button('● Record', () => (running ? (stop = true) : void record()), 'step the sim and record it: the main sim pauses meanwhile, and the video downloads when done');
  const opts = (): RecordOptions => ({
    seconds: Math.max(0.1, Number(secs.value) || 10),
    fps: Math.max(1, Math.round(Number(fps.value) || 30)),
    stepsPerFrame: Math.max(1, Math.round(Number(steps.value) || env.stepsPerFrame())),
    scale: Number(scale.value),
    bpp: Number(quality.value),
  });
  function update() {
    const o = opts(), sim = env.sim(), frames = Math.round(o.seconds * o.fps);
    steps.placeholder = String(env.stepsPerFrame());
    stepsOut.textContent = steps.value ? '' : 'as sim';
    const w = Math.round((sim.width * o.scale) / 2) * 2, h = Math.round((sim.height * o.scale) / 2) * 2;
    info.textContent = `${frames} frames of ${w}×${h}: ${(frames * o.stepsPerFrame).toLocaleString()} sim steps, about ${((o.bpp * w * h * o.fps * o.seconds) / 8e6).toFixed(1)} MB`;
  }
  for (const s of [scale, quality]) s.addEventListener('change', update);

  async function record() {
    running = true;
    stop = false;
    go.textContent = '■ Stop';
    bar.style.display = '';
    bar.value = 0;
    status.textContent = '';
    env.hold(true);
    const t0 = performance.now();
    try {
      const o = opts();
      const blob = await recordVideo(env.device, env.sim(), env.view, o, (d, n) => {
        bar.value = d / n;
        const left = ((performance.now() - t0) / d) * (n - d) / 1000;
        status.textContent = `frame ${d} of ${n}${d < n ? ` · about ${left < 90 ? `${Math.ceil(left)} s` : `${Math.ceil(left / 60)} min`} left` : ''}`;
      }, () => stop);
      const a = el('a', { href: URL.createObjectURL(blob), download: `rdui-${env.name().replace(/[^\w.-]+/g, '_')}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.mp4` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      status.textContent = `${stop ? 'Stopped early: saved' : 'Saved'} ${(blob.size / 1e6).toFixed(1)} MB in ${((performance.now() - t0) / 1000).toFixed(0)} s.`;
    } catch (e) {
      status.textContent = `Couldn't record: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      env.hold(false);
      running = false;
      go.textContent = '● Record';
      bar.style.display = 'none';
    }
  }
  update();
  const node = section('Record',
    row('seconds', secs), row('frame rate', fps, 'fps'), stepsRow, row('size', scale), row('quality', quality),
    info, el('div', { class: 'buttons' }, go), bar, status);
  return { node, update };
}
