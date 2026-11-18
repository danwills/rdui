# Writes a Momentum Bubbles Hilbert-curve track scene:
#   [DOT=cells] python3 lab/gen/hilbert-track.py ORDER SIZE OUT [dots] [aim_speed] [brake] [N, its Contraptions number: one more than the newest] [end: bowl | trap | corner | loop] [full_at]
# Contraptions 13: 2 512 OUT 1 0.03 0.002 13; 14: 2 512 OUT 3 0.03 0.002 14 trap 0.6; 15: DOT=14 3 512 OUT 3 0.025 0.002 15 corner 0.45;
# 16: DOT=14 STRIDE=4 3 512 OUT 16 0.025 0.002 16 loop 0.45; 17: DOT=14 STRIDE=1 3 512 OUT 63 0.025 0.002 17 loop 0.45 ; 18: DOT=10 STRIDE=1 3 512 OUT 63 0.025 0.002 18 loop 0.45 (16-18 with a sentence added to the description, and 17 and 18 a word to the name, by hand)
import json, os, sys
def d2xy(n, d):
    x = y = 0; s = 1; t = d
    while s < n:
        rx = 1 & (t // 2); ry = 1 & (t ^ rx)
        if ry == 0:
            if rx == 1: x, y = s - 1 - x, s - 1 - y
            x, y = y, x
        x += s * rx; y += s * ry; t //= 4; s *= 2
    return x, y
order, size, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
ndots = int(sys.argv[4]) if len(sys.argv) > 4 else 1
A = float(sys.argv[5]) if len(sys.argv) > 5 else 0.03
BK = float(sys.argv[6]) if len(sys.argv) > 6 else 0.003
N = int(sys.argv[7]) if len(sys.argv) > 7 else 13
END = sys.argv[8] if len(sys.argv) > 8 else 'bowl'
FULL = float(sys.argv[9]) if len(sys.argv) > 9 else 0.25
n = 2 ** order
# screen coordinates: y down; the curve starts at the bottom left and ends at the bottom right
H = 1.0
pts = [((x + 0.5) / n, H * (1 - (y + 0.5) / n)) for x, y in (d2xy(n, d) for d in range(n * n))]
gap = 1 / n
gr = 0.38 * gap * H          # gate radius (the corner track's gates were ~1/3 of their spacing)
dr = float(os.environ.get('DOT', 20)) / size  # dot radius in cells (20; 13 came apart on the order-2 track at aim_speed 0.04)
C = lambda chem, v, cx, cy, r: {'chem': chem, 'op': 'overwrite', 'fill': {'type': 'constant', 'value': v}, 'shape': {'type': 'circle', 'cx': cx, 'cy': cy, 'r': r}}
Bump = lambda chem, v, cx, cy, r, e=3, wrap=False: {'chem': chem, 'op': 'add', 'fill': {'type': 'bump', 'value': v, 'edge': e, **({'wrap': True} if wrap else {})}, 'shape': {'type': 'circle', 'cx': cx, 'cy': cy, 'r': r}}
Rect = lambda chem, v, x, y, w, h: {'chem': chem, 'op': 'overwrite', 'fill': {'type': 'constant', 'value': v}, 'shape': {'type': 'rectangle', 'x0': x, 'y0': y, 'x1': x + w, 'y1': y + h}}
init = [{'chem': 'u', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'everywhere'}}]
# each gate aims at the next point; the last point is the bowl or trap instead (for 'corner', the last 2x2 block is: it
# sits in the frame's bottom-right corner, and the trap goes in its middle, its soft tail fading out before the frame's
# edges, so nothing is cut off there)
gates = pts[:-4] if END == 'corner' else pts[:-1]
ends = pts[-4:] if END == 'corner' else pts[-1:]
tx, ty = sum(p[0] for p in ends) / len(ends), sum(p[1] for p in ends) / len(ends)
for i, (px, py) in enumerate(gates):
    nx, ny = pts[i + 1] if i + 1 < len(gates) else (tx, ty)
    dx, dy = nx - px, -(ny - py)  # aim is y-up
    l = (dx * dx + dy * dy) ** 0.5
    ax, ay = (round(v, 4) if abs(v - round(v)) > 1e-9 else int(round(v)) for v in (dx / l, dy / l))
    init += [Bump(ch, v, px, py, gr) for ch, v in (('ax', ax), ('ay', ay)) if abs(v) > 1e-6]
lx, ly = tx, ty
if END == 'corner':
    # the trap fills the corner square (2 gaps wide), its tail (4 edges past its radius) ending at the frame's edges
    # (a flat top, so the release aim inside it is held off everywhere it reaches)
    e = 0.1 * gap
    init += [Bump('trap', 1, lx, ly, gap - 4 * e, e * size), Bump('ax', 1, lx, ly, 0.45 * gap)]
elif END == 'loop':
    # (Momentum Bubbles 14) the whole curve, with the trap on its last point, on the lowest row, like a capacitor in a
    # circuit: it collects the dots that come down the curve and, once full, lets them go straight east, round the
    # frame into the first point. A smooth hill all the way to its middle, so its pull draws dots there; its tail
    # wrapping round the frame's edges (as the simulation does), so nothing is cut off there
    e = 0.12 * gap
    init += [Bump('trap', 1, lx, ly, 0.3 * gap, e * size, True), Bump('ax', 1, lx, ly, 0.3 * gap, 3, True)]
elif END == 'bowl':
    # the bowl, in the last point's square: aims everywhere at its middle, gripping less towards it (|a| = distance/R),
    # so dots that arrive are pulled in, braked, and gather there
    R = 0.45 * gap
    Ramp = lambda chem, a, b, axis: {'chem': chem, 'op': 'overwrite', 'fill': {'type': 'ramp', 'from': a, 'to': b, 'axis': axis}, 'shape': {'type': 'rectangle', 'x0': lx - R, 'y0': ly - R, 'x1': lx + R, 'y1': ly + R}}
    init += [Ramp('ax', 1, -1, 'x'), Ramp('ay', -1, 1, 'y')]
else:
    # the trap (Momentum Bubbles 13), in the last point's square: a smooth round hill, and inside it the release, an aim
    # east (held off until the trap's full): out of the frame, wrapping round into the first gate
    init += [Bump('trap', 1, lx, ly, 0.28 * gap, 0.1 * gap * size), Bump('ax', 1, lx, ly, 0.25 * gap)]
# the dots: at rest in every STRIDE'th gate from the first (2), which launch them
stride = int(os.environ.get('STRIDE', 2))
for k in range(ndots):
    fx, fy = pts[stride * k]
    init += [Bump('phi', 1, fx, fy, dr), Bump('m', 10, fx, fy, dr)]  # feathered
json.dump({'name': f'Contraptions {N}: Hilbert ' + ('circuit' if END == 'loop' else 'track') + f' (order {order}' + (', trap' if END in ('trap', 'corner') else ', capacitor trap' if END == 'loop' else '') + ') (Momentum Bubbles ' + ('14' if END == 'loop' else '13' if END in ('trap', 'corner') else '12') + ')',
           'description': (f'A Hilbert-curve track (order {order}, {n * n - 1} gates, each aiming at the next) at {size}²: {ndots} dots start at rest in every other gate from the first, which launch them along the curve into a trap in the last square (Momentum Bubbles 13): a smooth round hill that brakes whatever is in it and draws it in, senses how full it is, and once full (about {FULL} of it) lets go, launching what it collected east, round the frame into the first gate. Gates: brake, accel {BK}, aim_speed {A}. Gates show as the aim channel, the trap as trap and full, in the custom palette.') if END == 'trap' else (f'A Hilbert-curve track (order {order}, {len(gates)} gates, each aiming at the next) at {size}²: {ndots} dots (radius {dr * size:.0f} cells) start at rest in every other gate from the first, which launch them along the curve into a trap in place of its last 2x2 block, in the bottom-right corner (Momentum Bubbles 13): a smooth round hill, fading out before the frame\'s edges, that brakes whatever is in it and draws it in, senses how full it is, and once full (about {FULL} of it) lets go, launching what it collected east, round the frame toward the first gates. Gates: brake, accel {BK}, aim_speed {A}. Gates show as the aim channel, the trap as trap and full, in the custom palette.') if END == 'corner' else (f'A Hilbert-curve circuit (order {order}, {len(gates)} gates, each aiming at the next) at {size}²: {ndots} dots (radius {dr * size:.0f} cells) start at rest in every {stride}th gate, which launch them along the curve into a trap on its last point (Momentum Bubbles 14), like a capacitor: a smooth round hill that brakes whatever comes in and draws it to its middle, senses how full it is, and once full (about {FULL} of it) lets go, sending what it collected straight east along the lowest row, round the frame into the first point, to go round again. Gates: brake, accel {BK}, aim_speed {A}. Gates show as the aim channel, the trap as trap and full, in the custom palette.') if END == 'loop' else f'A Hilbert-curve track (order {order}, {n * n - 1} gates, each aiming at the next) at {size}²: a dot starts at rest in the bottom-left gate, which launches it; it follows the curve, and ends in a bowl in the last square, which aims everything at its middle (gripping less towards it), where dots gather (one swings out to the frame’s edge once on the way in, then settles). Dots are radius 20 cells, feathered. Gates: brake, accel {BK}, aim_speed {A}. Gates show as the aim channel in the custom palette.',
           'rule': 'builtin:53' if END == 'loop' else 'builtin:52' if END in ('trap', 'corner') else 'builtin:51', 'size': size, 'start': 'initial', 'stepsPerFrame': 40,
           'globals': {'aim_speed': A, 'brake': BK, 'accel': BK, **({'full_at': FULL} if END in ('trap', 'corner', 'loop') else {})},
           'initial': init, 'view': {'reagent': 'phi', 'low': 0, 'high': 1}}, open(out, 'w'), indent=1)
print(len(pts), 'gates; first', pts[:3], 'last', pts[-1])
