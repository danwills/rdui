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

# a mixed foam (version 2 of the foam scene): 3 big, 6 medium, 14 small bubbles (expected settled radius 44, 28, 17), from
# lab/foam-layout-sizes.py 256 3 22 44:3 28:6 17:14 (biggest placed first; coloured so any two within 22 cells of
# meeting differ). Each stamp is 0.6 x that radius with content 6.5 (not 4: everything about 1.25 x larger, so most
# press into each other), so content follows stamp area
FOAM2 = [[104, 93, 44.0, 1], [202, 18, 44.0, 1], [114, 248, 44.0, 2], [228, 220, 28.0, 2], [57, 227, 28.0, 0], [31, 92, 28.0, 2], [141, 138, 28.0, 0], [39, 175, 28.0, 1], [59, 50, 28.0, 0], [63, 124, 17.0, 0], [3, 29, 17.0, 2], [246, 149, 17.0, 2], [174, 199, 17.0, 0], [248, 1, 17.0, 0], [208, 97, 17.0, 2], [212, 127, 17.0, 0], [93, 158, 17.0, 2], [139, 197, 17.0, 1], [237, 67, 17.0, 0], [196, 176, 17.0, 1], [174, 160, 17.0, 2], [34, 3, 17.0, 1], [154, 29, 17.0, 0]]
write('pf-bubbles-foam-2.json', {
    'name': 'Phase-field Bubbles 2: mixed foam',
    'description': 'A foam of mixed sizes: three big bubbles, six medium and fourteen small, from stamps of different sizes '
                   'with the same content concentration, so the settled size follows the stamp. They swell until most press '
                   'into each other, a foam of rounded polygons; different kinds dock, and the colouring keeps any two that will meet different kinds.',
    'rule': 'builtin:19', 'size': 256, 'start': 'initial', 'stepsPerFrame': 40,
    'globals': {},
    'initial': [o for x, y, R, k in FOAM2 for o in pf(x / 256, y / 256, 0.6 * R / 256, 6.5, k)],
})

# Phase-field Bubbles 3 (builtin:21): one phase, islands stay islands. The mixed foam's layout (kinds unused), content
# 5 (about 1.7 x the stamp radius each, as the mixed foam's)
def pf3(cx, cy, r, m):
    return disk(cx, cy, r, [('phi', 1), ('m', m)])
FOAM3 = [[104, 93, 44.0, 1], [202, 18, 44.0, 1], [114, 248, 44.0, 2], [228, 220, 28.0, 2], [57, 227, 28.0, 0], [31, 92, 28.0, 2], [141, 138, 28.0, 0], [39, 175, 28.0, 1], [59, 50, 28.0, 0], [63, 124, 17.0, 0], [3, 29, 17.0, 2], [246, 149, 17.0, 2], [174, 199, 17.0, 0], [248, 1, 17.0, 0], [208, 97, 17.0, 2], [212, 127, 17.0, 0], [93, 158, 17.0, 2], [139, 197, 17.0, 1], [237, 67, 17.0, 0], [196, 176, 17.0, 1], [174, 160, 17.0, 2], [34, 3, 17.0, 1], [154, 29, 17.0, 0]]
write('pf3-bubbles-foam.json', {
    'name': 'Phase-field Bubbles 3: mixed foam',
    'description': 'One phase for every bubble; where edges face each other the gap between them is drained, so they dock '
                   'along flat walls. Work in progress: 23 bubbles end up as about 11, as some still merge while growing fast '
                   'into each other. Big, medium and small bubbles from stamps of '
                   'different sizes (the same content concentration, so size follows stamp). Try cutting one in two with '
                   'Erase: the halves round up and stay two, docked like a dividing cell.',
    'rule': 'builtin:21', 'size': 256, 'start': 'initial', 'stepsPerFrame': 40,
    'globals': {},
    'initial': [o for x, y, R, k in FOAM3 for o in pf3(x / 256, y / 256, 0.6 * R / 256, 5)],
})

# Phase-field Bubbles 4 (builtin:22): substrate keeps islands apart. The mixed foam's layout again (FOAM3), content 5
# (at 8, crammed, pressure beats the starving and 23 merge into 6)
def pf4(cx, cy, r, m):
    return disk(cx, cy, r, [('phi', 1), ('m', m)])
write('pf4-bubbles-foam.json', {
    'name': 'Phase-field Bubbles 4: mixed foam',
    'description': 'Big, medium and small bubbles from stamps of different sizes (the same content concentration, so size '
                   'follows stamp: area in proportion to content). Bubbles eat a substrate fed in from outside and an edge '
                   'needs it to advance, so between two neighbours, where it\'s eaten from both sides, both edges hold back: '
                   'they keep a gap (23 stamped, 22 left at 40k steps). Try cutting one in two with Erase: the halves round up '
                   'and stay two. Work in progress: crammed tighter (more content), pressure beats the starving and they '
                   'merge. View u to see the substrate.',
    'rule': 'builtin:22', 'size': 256, 'start': 'initial', 'stepsPerFrame': 40,
    'globals': {},
    'initial': [{'chem': 'u', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'everywhere'}}]
               + [o for x, y, R, k in FOAM3 for o in pf4(x / 256, y / 256, 0.6 * R / 256, 5)],
})

# Phase-field Bubbles 5 (builtin:23): pressure needs substrate too, so they can be crammed. The mixed layout (FOAM3),
# content 12: pressed into a foam with thin walls (23 stay 23 at content 8, 22 at 12)
write('pf5-bubbles-foam.json', {
    'name': 'Phase-field Bubbles 5: pressed foam',
    'description': 'Big, medium and small bubbles crammed with content until they press into a foam of polygons with thin '
                   'walls between them, and still they keep apart (22 of the 23 at 40k steps): an edge needs substrate to be pushed out, and between two '
                   'neighbours the substrate is eaten from both sides. Size follows content (area in proportion). Cut one in '
                   'two with Erase and the halves stay two (a hard cut can leave a speck or two from its corners). View u '
                   'to see the substrate.',
    'rule': 'builtin:23', 'size': 256, 'start': 'initial', 'stepsPerFrame': 40,
    'globals': {},
    'initial': [{'chem': 'u', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'everywhere'}}]
               + [o for x, y, R, k in FOAM3 for o in pf4(x / 256, y / 256, 0.6 * R / 256, 12)],
})

# Phase-field Bubbles 6 (builtin:24): a lava lamp. One wall band along the top row (the field wraps, so it's the floor too),
# a heater band just above it at the bottom (warmth +1), a cooler band below it at the top (warmth -1); bubbles start
# neutral, three in the heater and three mid-way
LAVA = [(0.15, 0.92, 0.06), (0.45, 0.92, 0.06), (0.75, 0.92, 0.07), (0.3, 0.55, 0.05), (0.6, 0.5, 0.06), (0.88, 0.6, 0.05)]
write('pf6-lava-lamp.json', {
    'name': 'Phase-field Bubbles 6: lava lamp',
    'description': 'Warm bubbles rise and cool ones sink. A heater along the bottom warms any bubble there, a cooler along the '
                   'top cools it, and heat leaks away slowly between: bubbles rise from the heater, cool at the top, sink, warm '
                   'and rise again, bumping rather than merging. Work in progress: they rise (slowly: tens of thousands of '
                   'steps), deforming into cups and leaving faint trails. Tint shows temperature (blue cold, orange warm). Paint warmth '
                   'to move the heater or cooler, or make a warm patch mid-way; gx, gy turn gravity.',
    'rule': 'builtin:24', 'size': 256, 'start': 'initial', 'stepsPerFrame': 40,
    'globals': {},
    'walls': [[0, 0, 256, 4]],
    'initial': [{'chem': 'u', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'everywhere'}},
                {'chem': 'warmth', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'rectangle', 'x0': 0, 'y0': 0.86, 'x1': 1, 'y1': 1}},
                {'chem': 'warmth', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': -1}, 'shape': {'type': 'rectangle', 'x0': 0, 'y0': 0.016, 'x1': 1, 'y1': 0.15}}]
               + [o for cx, cy, r in LAVA for o in pf4(cx, cy, r, 6)],
    'view': {'reagent': 'phi', 'low': 0, 'high': 1, 'tint': 'T', 'tintLow': -1, 'tintHigh': 1},
})

# the lava lamp, slow (version 6 still): a bubble only keeps its content and shape below about 0.015 of edge tilt (T 0.05 at
# buoy 0.3 holds, round, area steady; T 0.15 leaves its content behind in a wake and shrinks away), so buoy 0.02 caps a
# fully warm bubble there; heating and leak about 100 x slower to match; 200 steps a frame
write('pf6-lava-lamp-slow.json', {
    'name': 'Phase-field Bubbles 6: lava lamp (slow)',
    'description': 'The lava lamp, slowed until bubbles hold together: warm ones rise from the heater along the bottom, cool '
                   'at the top, and sink to warm again, staying round and keeping their size. Faster than this and a moving '
                   'bubble leaves its content behind in a wake and shrinks away. Tint shows temperature. Paint warmth to move '
                   'the heater or cooler; gx, gy turn gravity.',
    'rule': 'builtin:24', 'size': 256, 'start': 'initial', 'stepsPerFrame': 200,
    'globals': {'buoy': 0.02, 'heat': 0.00003, 'T_leak': 0.000003},
    'walls': [[0, 0, 256, 4]],
    'initial': [{'chem': 'u', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'everywhere'}},
                {'chem': 'warmth', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'rectangle', 'x0': 0, 'y0': 0.86, 'x1': 1, 'y1': 1}},
                {'chem': 'warmth', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': -1}, 'shape': {'type': 'rectangle', 'x0': 0, 'y0': 0.016, 'x1': 1, 'y1': 0.15}}]
               + [o for cx, cy, r in LAVA for o in pf4(cx, cy, r, 6)],
    'view': {'reagent': 'phi', 'low': 0, 'high': 1, 'tint': 'T', 'tintLow': -1, 'tintHigh': 1},
})
