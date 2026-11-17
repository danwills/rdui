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

# content-regulated bubbles: the uncommitted Gray-Scott Bubbles rule (builtin:18), as it stands
BUB = [(0.27, 0.27, 0.05, 1), (0.7, 0.27, 0.05, 4), (0.27, 0.7, 0.06, 2), (0.7, 0.7, 0.04, 8)]
write('bubbles-content.json', {
    'name': 'Gray-Scott Bubbles: content (work in progress)',
    'description': 'Where the bubble hunt got to, part 2: size regulation, not working yet. Each bubble holds content m '
                   '(the tint), held in by its membrane; its pressure over a target pushes the membrane out, so a bubble '
                   'should settle at a size set by its content (here 1, 4, 2 and 8 x the target, so 1, 2, 1.4 and 2.8 x its '
                   'starting radius). What happens: within 5k steps most membranes open into rods (one into a three-armed '
                   'star), and by 20k the field fills with stripes; the content leaks too (its total doubles over 60k '
                   'steps, where it should stay fixed). Only on this machine: the rule isn\'t committed.',
    'rule': 'builtin:18', 'size': 256, 'start': 'initial', 'stepsPerFrame': 20,
    'globals': {},
    'initial': [{'chem': 'a', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'everywhere'}}]
               + [o for cx, cy, r, m in BUB for o in disk(cx, cy, r, [('a', 0.5), ('b', 0.25), ('m', m)])],
    'view': {'reagent': 'b', 'low': 0, 'high': 0.4, 'tint': 'm'},
})
