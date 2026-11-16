// Draws the field: one reagent through a palette (optionally tinted by a second,
// typically hidden, reagent), or a false-colour map of three paintable params,
// or the reagent view with outlines where those params change.
// Walls are overlaid hatched.

override S: u32 = 1u;
override P: u32 = 1u;

struct View {
  width: u32,
  height: u32,
  canvasW: f32,
  canvasH: f32,
  mode: u32,       // 0 = reagent, 1 = params, 2 = reagent + param outlines
  palette: u32,
  reagent: u32,
  tint: u32,       // reagent index, or >= 12 for none
  low: f32,
  high: f32,
  tintLow: f32,
  tintHigh: f32,
  tintStrength: f32,
  hueShape: f32,   // fleck palettes: smoothMap shape (1 = linear) and cyclic hue shift
  hueOffset: f32,
  reagents: f32,   // the rule's reagent count
  paramSlot: vec4<u32>,   // flat param slots for r, g, b (0 = unused)
  paramMin: vec4<f32>,
  paramMax: vec4<f32>,
  paramBase: vec4<f32>,   // unpainted value of each (outlines mode); for a wall distance field, the wall growth
  paramKind: vec4<u32>,   // 1 = a wall distance field (signed distance in cells, negative inside)
  fleck: vec4<f32>,       // fleck palettes: the range (low, high) a, b and c are mapped through first; z, the intensity lightness and chroma are scaled by
  custom: array<vec4<f32>, 24>, // custom palette, per reagent: (low, high, power, on), (r, g, b, -)
  customGrade: vec4<f32>,       // custom palette: contrast, saturation applied to the sum
};

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> params: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> state: array<vec4<f32>>;
// colour maps (colormaps.ts): one per 256 entries, RGBA8 packed
@group(0) @binding(3) var<storage, read> colormaps: array<u32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

fn cellIdx(c: vec2<i32>) -> u32 {
  let w = i32(view.width);
  let h = i32(view.height);
  return u32(((c.y + h) % h) * w + ((c.x + w) % w));
}

fn reagentAt(cell: u32, r: u32) -> f32 {
  return state[cell * S + (r >> 2u)][r & 3u];
}

fn sampleReagent(g: vec2<f32>, r: u32) -> f32 {
  let p = g - 0.5;
  let base = vec2<i32>(floor(p));
  let f = fract(p);
  let a = reagentAt(cellIdx(base), r);
  let b = reagentAt(cellIdx(base + vec2<i32>(1, 0)), r);
  let c = reagentAt(cellIdx(base + vec2<i32>(0, 1)), r);
  let d = reagentAt(cellIdx(base + vec2<i32>(1, 1)), r);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn paramAt(cell: u32, slot: u32) -> f32 {
  return params[cell * P + (slot >> 2u)][slot & 3u];
}

// How far cell c's param k is from its unpainted value (as a fraction of its range), log-compressed:
// paint that rises steeply into a wall (V up to 30) then changes steadily from cell to cell, like a
// distance field, so its contour is smooth; soft paint (tracks, damping) is barely changed.
fn paintedAt(c: vec2<i32>, k: u32) -> f32 {
  let dv = abs(paramAt(cellIdx(c), view.paramSlot[k]) - view.paramBase[k]) / max(view.paramMax[k] - view.paramMin[k], 1e-6);
  return log(1.0 + dv / 0.003) / log(1.0 + 1.0 / 0.003);
}

fn sampleParam(g: vec2<f32>, slot: u32) -> f32 {
  let p = g - 0.5;
  let base = vec2<i32>(floor(p));
  let f = fract(p);
  let a = paramAt(cellIdx(base), slot);
  let b = paramAt(cellIdx(base + vec2<i32>(1, 0)), slot);
  let c = paramAt(cellIdx(base + vec2<i32>(0, 1)), slot);
  let d = paramAt(cellIdx(base + vec2<i32>(1, 1)), slot);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn bspline(t: f32) -> vec4<f32> {
  let t2 = t * t;
  let t3 = t2 * t;
  return vec4<f32>((1.0 - t) * (1.0 - t) * (1.0 - t), 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0;
}

// How painted param k is here, log-compressed as in paintedAt (outline at OUTLINE_AT). The paint is smoothed with a cubic
// B-spline first, so the outline is a smooth curve (reflecting walls ramp up over their edge
// cells, so even they have no cell steps).
fn samplePainted(g: vec2<f32>, k: u32) -> f32 {
  let p = g - 0.5;
  let base = vec2<i32>(floor(p));
  let wx = bspline(fract(p.x));
  let wy = bspline(fract(p.y));
  var m = 0.0;
  for (var j = 0; j < 4; j++) {
    for (var i = 0; i < 4; i++) {
      m += wx[i] * wy[j] * paintedAt(base + vec2<i32>(i - 1, j - 1), k);
    }
  }
  return m;
}

const OUTLINE_AT = 0.3;

// Cosine palettes (Inigo Quilez).
fn cosPal(t: f32, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, d: vec3<f32>) -> vec3<f32> {
  return a + b * cos(6.28318 * (c * t + d));
}

// colour map m (palette 100 + m) at t, linear between its 256 steps
fn colormap(m: u32, t: f32) -> vec3<f32> {
  let x = clamp(t, 0.0, 1.0) * 255.0;
  let i = min(u32(x), 254u);
  let a = unpack4x8unorm(colormaps[m * 256u + i]).rgb;
  let b = unpack4x8unorm(colormaps[m * 256u + i + 1u]).rgb;
  return mix(a, b, x - f32(i));
}

// custom palette: each reagent switched on, fitted (low → 0, high → 1), raised to its power and
// multiplied by its colour; the colours summed, then contrast (about mid-grey) and saturation
fn customColor(g: vec2<f32>) -> vec3<f32> {
  var c = vec3<f32>(0.0);
  let n = min(u32(view.reagents), 12u);
  for (var r = 0u; r < n; r++) {
    let a = view.custom[2u * r];
    if (a.w > 0.5) {
      let t = norm(sampleReagent(g, r), a.x, a.y);
      c += pow(t, max(a.z, 1e-3)) * view.custom[2u * r + 1u].rgb;
    }
  }
  c = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
  c = (c - 0.5) * view.customGrade.x + 0.5;
  let luma = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  c = mix(vec3<f32>(luma), c, view.customGrade.y);
  return clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn palette(t: f32) -> vec3<f32> {
  if (view.palette >= 100u) {
    return colormap(view.palette - 100u, t);
  }
  switch view.palette {
    case 1u: { // ember
      return clamp(vec3<f32>(t * 2.2, t * t * 1.6, pow(t, 4.0) * 1.2), vec3<f32>(0.0), vec3<f32>(1.0));
    }
    case 2u: { // mono
      return vec3<f32>(t);
    }
    case 3u: { // spectral
      return cosPal(t, vec3<f32>(0.5), vec3<f32>(0.5), vec3<f32>(1.0), vec3<f32>(0.0, 0.33, 0.67)) * smoothstep(0.0, 0.08, t);
    }
    default: { // abyss
      let c = cosPal(t * 0.85, vec3<f32>(0.5, 0.5, 0.6), vec3<f32>(0.5, 0.5, 0.4), vec3<f32>(1.0, 0.9, 0.6), vec3<f32>(0.55, 0.6, 0.65));
      return mix(vec3<f32>(0.02, 0.03, 0.06), c, smoothstep(0.0, 0.25, t));
    }
  }
}

fn hue(t: f32) -> vec3<f32> {
  return cosPal(t, vec3<f32>(0.5), vec3<f32>(0.5), vec3<f32>(1.0), vec3<f32>(0.0, 0.33, 0.67));
}

fn hsv(h: f32, s: f32, v: f32) -> vec3<f32> {
  let k = fract(vec3<f32>(h) + vec3<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0;
  return v * mix(vec3<f32>(1.0), clamp(abs(k) - 1.0, vec3<f32>(0.0), vec3<f32>(1.0)), s);
}

// "Fleck" palettes (after Dan's GrayScottHSVFleck shader): the first three
// reagents (a, b, c) as an RGB colour, re-expressed in a polar colour space as (lightness, chroma, hue),
// and that triple shown as RGB. Each space is just a conversion to that triple (polarOf); the hue
// shaping below is shared, so another space is one more converter and a palette entry.

// x in [0, 1] → [0, 1], ends fixed: shape 1 is the identity, above 1 steeper in the middle (softer at the
// ends), below 1 the reverse. Normalised, so every shape keeps the ends exactly at 0 and 1.
fn smoothMap(x: f32, shape: f32) -> f32 {
  let v = clamp(x * 2.0 - 1.0, -1.0, 1.0);
  let k = max(shape, 1.0e-3);
  return 0.5 + 0.5 * v * sqrt(k) / sqrt(1.0 + (k - 1.0) * v * v);
}

// Hue (turns) as one channel. Hue goes round a circle and a channel is a line, so it can't be shown
// without a seam unless it folds: it rises from the offset to the opposite hue and falls back again,
// continuous for every offset and shape (hues mirrored about the offset look alike, the price of no
// seam). Where there's little colour (chroma near 0) hue is meaningless and jumps about, so it fades out.
fn hueChannel(h: f32, chroma: f32) -> f32 {
  let x = fract(h - view.hueOffset);
  let fold = 1.0 - abs(2.0 * x - 1.0);
  return smoothMap(fold, view.hueShape) * smoothstep(0.0, 0.06, chroma);
}

fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-5;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn cbrt(x: f32) -> f32 {
  return sign(x) * pow(abs(x), 1.0 / 3.0);
}

// (a, b, c) as linear sRGB → OKLab → (L, C / 0.32, hue turns)
fn rgb2oklch(c: vec3<f32>) -> vec3<f32> {
  let l = cbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b);
  let m = cbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b);
  let s = cbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  let L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  let A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  let B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return vec3<f32>(L, length(vec2<f32>(A, B)) / 0.32, fract(atan2(B, A) / 6.283185307179586));
}

// (lightness, chroma, hue turns) of an RGB colour in the fleck palette's colour space
fn polarOf(palette: u32, c: vec3<f32>) -> vec3<f32> {
  switch palette {
    case 6u: { return rgb2oklch(c); }
    default: { let v = rgb2hsv(c); return vec3<f32>(v.z, v.y, v.x); }
  }
}

// a, b, c through the fleck range (low → 0, high → 1), with smooth ends rather than a hard
// clamp: linear between KNEE and 1 - KNEE, then easing exponentially towards 0 and 1 (value and
// slope continuous), so values past either end (negatives too) still shade, compressed, not cut off
const KNEE = 0.05;
fn softUnit(t: f32) -> f32 {
  if (t < KNEE) { return KNEE * exp((t - KNEE) / KNEE); }
  if (t > 1.0 - KNEE) { return 1.0 - KNEE * exp((1.0 - KNEE - t) / KNEE); }
  return t;
}
fn fleckRange(v: vec3<f32>) -> vec3<f32> {
  let t = (v - view.fleck.x) / max(view.fleck.y - view.fleck.x, 1e-9);
  return vec3<f32>(softUnit(t.x), softUnit(t.y), softUnit(t.z));
}

fn fleck(g: vec2<f32>) -> vec3<f32> {
  let a = sampleReagent(g, 0u);
  let b = sampleReagent(g, 1u);
  // With no third reagent, c is stood in by where the shader's c settles: it's made
  // by b and decays (b_to_c 0.05, c_damp 0.0055), so c → 9.1·b, clamped to 1.
  let c = select(clamp(9.1 * b, 0.0, 1.0), sampleReagent(g, 2u), view.reagents > 2.5);
  let p = polarOf(view.palette, fleckRange(vec3<f32>(a, b, c)));
  // intensity: lightness and chroma (V and S for HSV) scaled, so whites and clipped chroma come
  // down; hue as it was (it fades by the unscaled chroma)
  let k = view.fleck.z;
  return clamp(vec3<f32>(p.x * k, p.y * k, hueChannel(p.z, p.y)), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn norm(v: f32, lo: f32, hi: f32) -> f32 {
  return clamp((v - lo) / max(hi - lo, 1e-9), 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let g = pos.xy / vec2<f32>(view.canvasW, view.canvasH) * vec2<f32>(f32(view.width), f32(view.height));
  let cell = cellIdx(vec2<i32>(floor(g)));

  var col: vec3<f32>;
  let t = norm(sampleReagent(g, view.reagent), view.low, view.high);
  if (view.mode == 1u) {
    var pc = vec3<f32>(0.0);
    for (var k = 0u; k < 3u; k++) {
      if (view.paramSlot[k] > 0u) {
        pc[k] = norm(paramAt(cell, view.paramSlot[k]), view.paramMin[k], view.paramMax[k]);
      }
    }
    col = mix(pc * 0.55, pc, smoothstep(0.2, 0.6, t));
  } else if (view.palette == 5u || view.palette == 6u) {
    col = fleck(g);
  } else if (view.palette == 7u) {
    col = customColor(g);
  } else if (view.palette == 4u) {
    // HSV: the shown reagent is the hue, the tint reagent the saturation (tint mix: how much).
    var sat = 1.0;
    if (view.tint < 12u) {
      sat = mix(1.0, norm(sampleReagent(g, view.tint), view.tintLow, view.tintHigh), view.tintStrength);
    }
    col = hsv(t, sat, 1.0);
  } else {
    col = palette(t);
    if (view.tint < 12u) {
      // Hidden reagent shown as hue, strongest where it's high.
      let u = norm(sampleReagent(g, view.tint), view.tintLow, view.tintHigh);
      let h = hue(0.08 + 0.75 * u);
      col = mix(col, col * 0.35 + h * (0.25 + 0.75 * max(t, 0.35)), view.tintStrength * smoothstep(0.02, 0.25, u));
    }
  }

  if (view.mode == 2u) {
    // painted params: where each differs from its unpainted value, a light wash with a crisp
    // anti-aliased outline (the half-way contour of a smoothly sampled mask), coloured as in the param map
    for (var k = 0u; k < 4u; k++) {
      let slot = view.paramSlot[k];
      let sdf = view.paramKind[k] == 1u;
      // m: a wall distance field's signed distance (cells, less the growth; outline at 0), or other
      // paint's smoothed, log-compressed strength (outline at OUTLINE_AT)
      var m = 0.0;
      if (slot > 0u) {
        if (sdf) { m = sampleParam(g, slot) - view.paramBase[k]; } else { m = samplePainted(g, k); }
      }
      let fw = max(fwidth(m), 1e-6);
      var painted = smoothstep(0.0, 2.0 * OUTLINE_AT, m);
      var level = OUTLINE_AT;
      if (sdf) {
        painted = 1.0 - smoothstep(-0.5, 0.5, m);
        level = 0.0;
      }
      if (slot == 0u) { painted = 0.0; }
      // a ~1.5 px line along the contour, its width set by how fast m changes per pixel
      let edge = select(0.0, 1.0 - smoothstep(0.5, 1.0, abs(m - level) / fw), slot > 0u);
      var lc = vec3<f32>(1.0, 0.35, 0.3);
      if (k == 1u) { lc = vec3<f32>(0.35, 1.0, 0.45); }
      if (k == 2u) { lc = vec3<f32>(0.4, 0.6, 1.0); }
      if (k == 3u) { lc = vec3<f32>(1.0, 0.7, 0.25); }
      col = mix(col, lc, 0.22 * painted);
      col = mix(col, lc, 0.85 * edge);
    }
  }

  // walls: coverage smoothed between cell centres (a cubic B-spline over the nearest 4x4 cells), its
  // 0.5 contour antialiased over a screen pixel, so a wall's edge is a smooth curve, not the cells' stairs
  let wb = g - 0.5;
  let w0 = vec2<i32>(floor(wb)) - vec2<i32>(1);
  let wf = wb - floor(wb);
  let bx = bspline(wf.x);
  let by = bspline(wf.y);
  var cover = 0.0;
  var feed = 0.0;
  for (var j = 0; j < 16; j++) {
    let o = vec2<i32>(j & 3, j >> 2);
    let wt = bx[o.x] * by[o.y];
    let fl = paramAt(cellIdx(w0 + o), 0u);
    cover += wt * step(0.5, fl);
    feed += wt * step(1.5, fl);
  }
  let aa = max(fwidth(cover), 1e-4);
  let wallAmt = smoothstep(0.5 - aa, 0.5 + aa, cover);
  if (wallAmt > 0.0) {
    let stripe = smoothstep(0.42, 0.58, abs(fract((pos.x + pos.y) / 10.0) - 0.5) * 2.0);
    let sealedCol = mix(vec3<f32>(0.32, 0.33, 0.36), vec3<f32>(0.4, 0.41, 0.44), stripe);
    // a feed wall: greenish stripes the other way
    let s2 = smoothstep(0.42, 0.58, abs(fract((pos.x - pos.y) / 10.0) - 0.5) * 2.0);
    let feedCol = mix(vec3<f32>(0.28, 0.38, 0.32), vec3<f32>(0.36, 0.47, 0.40), s2);
    let wc = mix(sealedCol, feedCol, step(0.5, feed / max(cover, 1e-6)));
    col = mix(col, wc, wallAmt);
  }
  return vec4<f32>(col, 1.0);
}
