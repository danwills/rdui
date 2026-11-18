# Writes a Momentum Bubbles Hilbert-curve track scene:
#   python3 lab/gen/hilbert-track.py ORDER SIZE OUT [dots] [aim_speed] [brake] [N, its Contraptions number: one more than the newest]
import json, sys
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
n = 2 ** order
# screen coordinates: y down; the curve starts at the bottom left and ends at the bottom right
H = 1.0
pts = [((x + 0.5) / n, H * (1 - (y + 0.5) / n)) for x, y in (d2xy(n, d) for d in range(n * n))]
gap = 1 / n
gr = 0.38 * gap * H          # gate radius (the corner track's gates were ~1/3 of their spacing)
dr = 20.0 / size         # dot radius: 20 cells (13 come apart on this track)
C = lambda chem, v, cx, cy, r: {'chem': chem, 'op': 'overwrite', 'fill': {'type': 'constant', 'value': v}, 'shape': {'type': 'circle', 'cx': cx, 'cy': cy, 'r': r}}
Bump = lambda chem, v, cx, cy, r, e=3: {'chem': chem, 'op': 'add', 'fill': {'type': 'bump', 'value': v, 'edge': e}, 'shape': {'type': 'circle', 'cx': cx, 'cy': cy, 'r': r}}
Rect = lambda chem, v, x, y, w, h: {'chem': chem, 'op': 'overwrite', 'fill': {'type': 'constant', 'value': v}, 'shape': {'type': 'rectangle', 'x0': x, 'y0': y, 'x1': x + w, 'y1': y + h}}
init = [{'chem': 'u', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'everywhere'}}]
# each gate aims at the next point; the last point is the bowl instead
for i, (px, py) in enumerate(pts[:-1]):
    nx, ny = pts[i + 1]
    ax, ay = (nx > px + 1e-6) - (nx < px - 1e-6), (ny < py - 1e-6) - (ny > py + 1e-6)  # aim is y-up
    init += [Bump(ch, v, px, py, gr) for ch, v in (('ax', ax), ('ay', ay)) if v]
# the bowl, in the last point's square: aims everywhere at its middle, gripping less towards it (|a| = distance/R),
# so dots that arrive are pulled in, braked, and gather there
lx, ly = pts[-1]
R = 0.45 * gap
Ramp = lambda chem, a, b, axis: {'chem': chem, 'op': 'overwrite', 'fill': {'type': 'ramp', 'from': a, 'to': b, 'axis': axis}, 'shape': {'type': 'rectangle', 'x0': lx - R, 'y0': ly - R, 'x1': lx + R, 'y1': ly + R}}
init += [Ramp('ax', 1, -1, 'x'), Ramp('ay', -1, 1, 'y')]
# the dots: at rest in the first gate (it launches them), more following below it
fx, fy = pts[0]
for k in range(ndots):
    cy = fy + k * 3 * dr
    init += [Bump('phi', 1, fx, cy, dr), Bump('m', 10, fx, cy, dr)]  # feathered
json.dump({'name': f'Contraptions {N}: Hilbert track (order {order}) (Momentum Bubbles 12)',
           'description': f'A Hilbert-curve track (order {order}, {n * n - 1} gates, each aiming at the next) at {size}²: a dot starts at rest in the bottom-left gate, which launches it; it follows the curve, and ends in a bowl in the last square, which aims everything at its middle (gripping less towards it), where dots gather (one swings out to the frame’s edge once on the way in, then settles). Dots are radius 20 cells, feathered. Gates: brake, accel {BK}, aim_speed {A}. Gates show as the aim channel in the custom palette.',
           'rule': 'builtin:51', 'size': size, 'start': 'initial', 'stepsPerFrame': 40,
           'globals': {'aim_speed': A, 'brake': BK, 'accel': BK},
           'initial': init, 'view': {'reagent': 'phi', 'low': 0, 'high': 1}}, open(out, 'w'), indent=1)
print(len(pts), 'gates; first', pts[:3], 'last', pts[-1])
