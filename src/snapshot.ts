/**
 * Whole-field snapshot file (.rdui):
 *   "RDUI" | u32 version | u32 headerBytes | header JSON (utf-8, padded to 4) |
 *   params f32[w*h*4] | state f32[w*h*2]
 */

import type { Rect } from './probes';

const MAGIC = 0x49554452; // "RDUI" little-endian
const VERSION = 1;

export interface SnapshotHeader {
  width: number;
  height: number;
  probes: (Rect & { name: string })[];
}

export interface Snapshot {
  header: SnapshotHeader;
  params: Float32Array;
  state: Float32Array;
}

export function encodeSnapshot(snap: Snapshot): Blob {
  const json = new TextEncoder().encode(JSON.stringify(snap.header));
  const padded = Math.ceil(json.length / 4) * 4;
  const head = new ArrayBuffer(12 + padded);
  const dv = new DataView(head);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, VERSION, true);
  dv.setUint32(8, padded, true);
  new Uint8Array(head, 12).set(json);
  new Uint8Array(head, 12 + json.length).fill(0x20); // pad with spaces so JSON.parse still works
  return new Blob([head, snap.params as Float32Array<ArrayBuffer>, snap.state as Float32Array<ArrayBuffer>], { type: 'application/octet-stream' });
}

export function decodeSnapshot(buf: ArrayBuffer): Snapshot {
  const dv = new DataView(buf);
  if (buf.byteLength < 12 || dv.getUint32(0, true) !== MAGIC) throw new Error('not an rdui snapshot');
  const version = dv.getUint32(4, true);
  if (version !== VERSION) throw new Error(`unsupported snapshot version ${version}`);
  const hb = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hb))) as SnapshotHeader;
  const cells = header.width * header.height;
  const off = 12 + hb;
  if (buf.byteLength !== off + cells * 24) throw new Error('snapshot is truncated or corrupt');
  return {
    header,
    params: new Float32Array(buf, off, cells * 4),
    state: new Float32Array(buf, off + cells * 16, cells * 2),
  };
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
