// Spectral operators around the FFT: `pack` copies the state into the complex
// buffers; `kmul` turns spectra into Laplacian (×λ) and, into the second pair,
// bilaplacian (×λ²) spectra. λ = −|k|² (exact), or with `matched` the 9-point
// stencil's own axis response −4 sin²(|k|·dx/2)/dx² applied in every direction:
// isotropic, explicit-stable like the stencil, and close to it for tuned media.
override S: u32 = 1u;

struct Info { width: u32, height: u32, bilap: u32, matched: u32, dx: f32, _q: f32, _r: f32, _s: f32 };
@group(0) @binding(0) var<uniform> info: Info;
@group(0) @binding(1) var<storage, read> src: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> re: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> im: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> bre: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> bim: array<vec4<f32>>;

@compute @workgroup_size(8, 8)
fn pack(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= info.width || gid.y >= info.height) { return; }
  let c = (gid.y * info.width + gid.x) * S;
  for (var k = 0u; k < S; k++) {
    re[c + k] = src[c + k];
    im[c + k] = vec4<f32>(0.0);
  }
}

// Signed frequency of bin i in an n-point transform, in radians per unit length.
fn wave(i: u32, n: u32) -> f32 {
  let m = select(f32(i), f32(i) - f32(n), i >= n / 2u);
  return 6.283185307179586 * m / (f32(n) * info.dx);
}

@compute @workgroup_size(8, 8)
fn kmul(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= info.width || gid.y >= info.height) { return; }
  let c = (gid.y * info.width + gid.x) * S;
  let kx = wave(gid.x, info.width);
  let ky = wave(gid.y, info.height);
  var k2 = kx * kx + ky * ky;
  if (info.matched == 1u) {
    let q = min(sqrt(k2) * info.dx, 3.141592653589793);
    let sn = sin(0.5 * q);
    k2 = 4.0 * sn * sn / (info.dx * info.dx);
  }
  for (var k = 0u; k < S; k++) {
    let r = re[c + k];
    let i = im[c + k];
    if (info.bilap == 1u) {
      bre[c + k] = r * (k2 * k2);
      bim[c + k] = i * (k2 * k2);
    }
    re[c + k] = -k2 * r;
    im[c + k] = -k2 * i;
  }
}
