# Writes the bubble demo scenes (python3 lab/make-bubble-scenes.py): where the bubble hunt got to.
import json

def disk(cx, cy, r, vals):
    return [{'chem': c, 'op': 'overwrite', 'fill': {'type': 'constant', 'value': v}, 'shape': {'type': 'circle', 'cx': cx, 'cy': cy, 'r': r}} for c, v in vals]

def write(fname, sc):
    json.dump(sc, open(f'scenes/{fname}', 'w'), indent=1)
    print('wrote', fname)

# docking rings: plain Gray-Scott at the edge of its ring regime (F 0.058, k just under 0.0645). Each stamped disk hollows
# into a round membrane; where two meet they flatten against each other, keeping a gap, and never merge
DOCK = [(0.3, 0.3, 0.08), (0.62, 0.28, 0.075), (0.68, 0.64, 0.085), (0.32, 0.66, 0.08)]
write('bubbles-docking.json', {
    'name': 'Gray-Scott: docking bubbles',
    'description': 'Where the bubble hunt got to, part 1: what works. Plain Gray-Scott at the edge of its ring regime (F 0.058, '
                   'k 0.0645): each stamped disk hollows into a round membrane round an empty inside, and where two meet they '
                   'press flat against each other, keeping a gap, and never merge: docking for free. What it lacks is a '
                   'size: the rings keep growing (slowing as they go), so by 60k steps the four have pressed into a foam of '
                   'squarish cells, and later they buckle; k a hair higher (0.0646) kills them instead. Stamp more with the '
                   'Seed brush: a filled disk of radius 18 or more (smaller ones, and thin rings, open into rods).',
    'rule': 'builtin:0', 'size': 256, 'start': 'initial', 'stepsPerFrame': 20,
    'globals': {'F': 0.058, 'k': 0.0645},
    'initial': [{'chem': 'a', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'everywhere'}}]
               + [o for cx, cy, r in DOCK for o in disk(cx, cy, r, [('a', 0.5), ('b', 0.25)])],
    'view': {'reagent': 'b', 'low': 0, 'high': 0.4},
})

# content-regulated bubbles: the Gray-Scott Bubbles rule (builtin:18), as it stands (work in progress)
BUB = [(0.27, 0.27, 0.05, 1), (0.7, 0.27, 0.05, 4), (0.27, 0.7, 0.06, 2), (0.7, 0.7, 0.04, 8)]
write('bubbles-content.json', {
    'name': 'Gray-Scott Bubbles: content (work in progress)',
    'description': 'Where the bubble hunt got to, part 2: size regulation, not working yet. Each bubble holds content m '
                   '(the tint), held in by its membrane; its pressure over a target pushes the membrane out, so a bubble '
                   'should settle at a size set by its content (here 1, 4, 2 and 8 x the target, so 1, 2, 1.4 and 2.8 x its '
                   'starting radius). What happens: within 5k steps most membranes open into rods (one into a three-armed '
                   'star), and by 20k the field fills with stripes; the content leaks too (its total doubles over 60k '
                   'steps, where it should stay fixed).',
    'rule': 'builtin:18', 'size': 256, 'start': 'initial', 'stepsPerFrame': 20,
    'globals': {},
    'initial': [{'chem': 'a', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'everywhere'}}]
               + [o for cx, cy, r, m in BUB for o in disk(cx, cy, r, [('a', 0.5), ('b', 0.25), ('m', m)])],
    'view': {'reagent': 'b', 'low': 0, 'high': 0.4, 'tint': 'm'},
})

# phase-field bubbles 2 (builtin:19, Phase-field Bubbles 2: three kinds): each a disk of phase phiK = 1 with content mK
def pf(cx, cy, r, m, k):
    return disk(cx, cy, r, [(f'phi{k + 1}', 1), (f'm{k + 1}', m)])

# a loose foam: scattered (lab/foam-layout.py 256 14 52 1), coloured so near neighbours differ in kind
FOAM = [[179, 212, 0], [107, 41, 1], [53, 128, 1], [107, 201, 1], [250, 57, 2], [114, 131, 2], [230, 164, 2], [40, 236, 2],
        [194, 52, 0], [221, 105, 1], [158, 12, 2], [230, 227, 1], [56, 54, 0], [57, 181, 0]]
write('pf-bubbles-foam.json', {
    'name': 'Phase-field Bubbles 2: foam',
    'description': 'Fourteen bubbles of three kinds (red, green, blue: phi1-3), each stamped with content 7, swell until they '
                   'press against their neighbours into a loose foam of rounded polygons. The edges move by their own curvature, '
                   'so they stay smooth instead of buckling. Different kinds dock and never merge; two of the same kind that '
                   'meet do merge (one pair does here, by 40k steps). Content is conserved exactly.',
    'rule': 'builtin:19', 'size': 256, 'start': 'initial', 'stepsPerFrame': 40,
    'globals': {},
    'initial': [o for x, y, k in FOAM for o in pf(x / 256, y / 256, 16 / 256, 7, k)],
})

# size from content: same-size stamps, different content, and a docked pair
write('pf-bubbles-sizes.json', {
    'name': 'Phase-field Bubbles 2: size from content',
    'description': 'Each bubble grows until its content is diluted to near target, so its size follows its content. Top: '
                   'three stamps of the same size with content 2.5, 5 and 10 (left to right) settle at radius about 15, 22 and '
                   '35 (about the square root of the content). Below them, two of different kinds start close, grow into each '
                   'other and dock, a flat wall between them. Too little content (1.5 here) and surface tension wins: the '
                   'bubble shrinks away, as the bottom-right one does.',
    'rule': 'builtin:19', 'size': 256, 'start': 'initial', 'stepsPerFrame': 40,
    'globals': {},
    'initial': pf(0.16, 0.22, 0.055, 2.5, 0) + pf(0.42, 0.22, 0.055, 5, 1) + pf(0.78, 0.25, 0.055, 10, 2)
               + pf(0.3, 0.7, 0.07, 4, 0) + pf(0.52, 0.7, 0.07, 4, 2) + pf(0.82, 0.78, 0.055, 1.5, 1),
})

# the one-phase version (builtin:20, Phase-field Bubbles 1), kept to compare: lone bubbles settle at a size, a pair merges
def pf1(cx, cy, r, m):
    return disk(cx, cy, r, [('phi', 1), ('m', m)])
write('pf1-bubbles.json', {
    'name': 'Phase-field Bubbles 1: one phase',
    'description': 'The first phase-field version, kept to compare with version 2. Three lone bubbles (content 3, 6 and 12 '
                   'from equal stamps) settle at sizes their content sets and stay round. The two at the bottom start close: '
                   'with one phase for every bubble they merge into one oval when they meet, which is why version 2 has three '
                   'kinds. View: the membrane, tinted by content.',
    'rule': 'builtin:20', 'size': 256, 'start': 'initial', 'stepsPerFrame': 40,
    'globals': {},
    'initial': pf1(0.18, 0.22, 0.055, 3) + pf1(0.48, 0.22, 0.055, 6) + pf1(0.8, 0.28, 0.055, 12)
               + pf1(0.3, 0.72, 0.07, 4) + pf1(0.52, 0.72, 0.07, 4),
})
