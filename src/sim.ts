import brushWGSL from './shaders/brush.wgsl?raw';
import smoothWGSL from './shaders/smooth.wgsl?raw';
import { COLORMAP_RGB } from './colormaps';
import renderWGSL from './shaders/render.wgsl?raw';
import type { CompiledRule, Layout } from './rule';
import { Spectral } from './spectral';

/** Global params that shape the spectral kernel (see `kernel_` in rule.ts). */
const KERNEL_PARAMS = [['kernel_sigma', 'sigma1'], ['kernel_b', 'b'], ['kernel_sigma2', 'sigma2']] as const;
/** Alternative to kernel_sigma: the radius of a flat disc, as the Gaussian with its spread (σ = R/2). */
const KERNEL_RADIUS = 'lap_size';
/** Global params that set the heat mode's diffusion (see `heat1_` in rule.ts). */
const HEAT_PARAMS = ['heat_D1', 'heat_D2', 'zoom', 'timestep'];

export const BrushMode = {
  Seed: 0,
  Erase: 1,
  Params: 2,
  Wall: 3,
  Unwall: 4,
  /** Hard-edged like a wall: set one param slot to its paint value (optionally clearing chemistry). */
  SetParam: 5,
  /** Add a stroke to a wall distance field (slot; base > 0), or cut it out (base < 0). */
  Sdf: 6,
  /** Round off walls and blur painted params (and the chemistry too, with clear): see smooth.wgsl. */
  Smooth: 7,
} as const;
export type BrushMode = (typeof BrushMode)[keyof typeof BrushMode];

export interface BrushStroke {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  radius: number;
  mode: BrushMode;
  strength: number;
  hardness: number;
  /** Values for the paintable params, in layout order (excluding wall). */
  paint: number[];
  /** SetParam: the flat param slot to set (1..), and whether to reset the chemistry there to rest.
   *  Smooth: clear blurs the chemistry as well. */
  slot?: number;
  clear?: boolean;
  /** SetParam: the param's unpainted value (strokes raise or lower towards paint from it, never past it). */
  base?: number;
}

export interface CellSample {
  x: number;
  y: number;
  /** Reagent values in layout order. */
  state: number[];
  /** Per-cell params in layout order; [0] is the wall flag. */
  params: number[];
  wall: boolean;
}

export interface CustomChannel { on: boolean; low: number; high: number; power: number; color: [number, number, number] }

/** The colour maps (colormaps.ts) as RGBA8 words, 256 per map, for the render shader; decoded once per device. */
const colormapBuffers = new WeakMap<GPUDevice, GPUBuffer>();
function colormapBuffer(device: GPUDevice): GPUBuffer {
  let b = colormapBuffers.get(device);
  if (b) return b;
  const rgb = Uint8Array.from(atob(COLORMAP_RGB), (ch) => ch.charCodeAt(0));
  const rgba = new Uint8Array((rgb.length / 3) * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) rgba.set([rgb[i], rgb[i + 1], rgb[i + 2], 255], j);
  b = device.createBuffer({ size: rgba.length, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(b, 0, rgba);
  colormapBuffers.set(device, b);
  return b;
}

export interface ViewOptions {
  mode: 'reagent' | 'params' | 'outlines';
  palette: number;
  reagent: number;
  low: number;
  high: number;
  /** Reagent index to tint by, or -1. */
  tint: number;
  tintLow: number;
  tintHigh: number;
  tintStrength: number;
  /** Fleck palettes: hue contrast (smoothMap shape, 1 = linear) and cyclic hue shift. */
  hueShape: number;
  hueOffset: number;
  /** Fleck palettes: the range a, b and c are mapped through (default 0 to 1). */
  fleckLow?: number;
  fleckHigh?: number;
  /** Fleck palettes: what lightness and chroma (V and S) are scaled by (below 1: less white in HSV, less flat in OKLCH). */
  fleckGain?: number;
  /** Custom palette (7), per reagent: fitted from low to high, raised to power, times colour (0-1 RGB), summed. */
  custom?: CustomChannel[];
  /** Custom palette: contrast (about mid-grey) and saturation applied to the summed colour (1 = as is). */
  customContrast?: number;
  customSaturation?: number;
  /** Custom palette: the summed colour raised to this power first (above 1 darkens the mid-tones, so contrast has room). */
  customGamma?: number;
  /** Up to three flat param slots (>0) with their display ranges. */
  /** Painted params to show: flat slot, range, and base (unpainted) value. */
  paramSlots: { slot: number; min: number; max: number; base: number; distance?: boolean }[];
}

const WG = 8;

/**
 * GPU reaction-diffusion field for a compiled rule. State is ping-ponged
 * between two storage buffers (S vec4s per cell); per-cell params (P vec4s,
 * slot 0 = wall) live in one buffer that only brushes and region writes touch.
 * Global parameter values sit in a uniform buffer.
 */
/** Whether a rule's diffusion is unconditionally stable (exact spectral operators), so its grid can be made finer without shorter steps. */
export function stableAtAnySpacing(c: CompiledRule) {
  return ['heat', 'kernel', 'propagator'].includes(c.spectral?.second ?? '');
}

export class Simulation {
  readonly width: number;
  readonly height: number;
  readonly compiled: CompiledRule;
  readonly layout: Layout;

  private device: GPUDevice;
  private state: [GPUBuffer, GPUBuffer];
  private params: GPUBuffer;
  private current = 0;

  private infoUniform: GPUBuffer;
  private globalsUniform: GPUBuffer;
  private cell = 1;
  /** Steps taken per requested step: > 1 when a finer grid needs shorter explicit steps (see setCellScale). */
  private substeps = 1;
  private brushUniform: GPUBuffer;
  private viewUniform: GPUBuffer;

  private stepPipeline: GPUComputePipeline;
  private brushPipeline: GPUComputePipeline;
  /** The Smooth brush, and the copy of the field it reads (made on its first stroke). */
  private smoothPipeline?: GPUComputePipeline;
  private smoothGroups?: [GPUBindGroup, GPUBindGroup];
  private smoothSrc?: { state: GPUBuffer; params: GPUBuffer };
  private renderPipeline: GPURenderPipeline;
  private colormaps: GPUBuffer;

  private stepGroups: [GPUBindGroup, GPUBindGroup];
  private brushGroups: [GPUBindGroup, GPUBindGroup];
  private renderGroups: [GPUBindGroup, GPUBindGroup];

  /** FFT operators for rules with a spectral Laplacian. */
  private spectral?: Spectral;
  private probeBuffer: GPUBuffer;
  private probeBusy = false;
  private globals: Float32Array;

  constructor(device: GPUDevice, format: GPUTextureFormat, width: number, height: number, compiled: CompiledRule) {
    this.device = device;
    this.width = width;
    this.height = height;
    this.compiled = compiled;
    this.layout = compiled.layout;
    const { S, P } = this.layout;
    const cells = width * height;
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

    this.state = [
      device.createBuffer({ size: cells * S * 16, usage: storage, label: 'state0' }),
      device.createBuffer({ size: cells * S * 16, usage: storage, label: 'state1' }),
    ];
    this.params = device.createBuffer({ size: cells * P * 16, usage: storage, label: 'params' });

    const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    this.infoUniform = device.createBuffer({ size: 16, usage: uniform });
    this.globalsUniform = device.createBuffer({ size: compiled.globalVec4s * 16, usage: uniform });
    this.brushUniform = device.createBuffer({ size: 272, usage: uniform });
    this.viewUniform = device.createBuffer({ size: 560, usage: uniform });
    this.colormaps = colormapBuffer(device);
    this.writeInfo();
    this.globals = new Float32Array(compiled.globalVec4s * 4);
    compiled.rule.params.forEach((p, i) => (this.globals[i] = p.value));
    device.queue.writeBuffer(this.globalsUniform, 0, this.globals);

    this.probeBuffer = device.createBuffer({
      size: (S + P) * 16,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const constants = { S, P };
    this.stepPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: compiled.stepWGSL, label: `step:${compiled.rule.name}` }), entryPoint: 'main' },
    });
    this.brushPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: brushWGSL, label: 'brush' }), entryPoint: 'main', constants },
    });
    const renderModule = device.createShaderModule({ code: renderWGSL, label: 'render' });
    this.renderPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vs' },
      fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }], constants },
      primitive: { topology: 'triangle-list' },
    });

    if (compiled.spectral) {
      this.spectral = new Spectral(device, width, height, S, compiled.spectral.second, this.state, !compiled.spectral.exact);
      this.applyDx();
      for (const [name, key] of KERNEL_PARAMS) {
        const i = compiled.globalIndex.get(name);
        if (i !== undefined) this.spectral.setKernel({ [key]: this.globals[i] });
      }
      const ri = compiled.globalIndex.get(KERNEL_RADIUS);
      if (ri !== undefined) this.spectral.setKernel({ sigma1: this.globals[ri] / 2 });
      const ts = compiled.globalIndex.get('timestep');
      if (compiled.spectral.second === 'propagator') this.spectral.setKernel({ sigma1: 0.5 * (ts !== undefined ? this.globals[ts] : 1) });
      this.setHeat();
    }
    const usesLap = /\blapK\b/.test(compiled.stepWGSL), usesBilap = /\bbilapK\b/.test(compiled.stepWGSL);
    const stepGroup = (from: number) =>
      device.createBindGroup({
        layout: this.stepPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.infoUniform } },
          { binding: 1, resource: { buffer: this.globalsUniform } },
          { binding: 2, resource: { buffer: this.params } },
          { binding: 3, resource: { buffer: this.state[from] } },
          { binding: 4, resource: { buffer: this.state[1 - from] } },
          ...(usesLap ? [{ binding: 5, resource: { buffer: this.spectral!.lap } }] : []),
          ...(usesBilap ? [{ binding: 6, resource: { buffer: this.spectral!.bilap } }] : []),
        ],
      });
    this.stepGroups = [stepGroup(0), stepGroup(1)];

    const brushGroup = (cur: number) =>
      device.createBindGroup({
        layout: this.brushPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.brushUniform } },
          { binding: 1, resource: { buffer: this.infoUniform } },
          { binding: 2, resource: { buffer: this.params } },
          { binding: 3, resource: { buffer: this.state[cur] } },
        ],
      });
    this.brushGroups = [brushGroup(0), brushGroup(1)];

    const renderGroup = (cur: number) =>
      device.createBindGroup({
        layout: this.renderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.viewUniform } },
          { binding: 1, resource: { buffer: this.params } },
          { binding: 2, resource: { buffer: this.state[cur] } },
          { binding: 3, resource: { buffer: this.colormaps } },
        ],
      });
    this.renderGroups = [renderGroup(0), renderGroup(1)];
  }

  /**
   * Grid spacing relative to full resolution (2 = half resolution): multiplies dx
   * in the step's stencils and the spectral wavenumbers, so a coarser grid shows
   * the same picture.
   */
  /**
   * Grid spacing relative to the rule's own (1 / feature size). Explicit stencil
   * steps are only stable up to a timestep ∝ spacing², so on a finer grid each
   * requested step becomes (1/cell)² steps of timestep·cell²: the same dynamics
   * per requested step, at that many times the cost. Exact spectral rules are
   * stable at any spacing and keep their step.
   */
  setCellScale(cell: number) {
    this.cell = cell;
    this.substeps = cell < 1 && !stableAtAnySpacing(this.compiled) ? Math.round(1 / (cell * cell)) : 1;
    this.writeInfo();
    this.applyDx();
  }

  private writeInfo() {
    const buf = new ArrayBuffer(16);
    new Uint32Array(buf).set([this.width, this.height]);
    new Float32Array(buf)[2] = this.cell;
    new Float32Array(buf)[3] = 1 / this.substeps;
    this.device.queue.writeBuffer(this.infoUniform, 0, buf);
  }

  private applyDx() {
    const i = this.compiled.globalIndex.get('dx');
    this.spectral?.setDx((i !== undefined ? this.globals[i] : 1) * this.cell);
  }

  setGlobal(name: string, value: number) {
    const i = this.compiled.globalIndex.get(name);
    if (i === undefined) return;
    this.globals[i] = value;
    this.device.queue.writeBuffer(this.globalsUniform, 0, this.globals);
    if (name === 'dx') this.applyDx();
    const kp = KERNEL_PARAMS.find(([n]) => n === name);
    if (kp) this.spectral?.setKernel({ [kp[1]]: value });
    if (name === KERNEL_RADIUS) this.spectral?.setKernel({ sigma1: value / 2 });
    if (name === 'timestep' && this.compiled.spectral?.second === 'propagator') this.spectral?.setKernel({ sigma1: 0.5 * value });
    if (HEAT_PARAMS.includes(name)) this.setHeat();
  }

  /** Heat mode: Gaussian widths for exact diffusion over a step, σ² = 2·D·zoom²·timestep. */
  private setHeat() {
    if (this.compiled.spectral?.second !== 'heat') return;
    const g = (n: string, d: number) => {
      const i = this.compiled.globalIndex.get(n);
      return i === undefined ? d : this.globals[i];
    };
    const zt = g('zoom', 1) ** 2 * g('timestep', 1);
    this.spectral?.setKernel({ sigma1: Math.sqrt(2 * g('heat_D1', 0) * zt), sigma2: Math.sqrt(2 * g('heat_D2', 0) * zt) });
  }

  getGlobals(): Record<string, number> {
    return Object.fromEntries(this.compiled.rule.params.map((p, i) => [p.name, this.globals[i]]));
  }

  /** Replace the whole field (state S*4 floats/cell, params P*4 floats/cell). */
  load(state: Float32Array, params: Float32Array) {
    this.device.queue.writeBuffer(this.state[this.current], 0, state as Float32Array<ArrayBuffer>);
    this.device.queue.writeBuffer(this.params, 0, params as Float32Array<ArrayBuffer>);
  }

  /** Set every non-wall cell's paintable params. Done on the GPU via a giant brush. */
  fillParams(paint: number[]) {
    const c = [this.width / 2, this.height / 2];
    this.brush({
      ax: c[0], ay: c[1], bx: c[0], by: c[1],
      radius: Math.hypot(this.width, this.height), mode: BrushMode.Params, strength: 1, hardness: 1, paint,
    });
  }

  /** Reset every reagent to its rest value (walls and params untouched). */
  clearChemistry() {
    const { S } = this.layout;
    const rest = this.compiled.rule.rest;
    const s = new Float32Array(this.width * this.height * S * 4);
    for (let i = 0; i < this.width * this.height; i++) rest.forEach((v, r) => (s[i * S * 4 + r] = v));
    this.device.queue.writeBuffer(this.state[this.current], 0, s);
  }

  brush(b: BrushStroke) {
    const rule = this.compiled.rule;
    const buf = new ArrayBuffer(272);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    f[0] = b.ax; f[1] = b.ay; f[2] = b.bx; f[3] = b.by;
    f[4] = b.radius;
    u[5] = b.mode;
    f[6] = b.strength;
    f[7] = b.hardness;
    f[8] = Math.random() * 1000;
    f[9] = b.slot ?? 0;
    f[10] = b.clear ? 1 : 0;
    f[11] = b.base ?? 0;
    rule.reagents.forEach((_, r) => {
      const seed = rule.seed[r];
      f[12 + r] = seed ?? 0;
      f[24 + r] = seed === null || seed === undefined ? 0 : 1;
      f[36 + r] = rule.seedNoise[r] ?? 0;
      f[48 + r] = rule.rest[r] ?? 0;
    });
    if (b.mode === BrushMode.Smooth) {
      // which param slots to blur: all but the wall flag and a membrane's compartment ids
      const names = this.layout.paramNames;
      names.forEach((n, i) => (f[60 + i] = i > 0 && n !== rule.membrane?.param ? 1 : 0));
    } else b.paint.forEach((v, i) => (f[60 + 1 + i] = v));
    this.device.queue.writeBuffer(this.brushUniform, 0, buf);

    const enc = this.device.createCommandEncoder();
    if (b.mode === BrushMode.Smooth) {
      const src = this.smoothBuffers();
      enc.copyBufferToBuffer(this.state[this.current], 0, src.state, 0, src.state.size);
      enc.copyBufferToBuffer(this.params, 0, src.params, 0, src.params.size);
    }
    const pass = enc.beginComputePass();
    pass.setPipeline(b.mode === BrushMode.Smooth ? this.smoothPipeline! : this.brushPipeline);
    pass.setBindGroup(0, b.mode === BrushMode.Smooth ? this.smoothGroups![this.current] : this.brushGroups[this.current]);
    pass.dispatchWorkgroups(Math.ceil(this.width / WG), Math.ceil(this.height / WG));
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  private smoothBuffers() {
    if (!this.smoothSrc) {
      const { S, P } = this.layout;
      const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
      const cells = this.width * this.height;
      const src = {
        state: this.device.createBuffer({ size: cells * S * 16, usage, label: 'smoothState' }),
        params: this.device.createBuffer({ size: cells * P * 16, usage, label: 'smoothParams' }),
      };
      const pipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module: this.device.createShaderModule({ code: smoothWGSL, label: 'smooth' }), entryPoint: 'main', constants: { S, P } },
      });
      const group = (cur: number) =>
        this.device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.brushUniform } },
            { binding: 1, resource: { buffer: this.infoUniform } },
            { binding: 2, resource: { buffer: this.params } },
            { binding: 3, resource: { buffer: this.state[cur] } },
            { binding: 4, resource: { buffer: src.params } },
            { binding: 5, resource: { buffer: src.state } },
          ],
        });
      this.smoothSrc = src;
      this.smoothPipeline = pipeline;
      this.smoothGroups = [group(0), group(1)];
    }
    return this.smoothSrc;
  }

  /** Encode `n` simulation steps into the given encoder. */
  step(enc: GPUCommandEncoder, steps: number) {
    const n = steps * this.substeps;
    if (n <= 0) return;
    const pass = enc.beginComputePass();
    pass.setPipeline(this.stepPipeline);
    const gx = Math.ceil(this.width / WG);
    const gy = Math.ceil(this.height / WG);
    for (let i = 0; i < n; i++) {
      if (this.spectral) {
        this.spectral.encode(pass, this.current);
        pass.setPipeline(this.stepPipeline);
      }
      pass.setBindGroup(0, this.stepGroups[this.current]);
      pass.dispatchWorkgroups(gx, gy);
      this.current = 1 - this.current;
    }
    pass.end();
  }

  render(enc: GPUCommandEncoder, target: GPUTextureView, canvasW: number, canvasH: number, v: ViewOptions) {
    const buf = new ArrayBuffer(560);
    const u = new Uint32Array(buf);
    const f = new Float32Array(buf);
    u[0] = this.width; u[1] = this.height;
    f[2] = canvasW; f[3] = canvasH;
    u[4] = v.mode === 'params' ? 1 : v.mode === 'outlines' ? 2 : 0;
    u[5] = v.palette;
    u[6] = v.reagent;
    u[7] = v.tint >= 0 ? v.tint : 99;
    f[8] = v.low; f[9] = v.high;
    f[10] = v.tintLow; f[11] = v.tintHigh; f[12] = v.tintStrength;
    f[13] = v.hueShape; f[14] = v.hueOffset; f[15] = this.compiled.rule.reagents.length;
    v.paramSlots.slice(0, 4).forEach((p, k) => {
      u[16 + k] = p.slot;
      f[20 + k] = p.min;
      f[24 + k] = p.max;
      f[28 + k] = p.base;
      u[32 + k] = p.distance ? 1 : 0;
    });
    f[36] = v.fleckLow ?? 0; f[37] = v.fleckHigh ?? 1; f[38] = v.fleckGain ?? 1;
    v.custom?.slice(0, 12).forEach((c, r) => {
      f.set([c.low, c.high, c.power, c.on ? 1 : 0, ...c.color, 0], 40 + 8 * r);
    });
    f[136] = v.customContrast ?? 1; f[137] = v.customSaturation ?? 1; f[138] = v.customGamma ?? 1;
    this.device.queue.writeBuffer(this.viewUniform, 0, buf);

    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderGroups[this.current]);
    pass.draw(3);
    pass.end();
  }

  get paramsBuffer() {
    return this.params;
  }

  /** The state buffer the next step reads from (i.e. the latest state). */
  get stateBuffer() {
    return this.state[this.current];
  }

  /** Read back one cell. Resolves to null if a probe is already in flight. */
  async probe(x: number, y: number): Promise<CellSample | null> {
    if (this.probeBusy || x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    this.probeBusy = true;
    const { S, P, reagents, paramNames } = this.layout;
    try {
      const i = y * this.width + x;
      const enc = this.device.createCommandEncoder();
      enc.copyBufferToBuffer(this.state[this.current], i * S * 16, this.probeBuffer, 0, S * 16);
      enc.copyBufferToBuffer(this.params, i * P * 16, this.probeBuffer, S * 16, P * 16);
      this.device.queue.submit([enc.finish()]);
      await this.probeBuffer.mapAsync(GPUMapMode.READ);
      const d = new Float32Array(this.probeBuffer.getMappedRange().slice(0));
      this.probeBuffer.unmap();
      const state = Array.from(d.subarray(0, reagents.length));
      const params = Array.from(d.subarray(S * 4, S * 4 + paramNames.length));
      return { x, y, state, params, wall: params[0] > 0.5 };
    } catch {
      return null; // device lost or sim destroyed mid-read
    } finally {
      this.probeBusy = false;
    }
  }

  /**
   * Row segments covering a w×h rectangle at (x, y), wrapped toroidally.
   * Each segment is a run of cells contiguous in the field and in the region.
   */
  private segments(x: number, y: number, w: number, h: number) {
    const W = this.width, H = this.height;
    const out: { field: number; region: number; len: number }[] = [];
    const x0 = ((x % W) + W) % W;
    const first = Math.min(w, W - x0);
    for (let r = 0; r < h; r++) {
      const fy = (((y + r) % H) + H) % H;
      out.push({ field: fy * W + x0, region: r * w, len: first });
      if (first < w) out.push({ field: fy * W, region: r * w + first, len: w - first });
    }
    return out;
  }

  /** Read params (P*4 floats/cell) and state (S*4 floats/cell) of a rectangle. */
  async readRegion(x: number, y: number, w: number, h: number): Promise<{ params: Float32Array; state: Float32Array }> {
    const { S, P } = this.layout;
    const cells = w * h;
    const staging = this.device.createBuffer({ size: cells * (S + P) * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder();
    const state = this.state[this.current];
    for (const s of this.segments(x, y, w, h)) {
      enc.copyBufferToBuffer(this.params, s.field * P * 16, staging, s.region * P * 16, s.len * P * 16);
      enc.copyBufferToBuffer(state, s.field * S * 16, staging, cells * P * 16 + s.region * S * 16, s.len * S * 16);
    }
    this.device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const all = new Float32Array(staging.getMappedRange().slice(0));
    staging.destroy();
    return { params: all.slice(0, cells * P * 4), state: all.slice(cells * P * 4) };
  }

  /** Write params and/or state into a rectangle (either may be omitted). */
  writeRegion(x: number, y: number, w: number, h: number, params?: Float32Array, state?: Float32Array) {
    const { S, P } = this.layout;
    const q = this.device.queue;
    const cur = this.state[this.current];
    for (const s of this.segments(x, y, w, h)) {
      if (params) q.writeBuffer(this.params, s.field * P * 16, params as Float32Array<ArrayBuffer>, s.region * P * 4, s.len * P * 4);
      if (state) q.writeBuffer(cur, s.field * S * 16, state as Float32Array<ArrayBuffer>, s.region * S * 4, s.len * S * 4);
    }
  }

  /**
   * The rule's homogeneous steady state near `start`: a 1×1 wrapped grid has
   * zero Laplacian, so stepping it relaxes the purely local dynamics.
   * Returns null if it doesn't settle to finite values.
   */
  static async relaxRest(device: GPUDevice, compiled: CompiledRule, globals: Record<string, number>, start: number[], steps = 20000) {
    const sim = new Simulation(device, 'rgba8unorm', 1, 1, compiled);
    try {
      for (const [k, v] of Object.entries(globals)) sim.setGlobal(k, v);
      const { S, P, paramNames } = sim.layout;
      const state = new Float32Array(S * 4);
      start.forEach((v, i) => (state[i] = v));
      const params = new Float32Array(P * 4);
      paramNames.forEach((n, i) => (params[i] = i === 0 ? 0 : globals[n]));
      sim.load(state, params);
      for (let done = 0; done < steps; done += 1000) {
        const enc = device.createCommandEncoder();
        sim.step(enc, 1000);
        device.queue.submit([enc.finish()]);
      }
      const out = await sim.readRegion(0, 0, 1, 1);
      const rest = Array.from(out.state.subarray(0, compiled.rule.reagents.length));
      return rest.every(Number.isFinite) ? rest : null;
    } finally {
      sim.destroy();
    }
  }

  destroy() {
    this.smoothSrc?.state.destroy();
    this.smoothSrc?.params.destroy();
    for (const b of [...this.state, this.params, this.infoUniform, this.globalsUniform, this.brushUniform, this.viewUniform, this.probeBuffer]) {
      b.destroy();
    }
    this.spectral?.destroy();
  }
}
