// The Smooth brush: within a capsule stroke (segment a→b), walls are smoothed by a vote at two scales:
// a wall cell opens when walls are a minority in a small disc but a fair share (≥ 40%) of one twice as
// wide, so it's a bump on something solid rather than the end or side of a thin wall; an open cell fills
// when walls are the majority at both. Bumps, notches and jaggies go and corners round a little, while thin
// walls, rings and doors stay, and it settles after a few passes rather than eating away (a plain majority
// vote, repeated, shortens every wall from its ends). Specks (a few cells, all within the small disc) go too. Painted params (wall
// distance fields included) are blurred towards their open neighbours' mean, and, with `clear`, so is
// the chemistry.
// It reads a copy of the field taken before the stroke (paramsSrc / stateSrc), so cells don't see each
// other's new values; each stroke segment is one pass, and dragging back and forth keeps smoothing.

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
  slot: f32,
  clear: f32,     // 1 = blur the reagents too
  base: f32,
  seed: array<vec4<f32>, 8>,
  seedMask: array<vec4<f32>, 8>,
  seedNoise: array<vec4<f32>, 8>,
  rest: array<vec4<f32>, 8>,      // the value new wall cells take
  paint: array<vec4<f32>, 2>,     // 1 per param slot to blur (0: leave alone, e.g. a compartment id)
};

struct Size {
  width: u32,
  height: u32,
};

@group(0) @binding(0) var<uniform> brush: Brush;
@group(0) @binding(1) var<uniform> size: Size;
@group(0) @binding(2) var<storage, read_write> params: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> state: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> paramsSrc: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> stateSrc: array<vec4<f32>>;

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

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= size.width || gid.y >= size.height) {
    return;
  }
  let cell = vec2<f32>(f32(gid.x) + 0.5, f32(gid.y) + 0.5);
  let d = wrapDist(cell, brush.a, brush.b);
  if (d > brush.radius) {
    return;
  }
  let falloff = clamp((1.0 - d / brush.radius) / max(1.0 - brush.hardness, 1e-3), 0.0, 1.0);
  let k = brush.strength * falloff;
  let i = gid.y * size.width + gid.x;
  let sb = i * S;
  let pb = i * P;
  let flag = paramsSrc[pb].x;
  let wall = flag > 0.5;

  // the small disc: 1.5 cells up to 3.5 for a big brush (wider, and it starts eating square corners)
  let rho = clamp(brush.radius * 0.12, 1.5, 3.5);
  let wide = 2.0 * rho;
  let R = i32(ceil(wide));
  let W = i32(size.width);
  let H = i32(size.height);
  var n = 0.0;
  var walls = 0.0;
  var feeds = 0.0;
  var open = 0.0;
  var nWide = 0.0;
  var wallsWide = 0.0;
  var rim = 0.0; // wall cells in a ring 1.5 cells wide around the small disc: none means a speck within it
  var pSum: array<vec4<f32>, 2>;
  var sSum: array<vec4<f32>, 8>;
  for (var dy = -R; dy <= R; dy++) {
    for (var dx = -R; dx <= R; dx++) {
      let r2 = f32(dx * dx + dy * dy);
      if (r2 > wide * wide) {
        continue;
      }
      let x = (i32(gid.x) + dx + W) % W;
      let y = (i32(gid.y) + dy + H) % H;
      let j = u32(y * W + x);
      let f = paramsSrc[j * P].x;
      nWide += 1.0;
      if (f > 0.5) {
        wallsWide += 1.0;
        if (r2 > rho * rho && r2 <= (rho + 1.5) * (rho + 1.5)) { rim += 1.0; }
      }
      if (r2 > rho * rho) {
        continue;
      }
      n += 1.0;
      if (f > 0.5) {
        walls += 1.0;
        if (f > 1.5) { feeds += 1.0; }
        continue;
      }
      open += 1.0;
      for (var p = 0u; p < P; p++) { pSum[p] += paramsSrc[j * P + p]; }
      if (brush.clear > 0.5 || wall) {
        for (var s = 0u; s < S; s++) { sSum[s] += stateSrc[j * S + s]; }
      }
    }
  }

  let solid = wallsWide / nWide;
  if (falloff > 0.5 && wall && ((walls < 0.5 * n && solid >= 0.4) || (rim < 0.5 && walls < 0.5 * n)) && open > 0.0) {
    // a bump or a lone cell: open it, taking its open neighbours' chemistry and params
    for (var p = 0u; p < P; p++) { params[pb + p] = pSum[p] / open; }
    params[pb].x = 0.0;
    for (var s = 0u; s < S; s++) { state[sb + s] = sSum[s] / open; }
    return;
  }
  if (wall) {
    return;
  }
  if (falloff > 0.5 && walls > 0.5 * n && solid >= 0.5) {
    // a notch: fill it with wall, sealed or feeding as most of its neighbours are
    params[pb].x = select(1.0, 2.0, feeds > 0.5 * walls);
    for (var s = 0u; s < S; s++) { state[sb + s] = brush.rest[s]; }
    return;
  }
  if (open > 0.0) {
    for (var p = 0u; p < P; p++) {
      var v = mix(paramsSrc[pb + p], pSum[p] / open, k * brush.paint[p]);
      if (p == 0u) { v.x = flag; }
      params[pb + p] = v;
    }
    if (brush.clear > 0.5) {
      for (var s = 0u; s < S; s++) { state[sb + s] = mix(stateSrc[sb + s], sSum[s] / open, k); }
    }
  }
}
