// Applies a capsule-shaped brush stroke (segment a→b) to state and/or params.

struct Brush {
  a: vec2<f32>,
  b: vec2<f32>,
  radius: f32,
  mode: u32,
  strength: f32,
  hardness: f32,
  // param mode: (feed, kill, diffusionScale, _); seed mode: w = random salt
  value: vec4<f32>,
};

struct Size {
  width: u32,
  height: u32,
};

const MODE_SEED: u32 = 0u;
const MODE_ERASE: u32 = 1u;
const MODE_PARAMS: u32 = 2u;
const MODE_WALL: u32 = 3u;
const MODE_UNWALL: u32 = 4u;

@group(0) @binding(0) var<uniform> brush: Brush;
@group(0) @binding(1) var<uniform> size: Size;
@group(0) @binding(2) var<storage, read_write> params: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> state: array<vec2<f32>>;

fn segDist(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

fn hash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= size.width || gid.y >= size.height) {
    return;
  }
  let cell = vec2<f32>(f32(gid.x) + 0.5, f32(gid.y) + 0.5);
  let d = segDist(cell, brush.a, brush.b);
  if (d > brush.radius) {
    return;
  }
  let t = 1.0 - d / brush.radius;
  let falloff = clamp(t / max(1.0 - brush.hardness, 1e-3), 0.0, 1.0);
  let k = brush.strength * falloff;
  let i = gid.y * size.width + gid.x;

  switch brush.mode {
    case MODE_SEED: {
      if (params[i].w < 0.5) {
        let n = hash(cell + brush.value.w);
        let goal = vec2<f32>(0.5, 0.25 + 0.25 * n);
        state[i] = mix(state[i], goal, k);
      }
    }
    case MODE_ERASE: {
      state[i] = mix(state[i], vec2<f32>(1.0, 0.0), k);
    }
    case MODE_PARAMS: {
      let p = params[i];
      params[i] = vec4<f32>(mix(p.xyz, brush.value.xyz, k), p.w);
    }
    case MODE_WALL: {
      if (falloff > 0.5) {
        params[i].w = 1.0;
        state[i] = vec2<f32>(1.0, 0.0);
      }
    }
    case MODE_UNWALL: {
      if (falloff > 0.5) {
        params[i].w = 0.0;
      }
    }
    default: {}
  }
}
