#!/usr/bin/env python3
"""Dan's Ready collection as rdui rule families, from the vtipack built in the
Enki project (~/dev/shaderEditor/vtipack, see its HANDOFF.md; only read here).

Each family is one rule (a representative file's header, which rdui's Ready
importer reads) and its presets: every file's parameters and view, its seed
kind and a small thumbnail. Formula rules only (rdui can't run Ready's OpenCL
kernels). Writes:
  public/vti/families/index.json   the families (and Dan's curated packs)
  public/vti/families/<id>.json    one family's header and presets
  public/vti/thumbs/<md5>.webp     thumbnails (the warmed-up frame), 96 px
  public/vti/seeds/<md5>.bin       each start seed, repacked for the browser (src/seeds.ts):
                                   u32 header length, the header JSON (kind, names, means, the
                                   small parts, and where each array is), the arrays; gzipped.
                                   ~120 MB, mostly 8/16-bit state copies: not in git (rerun this)
(public/, so they're fetched when wanted, not bundled: src/collection.ts)

  python3 lab/vtipack-import.py [VTIPACK]
"""
import gzip, json, lzma, os, re, struct, sys
import numpy as np
from PIL import Image

PACK = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/dev/shaderEditor/vtipack')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'vti', 'families')
THUMBS = os.path.join(ROOT, 'public', 'vti', 'thumbs')
os.makedirs(OUT, exist_ok=True)
SEEDS = os.path.join(ROOT, 'public', 'vti', 'seeds')
os.makedirs(THUMBS, exist_ok=True)
os.makedirs(SEEDS, exist_ok=True)
sys.path.insert(0, os.path.expanduser('~/dev/shaderEditor/ShaderEditor/tools/ready'))
import vtiseed  # noqa: E402  (Dan's seed format: decode only)

GROWABLE = {'synthetic', 'patch', 'patches4', 'patch_on_rest', 'patch_on_synth', 'q8', 'q16', 'exact'}


def seed_file(md5):
    """The stored seed as public/vti/seeds/<md5>.bin; False if there's none to grow."""
    dst = os.path.join(SEEDS, md5 + '.bin')
    if os.path.exists(dst):
        return True
    src = os.path.join(PACK, 'states', md5 + '.seed')
    if not os.path.exists(src):
        return False
    kind, rec = vtiseed.decode(open(src, 'rb').read())
    if kind not in GROWABLE:
        return False
    head = {'kind': kind, 'arrays': {}}
    blobs, off = [], 0

    def add(name, a):
        nonlocal off
        a = np.ascontiguousarray(a)
        dt = {'uint8': 'u8', 'uint16': 'u16', 'float32': 'f32', 'float64': 'f32'}[str(a.dtype)]
        b = (a.astype('<f4') if dt == 'f32' else a.astype('<u2') if dt == 'u16' else a).tobytes()
        head['arrays'][name] = {'type': dt, 'shape': list(a.shape), 'offset': off}
        blobs.append(b + b'\0' * (-len(b) % 4))
        off += len(blobs[-1])

    for k, v in rec.items():
        if k in ('patches', 'state'):
            codes, lo, hi = v
            add(k, codes)
            head[k + '_lo'], head[k + '_hi'] = np.asarray(lo, 'f8').tolist(), np.asarray(hi, 'f8').tolist()
        elif isinstance(v, np.ndarray):
            if v.size <= 64:
                head[k] = v.astype('f8').tolist()
            else:
                add(k, v)
        else:
            head[k] = v
    hj = json.dumps(head, separators=(',', ':')).encode()
    hj += b' ' * (-len(hj) % 4)
    with gzip.open(dst, 'wb', compresslevel=9) as f:
        f.write(struct.pack('<I', len(hj)) + hj + b''.join(blobs))
    return True


index = json.load(open(os.path.join(PACK, 'index.json')))
headers = json.load(lzma.open(os.path.join(PACK, 'headers.json.xz')))
packs = json.load(open(os.path.join(PACK, 'packs.json')))


def attr(xml, tag):
    m = re.search(rf'<{tag}\s+value="([^"]*)"', xml)
    return m.group(1) if m else None


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def state_info(md5):
    p = os.path.join(PACK, 'states', md5 + '.json')
    return json.load(open(p)) if os.path.exists(p) else {}


def closed(header, grid):
    """The stored headers stop after </RD> (the state was cut off): close the document, with the grid size."""
    w, h = grid or (256, 256)
    head = header[:header.index('</RD>') + 5] if '</RD>' in header else header
    return f'{head}\n  <ImageData WholeExtent="0 {w - 1} 0 {h - 1} 0 0"></ImageData>\n</VTKFile>\n'


def thumb(md5):
    for which in ('warm_1200', 'start_0'):
        src = os.path.join(PACK, 'thumbs', f'{md5}_{which}.jpg')
        if os.path.exists(src):
            dst = os.path.join(THUMBS, md5 + '.webp')
            if not os.path.exists(dst):
                im = Image.open(src).convert('RGB')
                im.thumbnail((96, 96), Image.LANCZOS)
                im.save(dst, 'WEBP', quality=72, method=6)
            return True
    return False


def stem(path):
    return os.path.basename(path)[:-4] if path.endswith('.vti') else os.path.basename(path)


def label_of(presets, rep):
    """What the presets' names share (to a word boundary), else the representative's name."""
    names = [p['name'] for p in presets]
    pre = os.path.commonprefix(names)
    cut = max(pre.rfind('_'), pre.rfind('-'))
    pre = (pre[:cut] if cut > 3 else pre).strip('-_')
    return pre if len(pre) >= 6 else rep['name']


families, where = [], {}
for fam in index['families']:
    if fam['type'] != 'formula':
        continue
    files = [f for f in fam['files'] if f['md5'] in headers]
    if not files:
        continue
    variant_of = {p: i for i, v in enumerate(fam.get('variants', [])) for p in v}
    presets = []
    for f in files:
        h = headers[f['md5']]
        st = state_info(f['md5'])
        presets.append({
            'name': stem(f['path']),
            'path': f['path'],
            'md5': f['md5'],
            'params': {k: num(v) for k, v in f['params'].items() if num(v) is not None},
            'variant': variant_of.get(f['path']),
            'view': {k: v for k, v in {
                'reagent': attr(h, 'active_chemical'),
                'low': num(attr(h, 'low')),
                'high': num(attr(h, 'high')),
                'stepsPerFrame': num(attr(h, 'timesteps_per_render')),
            }.items() if v is not None},
            'seed': st.get('kind') if st.get('kind') in GROWABLE and seed_file(f['md5']) else None,
            'grid': st.get('grid'),
            'thumb': thumb(f['md5']),
        })
        where[f['path']] = (fam['id'], f['md5'])
    # the representative: the file whose parameters are nearest the family's median
    names = sorted({k for p in presets for k in p['params']})
    med = {k: sorted(p['params'][k] for p in presets if k in p['params'])[len([p for p in presets if k in p['params']]) // 2] for k in names}
    span = {k: (max(p['params'].get(k, med[k]) for p in presets) - min(p['params'].get(k, med[k]) for p in presets)) or 1 for k in names}
    rep = min(presets, key=lambda p: sum(abs(p['params'].get(k, med[k]) - med[k]) / span[k] for k in names))
    name = fam['names'][0]
    out = {'id': fam['id'], 'name': name, 'chemicals': fam['chemicals'], 'header': closed(headers[rep['md5']], rep['grid']), 'representative': rep['md5'], 'presets': presets}
    json.dump(out, open(os.path.join(OUT, fam['id'] + '.json'), 'w'), separators=(',', ':'))
    families.append({'id': fam['id'], 'name': name, 'label': label_of(presets, rep), 'chemicals': fam['chemicals'], 'count': len(presets),
                     'thumb': rep['md5'] if rep['thumb'] else next((p['md5'] for p in presets if p['thumb']), None)})

# Dan's curated packs, as (family, md5) members
out_packs = []
for p in packs:
    members = [where[x] for x in p.get('paths', []) if x in where]
    if members:
        out_packs.append({'id': p['id'], 'title': p['title'], 'description': p.get('description', ''), 'members': members})

families.sort(key=lambda f: -f['count'])
json.dump({'source': 'vtipack (~/dev/shaderEditor/vtipack)', 'families': families, 'packs': out_packs},
          open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
n = sum(f['count'] for f in families)
print(f'{len(families)} families, {n} presets, {len(out_packs)} packs; thumbs {len(os.listdir(THUMBS))}')
