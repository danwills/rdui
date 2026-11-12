import probeWGSL from './shaders/probe.wgsl?raw';
import type { Simulation } from './sim';

export const MAX_PROBES = 64;
export const HISTORY = 240;
const OUT_VEC4S = 5;
const OUT_BYTES = OUT_VEC4S * 16;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Probe extends Rect {
  id: number;
  name: string;
  /** Latest reading per reagent (layout order, up to 8). */
  mean: Float32Array;
  max: Float32Array;
  /** Ring buffer of per-reagent means, HISTORY × 8, newest at `head - 1`. */
  history: Float32Array;
  head: number;
  filled: number;
}

/**
 * A set of rectangular probes measured on the GPU. `sample()` is fire-and-forget:
 * it dispatches the reduction, reads back asynchronously, and skips if the
 * previous readback hasn't landed yet.
 */
export class ProbeSet {
  probes: Probe[] = [];
  onSample?: () => void;

  private device: GPUDevice;
  private pipeline: GPUComputePipeline | null = null;
  private pipelineKey = '';
  private info: GPUBuffer;
  private regions: GPUBuffer;
  private out: GPUBuffer;
  private staging: GPUBuffer;
  private busy = false;
  private dirty = true;
  private nextId = 1;

  constructor(device: GPUDevice) {
    this.device = device;
    this.info = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.regions = device.createBuffer({ size: MAX_PROBES * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.out = device.createBuffer({ size: MAX_PROBES * OUT_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.staging = device.createBuffer({ size: MAX_PROBES * OUT_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  }

  add(r: Rect, name?: string): Probe | null {
    if (this.probes.length >= MAX_PROBES || r.w < 1 || r.h < 1) return null;
    const id = this.nextId++;
    const p: Probe = {
      ...r, id, name: name ?? `p${id}`,
      mean: new Float32Array(8), max: new Float32Array(8),
      history: new Float32Array(HISTORY * 8), head: 0, filled: 0,
    };
    this.probes.push(p);
    this.dirty = true;
    return p;
  }

  remove(id: number) {
    this.probes = this.probes.filter((p) => p.id !== id);
    this.dirty = true;
  }

  clear() {
    this.probes = [];
    this.dirty = true;
  }

  /** Probe whose rect contains grid point (x, y), topmost (latest) first. */
  hit(x: number, y: number): Probe | undefined {
    for (let i = this.probes.length - 1; i >= 0; i--) {
      const p = this.probes[i];
      if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) return p;
    }
    return undefined;
  }

  /** Mean of reagent `r` over the probe's history, oldest first. */
  static series(p: Probe, r: number): Float32Array {
    const out = new Float32Array(p.filled);
    for (let i = 0; i < p.filled; i++) out[i] = p.history[((p.head - p.filled + i + HISTORY) % HISTORY) * 8 + r];
    return out;
  }

  sample(sim: Simulation) {
    const n = this.probes.length;
    if (this.busy || n === 0) return;
    this.busy = true;

    const { S, P } = sim.layout;
    const key = `${S}:${P}`;
    if (!this.pipeline || key !== this.pipelineKey) {
      this.pipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module: this.device.createShaderModule({ code: probeWGSL, label: 'probe' }), entryPoint: 'main', constants: { S, P } },
      });
      this.pipelineKey = key;
    }
    const pipeline = this.pipeline;

    const q = this.device.queue;
    q.writeBuffer(this.info, 0, new Uint32Array([sim.width, sim.height, 0, 0]));
    if (this.dirty) {
      const r = new Int32Array(n * 4);
      this.probes.forEach((p, i) => r.set([p.x, p.y, p.w, p.h], i * 4));
      q.writeBuffer(this.regions, 0, r);
      this.dirty = false;
    }
    // Bind group per sample: the state buffer ping-pongs and the sim may be replaced.
    const group = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.info } },
        { binding: 1, resource: { buffer: this.regions } },
        { binding: 2, resource: { buffer: sim.paramsBuffer } },
        { binding: 3, resource: { buffer: sim.stateBuffer } },
        { binding: 4, resource: { buffer: this.out } },
      ],
    });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(n);
    pass.end();
    enc.copyBufferToBuffer(this.out, 0, this.staging, 0, n * OUT_BYTES);
    q.submit([enc.finish()]);

    const measured = this.probes.slice();
    this.staging.mapAsync(GPUMapMode.READ, 0, n * OUT_BYTES).then(() => {
      const d = new Float32Array(this.staging.getMappedRange(0, n * OUT_BYTES).slice(0));
      this.staging.unmap();
      measured.forEach((p, i) => {
        const o = i * OUT_VEC4S * 4;
        p.mean.set(d.subarray(o, o + 8));
        p.max.set(d.subarray(o + 8, o + 16));
        p.history.set(p.mean, p.head * 8);
        p.head = (p.head + 1) % HISTORY;
        p.filled = Math.min(p.filled + 1, HISTORY);
      });
      this.busy = false;
      this.onSample?.();
    }, () => {
      this.busy = false;
    });
  }

  /** Plain-data form for snapshots. */
  toJSON() {
    return this.probes.map(({ name, x, y, w, h }) => ({ name, x, y, w, h }));
  }

  load(list: (Rect & { name: string })[]) {
    this.clear();
    for (const r of list) this.add(r, r.name);
  }
}
