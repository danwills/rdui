// In-place complex FFT along every row (axis 0) or column (axis 1) of a
// W×H field with S vec4 slots per cell; each vec4 holds 4 independent
// signals. One workgroup transforms one line of one slot in workgroup
// memory (radix-2, decimation in time). Inverse transforms scale by 1/N.
override N: u32 = 256u;
override LOGN: u32 = 8u;
override S: u32 = 1u;

struct Info { width: u32, height: u32, axis: u32, inverse: u32 };
@group(0) @binding(0) var<uniform> info: Info;
@group(0) @binding(1) var<storage, read_write> re: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> im: array<vec4<f32>>;

var<workgroup> wr: array<vec4<f32>, N>;
var<workgroup> wi: array<vec4<f32>, N>;

fn index(line: u32, e: u32, slot: u32) -> u32 {
  if (info.axis == 0u) { return (line * info.width + e) * S + slot; }
  return (e * info.width + line) * S + slot;
}

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let line = wg.x;
  let slot = wg.y;
  for (var i = t; i < N; i += 256u) {
    let j = index(line, i, slot);
    let r = reverseBits(i) >> (32u - LOGN);
    wr[r] = re[j];
    wi[r] = im[j];
  }
  workgroupBarrier();
  let sgn = select(-1.0, 1.0, info.inverse == 1u);
  for (var s = 1u; s <= LOGN; s++) {
    let half = 1u << (s - 1u);
    for (var b = t; b < N / 2u; b += 256u) {
      let j = b % half;
      let i0 = (b / half) * (half * 2u) + j;
      let i1 = i0 + half;
      let ang = sgn * 6.283185307179586 * f32(j) / f32(half * 2u);
      let c = cos(ang);
      let sn = sin(ang);
      let tr = wr[i1] * c - wi[i1] * sn;
      let ti = wr[i1] * sn + wi[i1] * c;
      wr[i1] = wr[i0] - tr;
      wi[i1] = wi[i0] - ti;
      wr[i0] = wr[i0] + tr;
      wi[i0] = wi[i0] + ti;
    }
    workgroupBarrier();
  }
  let scale = select(1.0, 1.0 / f32(N), info.inverse == 1u);
  for (var i = t; i < N; i += 256u) {
    let j = index(line, i, slot);
    re[j] = wr[i] * scale;
    im[j] = wi[i] * scale;
  }
}
