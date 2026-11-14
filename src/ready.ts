/**
 * Import Ready (https://github.com/GollyGang/ready) .vti patterns that use a
 * "formula" rule: parameters, formula, initial-pattern generator, render
 * settings and (when the pattern doesn't regenerate on load) the stored image.
 *
 * Ready's y axis points up; rdui's points down, so shapes and images are flipped.
 */

import { guessRange, MAX_REAGENTS, type Overlay, type RuleDef, type Shape, type Fill } from './rule';

export interface ReadyImport {
  rule: RuleDef;
  /** Starting state per reagent (y-down rows) when the file asks not to regenerate. */
  image?: Float32Array[];
  warnings: string[];
}

const CHEM_NAMES = 'abcdefghijklmnopqrstuvwxyz'.split('');

const num = (el: Element | null | undefined, attr: string, fallback = 0) => {
  const v = el?.getAttribute(attr);
  return v === null || v === undefined ? fallback : Number(v);
};

const childElements = (el: Element) => Array.from(el.children);

export async function importReady(text: string, fileName: string): Promise<ReadyImport> {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('not valid XML');
  const rd = doc.querySelector('RD');
  const ruleEl = rd?.querySelector('rule');
  if (!rd || !ruleEl) throw new Error('no <RD><rule> found — is this a Ready pattern?');
  const warnings: string[] = [];

  const type = ruleEl.getAttribute('type');
  if (type !== 'formula') throw new Error(`only "formula" rules can be imported (this one is "${type}")`);
  const nType = ruleEl.getAttribute('neighborhood_type');
  if (nType && (nType !== 'vertex' || num(ruleEl, 'neighborhood_range', 1) !== 1)) {
    warnings.push(`neighbourhood ${nType}/${ruleEl.getAttribute('neighborhood_range')} approximated by the 9-point stencil`);
  }
  const acc = ruleEl.getAttribute('accuracy');
  if (acc && acc !== 'medium') warnings.push(`accuracy "${acc}" approximated by the 9-point (medium) stencil`);

  const formulaEl = ruleEl.querySelector('formula');
  if (!formulaEl) throw new Error('rule has no <formula>');
  const nChems = num(formulaEl, 'number_of_chemicals', 2);
  if (nChems > MAX_REAGENTS) throw new Error(`${nChems} chemicals — rdui supports at most ${MAX_REAGENTS}`);
  const reagents = CHEM_NAMES.slice(0, nChems);

  const params = Array.from(ruleEl.querySelectorAll(':scope > param')).map((p) => {
    const name = p.getAttribute('name')!;
    const value = Number(p.textContent!.trim());
    const [min, max] = name === 'F' ? [0, 0.1] : name === 'k' ? [0.03, 0.075] : guessRange(value);
    return { name, value, min: Math.min(min, value), max: Math.max(max, value) };
  });

  // --- extents
  const imageEl = doc.querySelector('ImageData');
  const ext = (imageEl?.getAttribute('WholeExtent') ?? '0 255 0 255 0 0').split(/\s+/).map(Number);
  const width = ext[1] - ext[0] + 1;
  const height = ext[3] - ext[2] + 1;
  if (ext[5] - ext[4] > 0) throw new Error('3D patterns are not supported');

  // --- initial pattern generator
  const gen = rd.querySelector('initial_pattern_generator');
  const initial: Overlay[] = [];
  for (const ov of gen ? Array.from(gen.querySelectorAll(':scope > overlay')) : []) {
    const chem = ov.getAttribute('chemical') ?? 'a';
    let op: Overlay['op'] = 'overwrite';
    let fill: Fill | null = null;
    const shapes: Shape[] = [];
    for (const c of childElements(ov)) {
      switch (c.tagName) {
        case 'overwrite': case 'add': case 'subtract': case 'multiply':
          op = c.tagName;
          break;
        case 'constant':
          fill = { type: 'constant', value: num(c, 'value') };
          break;
        case 'white_noise':
          fill = { type: 'white_noise', low: num(c, 'low'), high: num(c, 'high', 1) };
          break;
        case 'everywhere':
          shapes.push({ type: 'everywhere' });
          break;
        case 'rectangle': {
          const [a, b] = Array.from(c.querySelectorAll('point3D'));
          shapes.push({ type: 'rectangle', x0: num(a, 'x'), y0: 1 - num(a, 'y'), x1: num(b, 'x'), y1: 1 - num(b, 'y') });
          break;
        }
        case 'circle': {
          const p = c.querySelector('point3D');
          shapes.push({ type: 'circle', cx: num(p, 'x', 0.5), cy: 1 - num(p, 'y', 0.5), r: num(c, 'radius', 0.1) });
          break;
        }
        default:
          warnings.push(`overlay element <${c.tagName}> not supported, skipped`);
      }
    }
    if (!fill) continue;
    for (const shape of shapes) initial.push({ chem, op, fill, shape });
  }

  // --- rest / seed heuristics from the generator
  const mid = (f: Fill) => (f.type === 'white_noise' ? (f.low + f.high) / 2 : f.type === 'packet' ? 0 : f.value);
  const rest = reagents.map((r) => {
    const o = [...initial].reverse().find((o) => o.chem === r && o.shape.type === 'everywhere' && o.op === 'overwrite');
    return o ? mid(o.fill) : 0;
  });
  const seed: (number | null)[] = reagents.map((r) => {
    const o = initial.find((o) => o.chem === r && o.shape.type !== 'everywhere');
    return o ? mid(o.fill) : null;
  });
  const seedNoise = reagents.map((r) => {
    const o = initial.find((o) => o.chem === r && o.shape.type !== 'everywhere');
    return o && o.fill.type === 'white_noise' ? o.fill.high - o.fill.low : 0;
  });
  if (!seed.some((v) => v !== null) && reagents.length >= 2) {
    seed[1] = 0.25;
    seedNoise[1] = 0.25;
  }

  // --- render settings
  const rs = rd.querySelector('render_settings');
  const rv = (tag: string) => rs?.querySelector(tag)?.getAttribute('value');
  const active = rv('active_chemical') ?? reagents[Math.min(1, reagents.length - 1)];

  const names = new Set(params.map((p) => p.name));
  const paintable = ['F', 'k', 'c_damp'].filter((n) => names.has(n));

  const rule: RuleDef = {
    name: ruleEl.getAttribute('name') ?? fileName,
    description: (rd.querySelector('description')?.textContent ?? '').trim(),
    reagents,
    params,
    paintable,
    formula: formulaEl.textContent ?? '',
    rest,
    seed,
    seedNoise,
    initial,
    view: {
      reagent: reagents.includes(active) ? active : reagents[0],
      low: Number(rv('low') ?? 0),
      high: Number(rv('high') ?? 1),
      stepsPerFrame: Math.min(200, Math.max(1, Math.round(Number(rv('timesteps_per_render') ?? 20)))),
    },
    size: { width, height },
    source: fileName,
  };

  let image: Float32Array[] | undefined;
  if (gen?.getAttribute('apply_when_loading') !== 'true') {
    try {
      image = await readImage(doc, reagents, width, height);
    } catch (e) {
      warnings.push(`couldn't read stored image (${(e as Error).message}); using the initial pattern generator`);
    }
  }
  return { rule, image, warnings };
}

// --- VTK XML binary data

function b64(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function inflate(data: Uint8Array) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decodeDataArray(text: string, compressed: boolean, header64: boolean) {
  const s = text.replace(/\s+/g, '');
  const hb = header64 ? 8 : 4;
  const readUint = (bytes: Uint8Array, i: number) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    return header64 ? Number(dv.getBigUint64(i * 8, true)) : dv.getUint32(i * 4, true);
  };
  if (!compressed) {
    const all = b64(s);
    const n = readUint(all, 0);
    return all.slice(hb, hb + n);
  }
  // Compressed: base64(header) followed by base64(blocks), encoded separately.
  const first = b64(s.slice(0, Math.ceil((hb * 3) / 3) * 4 + 4));
  const nBlocks = readUint(first, 0);
  const headerBytes = hb * (3 + nBlocks);
  const headerChars = Math.ceil(headerBytes / 3) * 4;
  const header = b64(s.slice(0, headerChars));
  const blocks = b64(s.slice(headerChars));
  const parts: Uint8Array[] = [];
  let off = 0;
  for (let i = 0; i < nBlocks; i++) {
    const size = readUint(header, 3 + i);
    parts.push(await inflate(blocks.subarray(off, off + size)));
    off += size;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function readImage(doc: Document, reagents: string[], w: number, h: number) {
  const vtk = doc.querySelector('VTKFile');
  const compressed = !!vtk?.getAttribute('compressor');
  const header64 = vtk?.getAttribute('header_type') === 'UInt64';
  const out: Float32Array[] = [];
  for (const r of reagents) {
    const da = Array.from(doc.querySelectorAll('PointData > DataArray, CellData > DataArray')).find((d) => d.getAttribute('Name') === r);
    if (!da) throw new Error(`no data for "${r}"`);
    if (da.getAttribute('format') !== 'binary' || da.getAttribute('type') !== 'Float32') throw new Error('only binary Float32 arrays are supported');
    const bytes = await decodeDataArray(da.textContent ?? '', compressed, header64);
    const src = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    if (src.length !== w * h) throw new Error(`"${r}" has ${src.length} values, expected ${w * h}`);
    const flipped = new Float32Array(w * h);
    for (let y = 0; y < h; y++) flipped.set(src.subarray((h - 1 - y) * w, (h - y) * w), y * w);
    out.push(flipped);
  }
  return out;
}

// --- bundled patterns

const bundled = import.meta.glob('../patterns/ready/*.vti', { query: '?raw', import: 'default' });

export const BUNDLED_PATTERNS = Object.keys(bundled)
  .map((path) => ({ path, name: path.split('/').pop()!.replace(/\.vti$/, '') }))
  .sort((a, b) => a.name.localeCompare(b.name));

export async function loadBundled(name: string) {
  const p = BUNDLED_PATTERNS.find((b) => b.name === name);
  if (!p) throw new Error(`no bundled pattern ${name}`);
  const text = (await bundled[p.path]()) as string;
  return importReady(text, `${name}.vti`);
}
