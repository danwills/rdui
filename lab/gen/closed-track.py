# Writes a Momentum Bubbles closed-circuit scene: gates on a loop of grid points, each aiming at the next, the last at
# the first, so dots go round for ever without crossing the frame's edge (Contraptions 21's Hilbert circuit wraps).
#   python3 lab/gen/closed-track.py moore ORDER SIZE OUT N          a Moore curve (four Hilbert curves of order ORDER-1)
#   python3 lab/gen/closed-track.py tree BLOCKS SIZE OUT N [seed]   a random tree curve: round a random spanning tree
#                                                                   of BLOCKS² blocks, through all (2·BLOCKS)² cells
# env: DOT (soliton radius, cells; 3), STRIDE (a dot in every STRIDE'th gate; 2), AIM (0.025), BRAKE (0.002), RULE (57)
# Contraptions 28: moore 4 512 scenes/momentum-18-moore.json 28; 29: tree 8 512 scenes/momentum-18-tree.json 29 7
import json, os, random, sys

def moore(order):
    # L-system: axiom LFL+F+LFL, L -> -RF+LFL+FR-, R -> +LF-RFR-FL+ (order 1 is the 2x2 loop)
    s = 'LFL+F+LFL'
    for _ in range(order - 1):
        s = ''.join({'L': '-RF+LFL+FR-', 'R': '+LF-RFR-FL+'}.get(c, c) for c in s)
    n = 2 ** order
    x, y, dx, dy = n // 2 - 1, 0, 0, 1   # starts at the bottom middle, heading up
    pts = [(x, y)]
    for c in s:
        if c == 'F':
            x, y = x + dx, y + dy; pts.append((x, y))
        elif c == '+': dx, dy = dy, -dx   # turn right
        elif c == '-': dx, dy = -dy, dx   # turn left
    return pts[:-1] if pts[-1] == pts[0] else pts, n

def tree(m, seed):
    # a random spanning tree of m x m blocks, uniform among all of them (Wilson's algorithm: loop-erased random walks),
    # so it branches like a tree rather than winding in long corridors as a depth-first maze does; then the loop round
    # it: each block's four cells make a little square loop; a tree edge between two blocks cuts their facing sides and
    # joins the loops across, so all of them become one loop through every cell
    rnd = random.Random(seed)
    cells = [(x, y) for x in range(m) for y in range(m)]
    intree, edges = {cells[0]}, set()
    for c in cells:
        nxt, a = {}, c
        while a not in intree:
            nb = [(a[0] + dx, a[1] + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
            nxt[a] = rnd.choice([b for b in nb if 0 <= b[0] < m and 0 <= b[1] < m]); a = nxt[a]
        a = c
        while a not in intree:
            intree.add(a); edges.add(frozenset((a, nxt[a]))); a = nxt[a]
    adj = {}
    link = lambda p, q: (adj.setdefault(p, set()).add(q), adj.setdefault(q, set()).add(p))
    cut = lambda p, q: (adj[p].discard(q), adj[q].discard(p))
    for bx in range(m):
        for by in range(m):
            c = [(2 * bx, 2 * by), (2 * bx + 1, 2 * by), (2 * bx + 1, 2 * by + 1), (2 * bx, 2 * by + 1)]
            for i in range(4): link(c[i], c[(i + 1) % 4])
    for e in edges:
        (ax, ay), (bx, by) = sorted(e)
        if bx == ax + 1:   # b is east of a
            cut((2 * ax + 1, 2 * ay), (2 * ax + 1, 2 * ay + 1)); cut((2 * bx, 2 * by), (2 * bx, 2 * by + 1))
            link((2 * ax + 1, 2 * ay), (2 * bx, 2 * by)); link((2 * ax + 1, 2 * ay + 1), (2 * bx, 2 * by + 1))
        else:              # b is north of a
            cut((2 * ax, 2 * ay + 1), (2 * ax + 1, 2 * ay + 1)); cut((2 * bx, 2 * by), (2 * bx + 1, 2 * by))
            link((2 * ax, 2 * ay + 1), (2 * bx, 2 * by)); link((2 * ax + 1, 2 * ay + 1), (2 * bx + 1, 2 * by))
    pts, prev = [(0, 0)], None
    while True:
        nxt = [q for q in adj[pts[-1]] if q != prev]
        assert len(adj[pts[-1]]) == 2
        prev, q = pts[-1], nxt[0]
        if q == pts[0]: break
        pts.append(q)
    return pts, 2 * m

kind, a, size, out, N = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], int(sys.argv[5])
seed = int(sys.argv[6]) if len(sys.argv) > 6 else 1
pts, n = moore(a) if kind == 'moore' else tree(a, seed)
assert len(pts) == n * n and len(set(pts)) == n * n, (len(pts), len(set(pts)), n)
assert all(abs(p[0] - q[0]) + abs(p[1] - q[1]) == 1 for p, q in zip(pts, pts[1:] + pts[:1])), 'not a closed unit-step loop'
# screen coordinates (y down) of the cell centres; the aims are y-up
P = [((x + 0.5) / n, 1 - (y + 0.5) / n) for x, y in pts]
gap = 1 / n
gr = 0.38 * gap
DOT, STRIDE = float(os.environ.get('DOT', 3)), int(os.environ.get('STRIDE', 2))
A, BK, RULE = float(os.environ.get('AIM', 0.025)), float(os.environ.get('BRAKE', 0.002)), int(os.environ.get('RULE', 57))
init = [{'chem': 'u', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'everywhere'}}]
for i, (x, y) in enumerate(pts):
    nx, ny = pts[(i + 1) % len(pts)]
    for ch, v in (('ax', nx - x), ('ay', ny - y)):
        if v: init.append({'chem': ch, 'op': 'add', 'fill': {'type': 'bump', 'value': v, 'edge': 3.0}, 'shape': {'type': 'circle', 'cx': P[i][0], 'cy': P[i][1], 'r': gr}})
ndots = 0
for i in range(0, len(P), STRIDE):
    ndots += 1
    init.append({'chem': 'phi', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'circle', 'cx': P[i][0], 'cy': P[i][1], 'r': DOT / size}})
    init.append({'chem': 'm', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 10}, 'shape': {'type': 'circle', 'cx': P[i][0], 'cy': P[i][1], 'r': DOT / size}})
what = (f'a Moore curve (order {a}: four order-{a - 1} Hilbert curves, like Contraptions 21\'s, joined into a loop)' if kind == 'moore'
        else f'a random tree curve (the loop round a random spanning tree of {a}x{a} blocks, seed {seed}: it visits every cell, and closes)')
json.dump({
    'name': f'Contraptions {N}: ' + (f'Moore circuit (order {a})' if kind == 'moore' else f'random tree circuit ({n}x{n})') + f' (Momentum Bubbles {RULE - 39})',
    'description': f'A closed circuit on {what}, {len(pts)} gates at {size}², each aiming at the next and the last at the first, so it never crosses the frame\'s edge: {ndots} dots (radius {DOT:g} cells) start at rest in every {"other" if STRIDE == 2 else f"{STRIDE}th"} gate, which launch them round and round. Gates: brake, accel {BK}, aim_speed {A}. Gates show as the aim channel in the custom palette.',
    'rule': f'builtin:{RULE}', 'size': size, 'start': 'initial', 'stepsPerFrame': 40,
    'globals': {'aim_speed': A, 'brake': BK, 'accel': BK},
    'initial': init, 'view': {'reagent': 'phi', 'low': 0, 'high': 1}}, open(out, 'w'), indent=1)
print(kind, len(pts), 'gates,', ndots, 'dots ->', out)
