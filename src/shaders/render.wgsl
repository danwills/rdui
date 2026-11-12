// Draws the field to the canvas: bilinear-sampled chemical through a palette,
// or a false-colour parameter map, with walls overlaid.

struct View {
  width: u32,
  height: u32,
  canvasW: f32,
  canvasH: f32,
  mode: u32,     // 0 = v, 1 = u, 2 = params
  palette: u32,
  _p0: u32,
  _p1: u32,
};

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> params: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> state: array<vec2<f32>>;

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

fn sampleState(g: vec2<f32>) -> vec2<f32> {
  let p = g - 0.5;
  let base = vec2<i32>(floor(p));
  let f = fract(p);
  let a = state[cellIdx(base)];
  let b = state[cellIdx(base + vec2<i32>(1, 0))];
  let c = state[cellIdx(base + vec2<i32>(0, 1))];
  let d = state[cellIdx(base + vec2<i32>(1, 1))];
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
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

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let g = pos.xy / vec2<f32>(view.canvasW, view.canvasH) * vec2<f32>(f32(view.width), f32(view.height));
  let cell = vec2<i32>(floor(g));
  let p = params[cellIdx(cell)];

  var col: vec3<f32>;
  if (view.mode == 2u) {
    // feed → red, kill → green, diffusion scale → blue (normalised to useful ranges)
    col = vec3<f32>(p.x / 0.1, (p.y - 0.03) / 0.045, p.z / 1.2);
    let s = sampleState(g);
    col = mix(col * 0.55, col, smoothstep(0.1, 0.3, s.y));
  } else {
    let s = sampleState(g);
    var t = s.y * 2.5;
    if (view.mode == 1u) {
      t = 1.0 - s.x;
    }
    col = palette(clamp(t, 0.0, 1.0));
  }

  if (p.w > 0.5) {
    let stripe = step(0.5, fract((pos.x + pos.y) / 10.0));
    col = mix(vec3<f32>(0.32, 0.33, 0.36), vec3<f32>(0.4, 0.41, 0.44), stripe);
  }
  return vec4<f32>(col, 1.0);
}
