// Spectral operators around the FFT. The state is real, so `pack` puts two
// state slots into one complex signal (slot 2p as the real part, 2p+1 as the
// imaginary part; P = ceil(S/2) pairs): λ(k) is real and even in k, so the
// two results come back apart in the real and imaginary parts, and `unpack`
// writes them to the Laplacian (and bilaplacian) buffers in the state layout.
// `kmul` turns spectra into Laplacian (×λ) and, into the second pair,
// bilaplacian (×λ²) spectra, or (second = 2) a kernel convolution: a
// difference of unit-mass Gaussians, K̂ = exp(−σ1²|k|²/2) − b·exp(−σ2²|k|²/2)
// (a σ wider than the field keeps only k = 0: the field mean). With second = 3
// (propagator), the first pair gets sin(θ) and the second cos(θ), θ = sigma1·|k|²
// (sigma1 = timestep/2): the exact free Schrödinger step, e^{−iθ} on ψ = p + iq.
// λ = −|k|² (exact), or with `matched` the 9-point
// stencil's own axis response −4 sin²(|k|·dx/2)/dx² applied in every direction:
// isotropic, explicit-stable like the stencil, and close to it for tuned media.
// With second = 4 (heat), each pair gets its own Gaussian, exp(σ²λ/2): exact
// diffusion over a step when σ² = 2·D·timestep, unconditionally stable for any D.
// With second = 5 (kse), the first pair gets the exact step e^{dt·G(k)} of a Kuramoto–Sivashinsky-like growth in
// octaves: G = Σ_i w_i·B(k·ℓ_i) − k⁴/4 (the last damping the finest scales), ℓ_i = lacunarity^i, octave 0 the
// finest, B(q) = ½q²e^{1−2q²} (KSE's q² − q⁴ near its peak, ¼ at q = 1/√2, but falling to 0 rather than below, so
// one octave's damping doesn't swamp the finer ones' growth), w_i = (roughness·lacunarity²)^−i: the finest grows at
// 1, as KSE's cells do, and since a band's cells stand ∝ its growth × ℓ², each finer octave's cells stand roughness
// as tall as the next coarser one's (the big ones growing, and changing, slower).
// k = 0, the mean, decays at kstab instead (KSE's ½|∇u|² lifts it).
// With second = 6 (flow), each field is taken as a vorticity ω and the pairs get the velocity it drives (Biot–Savart,
// y up): the stream function ψ̂ = ω̂/|k|², u = ∂ψ/∂y into the first, v = −∂ψ/∂x into the second. The multipliers are
// imaginary and odd (Hermitian), so the packed pairs' outputs stay real and come back apart as the Laplacian's do.
override S: u32 = 1u;
override P: u32 = 1u;

struct Info { width: u32, height: u32, second: u32, matched: u32, dx: f32, sigma1: f32, b: f32, sigma2: f32,
  kdt: f32, koct: f32, klac: f32, krough: f32, kstab: f32, kp0: f32, kp1: f32, kp2: f32 };
@group(0) @binding(0) var<uniform> info: Info;
@group(0) @binding(1) var<storage, read> src: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> re: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> im: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> bre: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> bim: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> lap: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> bilap: array<vec4<f32>>;

@compute @workgroup_size(8, 8)
fn pack(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= info.width || gid.y >= info.height) { return; }
  let cell = gid.y * info.width + gid.x;
  for (var p = 0u; p < P; p++) {
    re[cell * P + p] = src[cell * S + 2u * p];
    im[cell * P + p] = select(vec4<f32>(0.0), src[cell * S + min(2u * p + 1u, S - 1u)], 2u * p + 1u < S);
  }
}

@compute @workgroup_size(8, 8)
fn unpack(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= info.width || gid.y >= info.height) { return; }
  let cell = gid.y * info.width + gid.x;
  for (var p = 0u; p < P; p++) {
    lap[cell * S + 2u * p] = re[cell * P + p];
    if (2u * p + 1u < S) { lap[cell * S + 2u * p + 1u] = im[cell * P + p]; }
    if (info.second != 0u) {
      bilap[cell * S + 2u * p] = bre[cell * P + p];
      if (2u * p + 1u < S) { bilap[cell * S + 2u * p + 1u] = bim[cell * P + p]; }
    }
  }
}

// Signed frequency of bin i in an n-point transform, in radians per unit length.
fn wave(i: u32, n: u32) -> f32 {
  let m = select(f32(i), f32(i) - f32(n), n > 1u && i >= n / 2u);
  return 6.283185307179586 * m / (f32(n) * info.dx);
}

@compute @workgroup_size(8, 8)
fn kmul(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= info.width || gid.y >= info.height) { return; }
  let c = (gid.y * info.width + gid.x) * P;
  let kx = wave(gid.x, info.width);
  let ky = wave(gid.y, info.height);
  var k2 = kx * kx + ky * ky;
  if (info.second == 5u) {
    let n = i32(info.koct + 0.5);
    var gr = 0.0;
    var l = 1.0;
    let wr = info.krough * info.klac * info.klac;
    for (var o = 0; o < n; o++) {
      let q2 = k2 * l * l;
      gr += pow(wr, -f32(o)) * 0.5 * q2 * exp(1.0 - 2.0 * q2);
      l *= info.klac;
    }
    gr -= 0.25 * k2 * k2;
    if (k2 == 0.0) { gr = -info.kstab; }
    let m = exp(info.kdt * gr);
    for (var k = 0u; k < P; k++) {
      re[c + k] = re[c + k] * m;
      im[c + k] = im[c + k] * m;
    }
    return;
  }
  if (info.second == 6u) {
    // rows run down, so ∂/∂y (up) is −i·ky; × −i·a is (r + i·s) → (a·s, −a·r)
    let inv = select(0.0, 1.0 / k2, k2 > 0.0);
    let au = ky * inv;
    let av = kx * inv;
    for (var k = 0u; k < P; k++) {
      let r = re[c + k];
      let s = im[c + k];
      re[c + k] = au * s;
      im[c + k] = -au * r;
      bre[c + k] = av * s;
      bim[c + k] = -av * r;
    }
    return;
  }
  let kernel = exp(-0.5 * info.sigma1 * info.sigma1 * k2) - info.b * exp(-0.5 * info.sigma2 * info.sigma2 * k2);
  if (info.matched == 1u) {
    let q = min(sqrt(k2) * info.dx, 3.141592653589793);
    let sn = sin(0.5 * q);
    k2 = 4.0 * sn * sn / (info.dx * info.dx);
  }
  for (var k = 0u; k < P; k++) {
    let r = re[c + k];
    let i = im[c + k];
    if (info.second == 1u) {
      bre[c + k] = r * (k2 * k2);
      bim[c + k] = i * (k2 * k2);
    } else if (info.second == 2u) {
      bre[c + k] = r * kernel;
      bim[c + k] = i * kernel;
    }
    if (info.second == 4u) {
      let h1 = exp(-0.5 * info.sigma1 * info.sigma1 * k2);
      let h2 = exp(-0.5 * info.sigma2 * info.sigma2 * k2);
      bre[c + k] = r * h2;
      bim[c + k] = i * h2;
      re[c + k] = r * h1;
      im[c + k] = i * h1;
      continue;
    }
    if (info.second == 3u) {
      let th = info.sigma1 * (kx * kx + ky * ky);
      bre[c + k] = r * cos(th);
      bim[c + k] = i * cos(th);
      re[c + k] = r * sin(th);
      im[c + k] = i * sin(th);
      continue;
    }
    re[c + k] = -k2 * r;
    im[c + k] = -k2 * i;
  }
}
