// Per-region statistics: one workgroup per probe, strided accumulation then a
// shared-memory tree reduction. Wall cells are excluded.
// out[i*5 + 0..1] = mean of reagents 0-3 / 4-7
// out[i*5 + 2..3] = max of reagents 0-3 / 4-7
// out[i*5 + 4].x  = non-wall cell count

override S: u32 = 1u;
override P: u32 = 1u;

struct Region {
  x: i32,
  y: i32,
  w: i32,
  h: i32,
  round: i32, // 1: only the ellipse inscribed in the rect
  _p0: i32,
  _p1: i32,
  _p2: i32,
};

struct Info {
  width: u32,
  height: u32,
  _p0: u32,
  _p1: u32,
};

const WG: u32 = 128u;
const LOW: f32 = -3.0e38;

@group(0) @binding(0) var<uniform> info: Info;
@group(0) @binding(1) var<storage, read> regions: array<Region>;
@group(0) @binding(2) var<storage, read> params: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> state: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> out: array<vec4<f32>>;

var<workgroup> sumA: array<vec4<f32>, WG>;
var<workgroup> sumB: array<vec4<f32>, WG>;
var<workgroup> maxA: array<vec4<f32>, WG>;
var<workgroup> maxB: array<vec4<f32>, WG>;
var<workgroup> cnt: array<f32, WG>;

@compute @workgroup_size(128)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let r = regions[wg.x];
  let w = i32(info.width);
  let h = i32(info.height);
  let n = u32(max(r.w * r.h, 0));

  var sa = vec4<f32>(0.0);
  var sb = vec4<f32>(0.0);
  var ma = vec4<f32>(LOW);
  var mb = vec4<f32>(LOW);
  var c = 0.0;
  for (var k = li; k < n; k += WG) {
    let lx = i32(k % u32(r.w));
    let ly = i32(k / u32(r.w));
    let x = (r.x + lx + w) % w;
    let y = (r.y + ly + h) % h;
    let i = u32(y * w + x);
    let e = (vec2<f32>(f32(lx), f32(ly)) + 0.5) / vec2<f32>(f32(r.w), f32(r.h)) - 0.5;
    let inside = r.round == 0 || dot(e, e) <= 0.25;
    if (inside && params[i * P].x < 0.5) {
      let a = state[i * S];
      sa += a;
      ma = max(ma, a);
      if (S > 1u) {
        let b = state[i * S + 1u];
        sb += b;
        mb = max(mb, b);
      }
      c += 1.0;
    }
  }
  sumA[li] = sa;
  sumB[li] = sb;
  maxA[li] = ma;
  maxB[li] = mb;
  cnt[li] = c;
  workgroupBarrier();

  for (var stride = WG / 2u; stride > 0u; stride = stride / 2u) {
    if (li < stride) {
      sumA[li] += sumA[li + stride];
      sumB[li] += sumB[li + stride];
      maxA[li] = max(maxA[li], maxA[li + stride]);
      maxB[li] = max(maxB[li], maxB[li + stride]);
      cnt[li] += cnt[li + stride];
    }
    workgroupBarrier();
  }

  if (li == 0u) {
    let total = max(cnt[0], 1.0);
    let o = wg.x * 5u;
    out[o] = sumA[0] / total;
    out[o + 1u] = sumB[0] / total;
    out[o + 2u] = select(maxA[0], vec4<f32>(0.0), cnt[0] == 0.0);
    out[o + 3u] = select(maxB[0], vec4<f32>(0.0), cnt[0] == 0.0);
    out[o + 4u] = vec4<f32>(cnt[0], 0.0, 0.0, 0.0);
  }
}
