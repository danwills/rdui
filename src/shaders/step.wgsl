// One explicit Euler step of Gray-Scott with per-cell parameters.
// state:  (u, v) per cell
// params: (feed, kill, diffusionScale, wall) per cell
// Walls are no-flux: a wall neighbour contributes the centre value to the Laplacian.

struct Sim {
  width: u32,
  height: u32,
  du: f32,
  dv: f32,
  dt: f32,
  _p0: f32,
  _p1: f32,
  _p2: f32,
};

@group(0) @binding(0) var<uniform> sim: Sim;
@group(0) @binding(1) var<storage, read> params: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> src: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> dst: array<vec2<f32>>;

fn idx(x: i32, y: i32) -> u32 {
  let w = i32(sim.width);
  let h = i32(sim.height);
  return u32(((y + h) % h) * w + ((x + w) % w));
}

fn nb(x: i32, y: i32, centre: vec2<f32>) -> vec2<f32> {
  let j = idx(x, y);
  if (params[j].w > 0.5) {
    return centre;
  }
  return src[j];
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.width || gid.y >= sim.height) {
    return;
  }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let i = idx(x, y);
  let p = params[i];
  let c = src[i];

  if (p.w > 0.5) {
    dst[i] = vec2<f32>(1.0, 0.0);
    return;
  }

  // 9-point Laplacian: 0.2 edges, 0.05 corners, -1 centre.
  var lap = -c;
  lap += 0.2 * (nb(x + 1, y, c) + nb(x - 1, y, c) + nb(x, y + 1, c) + nb(x, y - 1, c));
  lap += 0.05 * (nb(x + 1, y + 1, c) + nb(x - 1, y + 1, c) + nb(x + 1, y - 1, c) + nb(x - 1, y - 1, c));

  let u = c.x;
  let v = c.y;
  let uvv = u * v * v;
  let feed = p.x;
  let kill = p.y;
  let ds = p.z;

  let nu = u + sim.dt * (sim.du * ds * lap.x - uvv + feed * (1.0 - u));
  let nv = v + sim.dt * (sim.dv * ds * lap.y + uvv - (feed + kill) * v);
  dst[i] = clamp(vec2<f32>(nu, nv), vec2<f32>(0.0), vec2<f32>(1.0));
}
