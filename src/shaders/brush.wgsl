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
  base: f32,      // MODE_SET_PARAM: the param's unpainted value; MODE_WALL: 2 = a feed wall (else sealed)
  seed: array<vec4<f32>, 8>,      // seed target per reagent (up to MAX_REAGENTS, 32)
  seedMask: array<vec4<f32>, 8>,  // 1 where the seed brush touches that reagent
  seedNoise: array<vec4<f32>, 8>, // noise amplitude added to the seed target
  rest: array<vec4<f32>, 8>,      // erase / wall value per reagent
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
const MODE_SDF: u32 = 6u;
const MODE_PUSH: u32 = 8u; // seed[0].xy: velocity; seed[0].z, w, seed[1].x: the momentum's x, y and mass reagents (-1: no mass)
const SDF_REACH: f32 = 24.0; // an SDF stroke also writes distances this far outside its edge

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

// distance to the stroke on the wrapping field: the nearest of its copies shifted by a field width and/or height,
// so a stroke near an edge or corner paints across onto the other side(s)
fn wrapDist(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let W = f32(size.width);
  let H = f32(size.height);
  var d = 1e30;
  for (var i = -1; i <= 1; i++) {
    for (var j = -1; j <= 1; j++) {
      let o = vec2<f32>(f32(i) * W, f32(j) * H);
      d = min(d, segDist(p, a + o, b + o));
    }
  }
  return d;
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
  let d = wrapDist(cell, brush.a, brush.b);
  if (d > brush.radius + select(0.0, SDF_REACH, brush.mode == MODE_SDF)) {
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
        // a paint value below -1e30 leaves that slot alone (wall distance fields)
        var v = select(mix(params[pb + p], brush.paint[p], k), params[pb + p], brush.paint[p] < vec4<f32>(-1e30));
        if (p == 0u) {
          v.x = params[pb].x; // keep the wall flag
        }
        params[pb + p] = v;
      }
    }
    case MODE_WALL: {
      if (falloff > 0.5) {
        // 1: sealed (no flux through it); 2: feeding (holds the rest values, which diffuse out)
        params[pb].x = select(1.0, 2.0, brush.base > 1.5);
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
        // smooth, so a graded edge stays gentle; a hard wall (clear) rises as falloff⁴ over its edge ramp
        // instead, low at first so the display's outline (a low level of the smoothed paint) runs smoothly
        var w = falloff * falloff * (3.0 - 2.0 * falloff);
        if (brush.clear > 0.5) { w = falloff * falloff * falloff * falloff; }
        let cur = params[pb + (k >> 2u)][k & 3u];
        let goal = brush.paint[k >> 2u][k & 3u];
        var v = mix(cur, goal, w);
        if (goal != brush.base) {
          // the stroke's profile, a function of distance to the stroke (base → target by w), kept as a
          // union with what's there (max / min), so overlapping segments don't stack: an SDF-style union
          let profile = brush.base + (goal - brush.base) * w;
          v = select(min(cur, profile), max(cur, profile), goal > brush.base);
        }
        params[pb + (k >> 2u)][k & 3u] = v;
        if (brush.clear > 0.5 && falloff > 0.5) {
          for (var s = 0u; s < S; s++) {
            state[sb + s] = brush.rest[s];
          }
        }
      }
    }
    case MODE_SDF: {
      // a wall distance field (cells, negative inside): base > 0 adds this stroke (union: the nearer
      // of the two), base < 0 cuts it out (subtraction)
      if (!wall) {
        let k = u32(brush.slot);
        let cur = params[pb + (k >> 2u)][k & 3u];
        let sd = d - brush.radius;
        params[pb + (k >> 2u)][k & 3u] = select(max(cur, -sd), min(cur, sd), brush.base > 0.0);
        if (brush.clear > 0.5 && sd < 0.0 && brush.base > 0.0) {
          for (var s = 0u; s < S; s++) {
            state[sb + s] = brush.rest[s];
          }
        }
      }
    }
    case MODE_PUSH: {
      // the momentum (x, y) toward mass × velocity, by the brush's strength and falloff
      if (!wall) {
        let v = brush.seed[0].xy;
        let rx = u32(brush.seed[0].z);
        let ry = u32(brush.seed[0].w);
        var mass = 1.0;
        if (brush.seed[1].x >= 0.0) {
          let rm = u32(brush.seed[1].x);
          mass = state[sb + (rm >> 2u)][rm & 3u];
        }
        state[sb + (rx >> 2u)][rx & 3u] = mix(state[sb + (rx >> 2u)][rx & 3u], mass * v.x, k);
        state[sb + (ry >> 2u)][ry & 3u] = mix(state[sb + (ry >> 2u)][ry & 3u], mass * v.y, k);
      }
    }
    default: {}
  }
}
