// Draws the field: one reagent through a palette (optionally tinted by a second,
// typically hidden, reagent), or a false-colour map of three paintable params.
// Walls are overlaid hatched.

override S: u32 = 1u;
override P: u32 = 1u;

struct View {
  width: u32,
  height: u32,
  canvasW: f32,
  canvasH: f32,
  mode: u32,       // 0 = reagent, 1 = params
  palette: u32,
  reagent: u32,
  tint: u32,       // reagent index, or >= 8 for none
  low: f32,
  high: f32,
  tintLow: f32,
  tintHigh: f32,
  tintStrength: f32,
  _p0: f32,
  _p1: f32,
  _p2: f32,
  paramSlot: vec4<u32>,   // flat param slots for r, g, b (0 = unused)
  paramMin: vec4<f32>,
  paramMax: vec4<f32>,
};

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> params: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> state: array<vec4<f32>>;

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

// Cosine palettes (Inigo Quilez).
fn cosPal(t: f32, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, d: vec3<f32>) -> vec3<f32> {
  return a + b * cos(6.28318 * (c * t + d));
}

fn palette(t: f32) -> vec3<f32> {
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
  } else if (view.palette == 4u) {
    // HSV: the shown reagent is the hue, the tint reagent the saturation (tint mix: how much).
    var sat = 1.0;
    if (view.tint < 8u) {
      sat = mix(1.0, norm(sampleReagent(g, view.tint), view.tintLow, view.tintHigh), view.tintStrength);
    }
    col = hsv(t, sat, 1.0);
  } else {
    col = palette(t);
    if (view.tint < 8u) {
      // Hidden reagent shown as hue, strongest where it's high.
      let u = norm(sampleReagent(g, view.tint), view.tintLow, view.tintHigh);
      let h = hue(0.08 + 0.75 * u);
      col = mix(col, col * 0.35 + h * (0.25 + 0.75 * max(t, 0.35)), view.tintStrength * smoothstep(0.02, 0.25, u));
    }
  }

  if (paramAt(cell, 0u) > 0.5) {
    let stripe = step(0.5, fract((pos.x + pos.y) / 10.0));
    col = mix(vec3<f32>(0.32, 0.33, 0.36), vec3<f32>(0.4, 0.41, 0.44), stripe);
  }
  return vec4<f32>(col, 1.0);
}
