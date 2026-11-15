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
(public/, so they're fetched when wanted, not bundled: src/collection.ts)

  python3 lab/vtipack-import.py [VTIPACK]
"""
import json, lzma, os, re, sys
from PIL import Image

PACK = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/dev/shaderEditor/vtipack')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'vti', 'families')
THUMBS = os.path.join(ROOT, 'public', 'vti', 'thumbs')
os.makedirs(OUT, exist_ok=True)
os.makedirs(THUMBS, exist_ok=True)

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
            'seed': st.get('kind'),
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
