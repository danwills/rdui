// Writing fields as OpenEXR images (one channel, Y, float or half; ZIP compressed, as OpenEXR itself does it:
// 16 scanlines a block, bytes split into halves, delta-predicted, then zlib), and a plain ZIP archive of files
// for browsers that can't write into a folder.

const ZIP_LINES = 16;

// float32 → half bits, rounded to nearest even
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0], sign = (x >>> 16) & 0x8000, e = (x >>> 23) & 0xff, m = x & 0x7fffff;
  if (e === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0); // Inf, NaN
  const he = e - 127 + 15;
  if (he >= 0x1f) return sign | 0x7c00; // too big: Inf
  if (he <= 0) { // subnormal or zero
    if (he < -10) return sign;
    const mm = m | 0x800000, shift = 14 - he;
    let h = mm >>> shift;
    const rest = mm & ((1 << shift) - 1), half = 1 << (shift - 1);
    if (rest > half || (rest === half && (h & 1))) h++;
    return sign | h;
  }
  let h = sign | (he << 10) | (m >>> 13);
  const rest = m & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (h & 1))) h++; // may carry into the exponent, which is right
  return h;
}

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** An EXR of `w`×`h` values (`data`, rows from the top), as 32-bit float or (half) 16-bit. */
export async function encodeEXR(w: number, h: number, data: Float32Array, half = false): Promise<Uint8Array> {
  const bpp = half ? 2 : 4;
  const head: number[] = [];
  const u8 = (v: number) => head.push(v & 0xff);
  const i32 = (v: number) => { for (let k = 0; k < 4; k++) u8(v >> (8 * k)); };
  const f = (v: number) => { f32[0] = v; i32(u32[0]); };
  const str = (s: string) => { for (const c of s) u8(c.charCodeAt(0)); u8(0); };
  const attr = (name: string, type: string, size: number, body: () => void) => { str(name); str(type); i32(size); body(); };
  i32(20000630); i32(2);
  attr('channels', 'chlist', 18 + 1, () => { str('Y'); i32(half ? 1 : 2); u8(0); u8(0); u8(0); u8(0); i32(1); i32(1); u8(0); });
  attr('compression', 'compression', 1, () => u8(3)); // ZIP
  attr('dataWindow', 'box2i', 16, () => { i32(0); i32(0); i32(w - 1); i32(h - 1); });
  attr('displayWindow', 'box2i', 16, () => { i32(0); i32(0); i32(w - 1); i32(h - 1); });
  attr('lineOrder', 'lineOrder', 1, () => u8(0));
  attr('pixelAspectRatio', 'float', 4, () => f(1));
  attr('screenWindowCenter', 'v2f', 8, () => { f(0); f(0); });
  attr('screenWindowWidth', 'float', 4, () => f(1));
  u8(0);

  // the raw rows, little-endian
  const raw = new Uint8Array(w * h * bpp);
  if (half) {
    const v = new DataView(raw.buffer);
    for (let i = 0; i < w * h; i++) v.setUint16(i * 2, toHalf(data[i]), true);
  } else raw.set(new Uint8Array(data.buffer, data.byteOffset, w * h * 4));

  const blocks = Math.ceil(h / ZIP_LINES);
  const chunks = await Promise.all(Array.from({ length: blocks }, async (_, b) => {
    const block = raw.subarray(b * ZIP_LINES * w * bpp, Math.min(h, (b + 1) * ZIP_LINES) * w * bpp);
    const n = block.length, t = new Uint8Array(n);
    // even bytes to the first half, odd to the second, then each byte as the difference from the one before
    for (let i = 0, a = 0, c = (n + 1) >> 1; i < n; i += 2) { t[a++] = block[i]; if (i + 1 < n) t[c++] = block[i + 1]; }
    for (let i = n - 1; i > 0; i--) t[i] = (t[i] - t[i - 1] + 128) & 0xff;
    const z = await zlib(t);
    return z.length < n ? z : block; // a block no smaller compressed is stored as it is
  }));

  const tableAt = head.length, dataAt = tableAt + blocks * 8;
  const total = dataAt + chunks.reduce((s, c) => s + 8 + c.length, 0);
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  out.set(head);
  let at = dataAt;
  chunks.forEach((c, b) => {
    dv.setBigUint64(tableAt + b * 8, BigInt(at), true);
    dv.setInt32(at, b * ZIP_LINES, true);
    dv.setInt32(at + 4, c.length, true);
    out.set(c, at + 8);
    at += 8 + c.length;
  });
  return out;
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(d: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP archive (stored, not compressed again) of files added one by one; over 4 GB or 65535 files it can't be made. */
export class ZipWriter {
  private parts: BlobPart[] = [];
  private central: Uint8Array[] = [];
  private offset = 0;
  private count = 0;

  add(path: string, data: Uint8Array) {
    const name = new TextEncoder().encode(path), crc = crc32(data);
    if (this.count >= 0xffff || this.offset + data.length + name.length + 30 > 0xffffffff) throw new Error('more than 4 GB or 65535 files: too much for a zip (try a browser that can save into a folder, like desktop Chrome)');
    const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(8, 0, true);
    l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true);
    l.setUint16(26, name.length, true); local.set(name, 30);
    const cen = new Uint8Array(46 + name.length), c = new DataView(cen.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, this.offset, true); cen.set(name, 46);
    this.parts.push(local, data as Uint8Array<ArrayBuffer>);
    this.central.push(cen);
    this.offset += local.length + data.length;
    this.count++;
  }

  finish(): Blob {
    const size = this.central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, this.count, true); e.setUint16(10, this.count, true);
    e.setUint32(12, size, true); e.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...(this.central as Uint8Array<ArrayBuffer>[]), end], { type: 'application/zip' });
  }
}
