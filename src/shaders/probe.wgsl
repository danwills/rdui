// Per-region statistics: one workgroup per probe, strided accumulation then a
// shared-memory tree reduction. Wall cells are excluded.
// out[i] = (mean u, mean v, max v, non-wall cell count)

struct Region {
  x: i32,
  y: i32,
  w: i32,
  h: i32,
};

struct Info {
  width: u32,
  height: u32,
  _p0: u32,
  _p1: u32,
};

const WG: u32 = 256u;

@group(0) @binding(0) var<uniform> info: Info;
@group(0) @binding(1) var<storage, read> regions: array<Region>;
@group(0) @binding(2) var<storage, read> params: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> state: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> out: array<vec4<f32>>;

var<workgroup> acc: array<vec4<f32>, WG>;

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let r = regions[wg.x];
  let w = i32(info.width);
  let h = i32(info.height);
  let n = u32(max(r.w * r.h, 0));

  var a = vec4<f32>(0.0);
  for (var k = li; k < n; k += WG) {
    let x = (r.x + i32(k % u32(r.w)) + w) % w;
    let y = (r.y + i32(k / u32(r.w)) + h) % h;
    let i = u32(y * w + x);
    if (params[i].w < 0.5) {
      let s = state[i];
      a = vec4<f32>(a.x + s.x, a.y + s.y, max(a.z, s.y), a.w + 1.0);
    }
  }
  acc[li] = a;
  workgroupBarrier();

  for (var stride = WG / 2u; stride > 0u; stride = stride / 2u) {
    if (li < stride) {
      let b = acc[li + stride];
      let c = acc[li];
      acc[li] = vec4<f32>(c.x + b.x, c.y + b.y, max(c.z, b.z), c.w + b.w);
    }
    workgroupBarrier();
  }

  if (li == 0u) {
    let t = acc[0];
    let cnt = max(t.w, 1.0);
    out[wg.x] = vec4<f32>(t.x / cnt, t.y / cnt, t.z, t.w);
  }
}
