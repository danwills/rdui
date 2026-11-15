// Applies a capsule-shaped brush stroke (segment a→b) to state and/or params.
// S / P: vec4s per cell of state / params (pipeline-overridable).

override S: u32 = 1u;
override P: u32 = 1u;

struct Brush {
  a: vec2<f32>,
  b: vec2<f32>,
  radius: f32,
  mode: u32,
  strength: f32,
  hardness: f32,
  salt: f32,
  slot: f32,      // MODE_SET_PARAM: flat param slot
  clear: f32,     // MODE_SET_PARAM: 1 = reset chemistry to rest
  _p2: f32,
  seed: array<vec4<f32>, 3>,      // seed target per reagent (up to 12)
  seedMask: array<vec4<f32>, 3>,  // 1 where the seed brush touches that reagent
  seedNoise: array<vec4<f32>, 3>, // noise amplitude added to the seed target
  rest: array<vec4<f32>, 3>,      // erase / wall value per reagent
  paint: array<vec4<f32>, 2>,     // per-cell param slot values (slot 0 = wall, ignored)
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
const MODE_SET_PARAM: u32 = 5u;

@group(0) @binding(0) var<uniform> brush: Brush;
@group(0) @binding(1) var<uniform> size: Size;
@group(0) @binding(2) var<storage, read_write> params: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> state: array<vec4<f32>>;

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
  let sb = i * S;
  let pb = i * P;
  let wall = params[pb].x > 0.5;

  switch brush.mode {
    case MODE_SEED: {
      if (!wall) {
        let n = hash(cell + brush.salt) - 0.5;
        for (var s = 0u; s < S; s++) {
          let goal = brush.seed[s] + brush.seedNoise[s] * n;
          state[sb + s] = mix(state[sb + s], goal, k * brush.seedMask[s]);
        }
      }
    }
    case MODE_ERASE: {
      if (!wall) {
        for (var s = 0u; s < S; s++) {
          state[sb + s] = mix(state[sb + s], brush.rest[s], k);
        }
      }
    }
    case MODE_PARAMS: {
      for (var p = 0u; p < P; p++) {
        var v = mix(params[pb + p], brush.paint[p], k);
        if (p == 0u) {
          v.x = params[pb].x; // keep the wall flag
        }
        params[pb + p] = v;
      }
    }
    case MODE_WALL: {
      if (falloff > 0.5) {
        params[pb].x = 1.0;
        for (var s = 0u; s < S; s++) {
          state[sb + s] = brush.rest[s];
        }
      }
    }
    case MODE_UNWALL: {
      if (falloff > 0.5) {
        params[pb].x = 0.0;
      }
    }
    case MODE_SET_PARAM: {
      // e.g. a wave medium's walls: a hard band of high potential (hardness 1), or
      // damping graded by the falloff (hardness 0) so its edge doesn't reflect
      if (!wall) {
        let k = u32(brush.slot);
        params[pb + (k >> 2u)][k & 3u] = mix(params[pb + (k >> 2u)][k & 3u], brush.paint[k >> 2u][k & 3u], falloff);
        if (brush.clear > 0.5 && falloff > 0.5) {
          for (var s = 0u; s < S; s++) {
            state[sb + s] = brush.rest[s];
          }
        }
      }
    }
    default: {}
  }
}
