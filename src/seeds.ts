/**
 * Start seeds for collection presets: Dan's vtiseed records (Enki project,
 * tools/ready/vtiseed.py), repacked by lab/vtipack-import.py into public/vti/seeds/<md5>.bin,
 * grown here into a start state statistically like the saved run's. A port of
 * vtiseed.grow: the same kinds and steps, its own random numbers.
 * - synthetic: noise shaped to each chemical's radial spectrum, mixed to their correlations,
 *   mapped through their quantiles;
 * - patch, patches4: typical windows tiled at random rotations and flips;
 * - patch_on_rest, patch_on_synth: a window scattered (soft-edged) over the rest values or
 *   over synthetic noise;
 * - q8, q16, exact: the whole state (cropped or wrapped to the grid asked for).
 * Every kind is shifted to the saved means at the end.
 */
const BASE = `${import.meta.env.BASE_URL}vti/seeds/`;
const BANDS = 24, QUANTILES = 33;

interface Arr { type: 'u8' | 'u16' | 'f32'; shape: number[]; offset: number }
export interface Seed {
  kind: string;
  names: string[];
  means: number[];
  desc?: { n: number; size: [number, number]; quantiles: number[][]; spectrum: number[][]; constant: boolean[]; corr: number[][] };
  bg?: number[];
  coverage?: number;
  patches?: { codes: Uint8Array | Uint16Array; shape: number[]; lo: number[]; hi: number[] };
  state?: { codes: Uint8Array | Uint16Array; shape: number[]; lo: number[]; hi: number[] };
  exact?: { data: Float32Array; shape: number[] };
}

const cache = new Map<string, Promise<Seed | null>>();
export function loadSeed(md5: string) {
  let p = cache.get(md5);
  if (!p) cache.set(md5, (p = fetchSeed(md5).catch(() => null)));
  return p;
}

async function fetchSeed(md5: string): Promise<Seed | null> {
  const res = await fetch(`${BASE}${md5}.bin`);
  if (!res.ok) return null;
  let buf = new Uint8Array(await res.arrayBuffer());
  // gzipped as stored; a server may already have undone that
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const hlen = new DataView(buf.buffer, buf.byteOffset).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + hlen)));
  const body = buf.slice(4 + hlen).buffer;
  const arr = (a: Arr) => {
    const n = a.shape.reduce((s, x) => s * x, 1);
    return a.type === 'u8' ? new Uint8Array(body, a.offset, n) : a.type === 'u16' ? new Uint16Array(body, a.offset, n) : new Float32Array(body, a.offset, n);
  };
  const A = head.arrays as Record<string, Arr>;
  const seed: Seed = { kind: head.kind, names: head.names, means: Array.isArray(head.means) ? head.means : Array.from(arr(A.means) as Float32Array), desc: head.desc, coverage: head.coverage };
  if (head.bg) seed.bg = head.bg;
  else if (A.bg) seed.bg = Array.from(arr(A.bg));
  for (const k of ['patches', 'state'] as const) if (A[k]) seed[k] = { codes: arr(A[k]) as Uint8Array | Uint16Array, shape: A[k].shape, lo: head[`${k}_lo`], hi: head[`${k}_hi`] };
  if (A.exact) seed.exact = { data: arr(A.exact) as Float32Array, shape: A.exact.shape };
  return seed;
}

// --- random numbers (mulberry32) and normals
function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(u() * n);
  const normal = () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
  return { u, int, normal };
}
type Rng = ReturnType<typeof rng>;

/** Standard normal CDF (Abramowitz-Stegun erf, |error| < 1.5e-7). */
function phi(x: number) {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

// --- FFT (radix 2, in place) and its 2D form
function fft1(re: Float64Array, im: Float64Array, inv: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}
function fft2(re: Float64Array, im: Float64Array, w: number, h: number, inv: boolean) {
  const rr = new Float64Array(w), ri = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    rr.set(re.subarray(y * w, y * w + w));
    ri.set(im.subarray(y * w, y * w + w));
    fft1(rr, ri, inv);
    re.set(rr, y * w);
    im.set(ri, y * w);
  }
  const cr = new Float64Array(h), ci = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      cr[y] = re[y * w + x];
      ci[y] = im[y * w + x];
    }
    fft1(cr, ci, inv);
    for (let y = 0; y < h; y++) {
      re[y * w + x] = cr[y];
      im[y * w + x] = ci[y];
    }
  }
}

/** Symmetric eigen-decomposition (Jacobi), for the small correlation matrix. */
function eigh(m: number[][]) {
  const n = m.length, a = m.map((r) => [...r]), v: number[][] = a.map((_, i) => a.map((__, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return { vals: a.map((r, i) => r[i]), vecs: v };
}

const interp = (x: number, xs: ArrayLike<number>, ys: ArrayLike<number>) => {
  if (x <= xs[0]) return ys[0];
  const n = xs.length;
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + t * (ys[hi] - ys[lo]);
};

function synthesise(d: NonNullable<Seed['desc']>, w: number, h: number, r: Rng): Float32Array[] {
  const W = 1 << Math.ceil(Math.log2(Math.max(2, w))), H = 1 << Math.ceil(Math.log2(Math.max(2, h)));
  const ref = Math.max(...d.size);
  const edges = Array.from({ length: BANDS + 1 }, (_, i) => Math.exp(Math.log(1 / ref) + (i / BANDS) * (Math.log(0.71) - Math.log(1 / ref))));
  const freq = (k: number, n: number) => (k < n / 2 ? k : k - n) / n;
  const band = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const f = Math.hypot(freq(x, W), freq(y, H));
    let i = 0;
    while (i <= BANDS && edges[i] < f) i++;
    band[y * W + x] = Math.min(BANDS - 1, Math.max(0, i - 1));
  }
  const fields = d.spectrum.map((spec) => {
    const re = new Float64Array(W * H), im = new Float64Array(W * H);
    for (let i = 0; i < re.length; i++) re[i] = r.normal();
    fft2(re, im, W, H, false);
    for (let i = 0; i < re.length; i++) {
      const a = i === 0 ? 0 : Math.sqrt(spec[band[i]]);
      re[i] *= a;
      im[i] *= a;
    }
    fft2(re, im, W, H, true);
    // the crop to w×h, standardised
    const out = new Float64Array(w * h);
    let s = 0, s2 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = re[y * W + x];
      out[y * w + x] = v;
      s += v;
      s2 += v * v;
    }
    const m = s / out.length, sd = Math.sqrt(Math.max(1e-30, s2 / out.length - m * m));
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - m) / sd;
    return out;
  });
  // mixed towards the chemicals' correlations (nearest positive definite)
  const { vals, vecs } = eigh(d.corr);
  const n = d.n;
  const M = vecs.map((_, i) => vecs.map((__, j) => vecs[i].reduce((s, _v, k) => s + vecs[i][k] * Math.sqrt(Math.max(1e-6, vals[k])) * vecs[j][k], 0)));
  const cdf = Array.from({ length: QUANTILES }, (_, i) => i / (QUANTILES - 1));
  const out: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const q = d.quantiles[i], o = new Float32Array(w * h);
    if (d.constant[i]) {
      o.fill(q[0]);
      out.push(o);
      continue;
    }
    const F = new Float64Array(w * h);
    let s2 = 0;
    for (let p = 0; p < F.length; p++) {
      let v = 0;
      for (let k = 0; k < n; k++) v += M[i][k] * fields[k][p];
      F[p] = v;
      s2 += v * v;
    }
    const sd = Math.sqrt(Math.max(1e-30, s2 / F.length));
    for (let p = 0; p < F.length; p++) o[p] = interp(phi(F[p] / sd), cdf, q);
    out.push(o);
  }
  return out;
}

/** The patches as k arrays of (n, s, s), each chemical dequantised over its range. */
function patches(seed: Seed) {
  const P = seed.patches!, [n, k, s] = P.shape, top = P.codes instanceof Uint16Array ? 65535 : 255;
  return Array.from({ length: k }, (_, j) => Array.from({ length: n }, (__, c) => {
    const o = new Float32Array(s * s), base = (c * k + j) * s * s;
    for (let i = 0; i < s * s; i++) o[i] = P.lo[c] + (P.codes[base + i] / top) * (P.hi[c] - P.lo[c]);
    return o;
  }));
}

/** (x, y) in a patch of side s after rotating by `rot` quarter turns and maybe flipping. */
const orient = (x: number, y: number, s: number, rot: number, flip: boolean) => {
  if (flip) x = s - 1 - x;
  for (let i = 0; i < rot; i++) [x, y] = [s - 1 - y, x];
  return y * s + x;
};

function tile(ps: Float32Array[][], w: number, h: number, r: Rng) {
  const n = ps[0].length, s = Math.round(Math.sqrt(ps[0][0].length));
  const out = Array.from({ length: n }, () => new Float32Array(w * h));
  for (let y0 = 0; y0 < h; y0 += s) for (let x0 = 0; x0 < w; x0 += s) {
    const p = ps[r.int(ps.length)], rot = r.int(4), flip = r.int(2) === 1, rx = r.int(s), ry = r.int(s);
    for (let y = 0; y < Math.min(s, h - y0); y++) for (let x = 0; x < Math.min(s, w - x0); x++) {
      const i = orient((x + rx) % s, (y + ry) % s, s, rot, flip);
      for (let c = 0; c < n; c++) out[c][(y0 + y) * w + x0 + x] = p[c][i];
    }
  }
  return out;
}

function scatter(bg: Float32Array[], p: Float32Array[], coverage: number, w: number, h: number, r: Rng) {
  const s = Math.round(Math.sqrt(p[0].length));
  const m = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const rx = (x - (s - 1) / 2) / (s / 2), ry = (y - (s - 1) / 2) / (s / 2);
    m[y * s + x] = Math.min(1, Math.max(0, (1 - Math.max(Math.abs(rx), Math.abs(ry))) * 4));
  }
  const count = Math.max(1, Math.round((coverage * h * w) / (s * s)));
  for (let t = 0; t < count; t++) {
    const rot = r.int(4), y0 = r.int(h), x0 = r.int(w);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const i = orient(x, y, s, rot, false), mm = m[y * s + x];
      if (!mm) continue;
      const j = ((y0 + y) % h) * w + ((x0 + x) % w);
      for (let c = 0; c < bg.length; c++) bg[c][j] = bg[c][j] * (1 - mm) + p[c][i] * mm;
    }
  }
  return bg;
}

/** A whole stored state, (n, H, W), centred on a w×h grid (cropped, or wrapped round if smaller). */
function fitState(get: (c: number, i: number) => number, n: number, H: number, W: number, w: number, h: number) {
  const ox = Math.floor((W - w) / 2), oy = Math.floor((H - h) / 2);
  const mod = (a: number, b: number) => ((a % b) + b) % b;
  return Array.from({ length: n }, (_, c) => {
    const o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = get(c, mod(y + oy, H) * W + mod(x + ox, W));
    return o;
  });
}

/** The start state a seed grows into on a w×h grid, one array per chemical (in seed.names order). */
export function growSeed(seed: Seed, w: number, h: number, randomSeed = 1): Float32Array[] {
  const r = rng(randomSeed);
  const n = seed.names.length;
  let s: Float32Array[];
  switch (seed.kind) {
    case 'exact': {
      const [, H, W] = seed.exact!.shape, d = seed.exact!.data;
      s = fitState((c, i) => d[c * H * W + i], n, H, W, w, h);
      break;
    }
    case 'q8':
    case 'q16': {
      const st = seed.state!, [, H, W] = st.shape, top = seed.kind === 'q8' ? 255 : 65535;
      s = fitState((c, i) => st.lo[c] + (st.codes[c * H * W + i] / top) * (st.hi[c] - st.lo[c]), n, H, W, w, h);
      break;
    }
    case 'synthetic':
      s = synthesise(seed.desc!, w, h, r);
      break;
    case 'patch':
    case 'patches4':
      s = tile(patches(seed), w, h, r);
      break;
    case 'patch_on_synth':
      s = scatter(synthesise(seed.desc!, w, h, r), patches(seed)[0], 0.3, w, h, r);
      break;
    case 'patch_on_rest':
      s = scatter(seed.bg!.map((v) => new Float32Array(w * h).fill(v)), patches(seed)[0], seed.coverage ?? 0.3, w, h, r);
      break;
    default:
      throw new Error(`seed kind ${seed.kind}`);
  }
  // shifted to the saved means
  return s.map((a, c) => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i];
    const d = (seed.means[c] ?? sum / a.length) - sum / a.length;
    for (let i = 0; i < a.length; i++) a[i] += d;
    return a;
  });
}
