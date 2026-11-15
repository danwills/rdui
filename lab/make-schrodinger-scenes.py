#!/usr/bin/env python3
"""Write the Schrödinger example scenes (builtin:8, Saturable Schrödinger) to scenes/.

Units: dx = 0.25 length per cell, timestep 0.05. A packet with kx (radians per
cell) moves at 0.8·kx cells per step and has energy (kx/dx)²/2. g = 0 is the
linear Schrödinger equation; g > 0 focusing, g < 0 defocusing (a quantum fluid).

  python3 lab/make-schrodinger-scenes.py
"""
import json, math, random, os

N = 256
OUT = os.path.join(os.path.dirname(__file__), '..', 'scenes')


def absorb(sides='lrtb'):
    """Graded absorbing border (gamma) on the given sides."""
    paint = []
    for w, g in ((24, 0.02), (16, 0.08), (8, 0.3)):
        if 't' in sides: paint.append({'rect': [0, 0, N, w], 'values': {'gamma': g}})
        if 'b' in sides: paint.append({'rect': [0, N - w, N, w], 'values': {'gamma': g}})
        if 'l' in sides: paint.append({'rect': [0, 0, w, N], 'values': {'gamma': g}})
        if 'r' in sides: paint.append({'rect': [N - w, 0, w, N], 'values': {'gamma': g}})
    return paint


def rect(chem, value, x0, y0, x1, y1, op='overwrite'):
    return {'chem': chem, 'op': op, 'fill': {'type': 'constant', 'value': value}, 'shape': {'type': 'rectangle', 'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1}}


def packet(cx, cy, sigma, amp=1.0, kx=0.0, ky=0.0, r=None, phase=0.0):
    """A moving Gaussian packet: both parts of ψ."""
    r = r if r is not None else min(0.45, 3.2 * sigma / N)
    shape = {'type': 'circle', 'cx': cx, 'cy': cy, 'r': r}
    return [{'chem': c, 'op': 'add', 'fill': {'type': 'packet', 'amp': amp, 'sigma': sigma, 'kx': kx, 'ky': ky, 'phase': phase, 'part': part}, 'shape': shape}
            for c, part in (('p', 'cos'), ('q', 'sin'))]


def scene(fname, name, description, globals_, initial, paint=None, view=None, steps=4, size=N):
    sc = {'name': name, 'description': description, 'rule': 'builtin:8', 'size': size, 'start': 'initial', 'stepsPerFrame': steps,
          'globals': globals_, 'paintable': ['V', 'gamma'], 'initial': initial}
    if paint: sc['paint'] = paint
    sc['view'] = view or {'reagent': 'n', 'low': 0, 'high': 1, 'tint': 'p'}
    with open(os.path.join(OUT, fname + '.json'), 'w') as f:
        json.dump(sc, f, indent=2, ensure_ascii=False)
    print('wrote', fname)


LIN = {'g': 0, 's': 0}

# --- double slit
scene('schrodinger-double-slit', 'Schrödinger double slit',
      'Linear Schrödinger equation (g = 0): a single wave packet meets a wall with two slits. Each part of the wave that gets through '
      'spreads out, and where the two overlap they interfere: bright and dark fringes fan out on the far side, exactly as for light or '
      'electrons. The wall is V = 30 (far above the packet\'s energy of about 3); the border absorbs. Try: paint V high over one slit '
      'to close it and the fringes vanish, leaving one broad spot; change the packet speed (kx) to change the fringe spacing.',
      LIN,
      [rect('V', 30, 0.44, 0, 0.46, 1), rect('V', 0, 0.44, 0.41, 0.46, 0.45), rect('V', 0, 0.44, 0.55, 0.46, 0.59)]
      + packet(0.22, 0.5, 20, kx=0.9, r=0.2),
      absorb(), {'reagent': 'n', 'low': 0, 'high': 0.25, 'tint': 'p'})

# --- tunnelling
scene('schrodinger-tunnelling', 'Schrödinger tunnelling',
      'Linear Schrödinger equation: two identical packets, each with energy about 2, hit barriers of height V = 3, more than they '
      'have, so classically both bounce straight back. The top barrier is thin (2 cells): a fair part of the wave tunnels through. '
      'The bottom one is three times as thick (6 cells): tunnelling falls off exponentially with thickness and almost nothing gets '
      'through. The lanes are separated by a wall; the border absorbs. Try: lower a barrier\'s V below 2 and most of the packet '
      'passes over it.',
      LIN,
      [rect('V', 30, 0, 0.49, 1, 0.51), rect('V', 3, 0.5, 0.05, 0.508, 0.49), rect('V', 3, 0.5, 0.51, 0.523, 0.95)]
      + packet(0.27, 0.27, 22, kx=0.5, r=0.19) + packet(0.27, 0.73, 22, kx=0.5, r=0.19),
      absorb(), {'reagent': 'n', 'low': 0, 'high': 0.4, 'tint': 'p'})

# Anderson localisation: parked. Neither white-noise nor smooth (speckle) disorder localised a packet
# in 2D at 256²; a narrow quasi-1D disordered channel should localise much sooner (to try).

# --- quantum fluid vortices (defocusing: g < 0)
# a uniform fluid needs timestep < 2π/k_max² ≈ 0.02 here (k_max² = 2(π/dx)² on the diagonal), or split-step slowly goes unstable
FLUID = {'g': -1, 's': 0, 'timestep': 0.018}


def fluid(vortices, core=5.6):   # √2 × the healing length (1, = 4 cells)
    """A box-trapped fluid: hard walls round the edge (empty inside them), and the imprinted phase
    from mirror images across the walls, so the starting flow runs along them, not through."""
    out = [{'chem': c, 'op': 'overwrite', 'fill': {'type': 'vortices', 'amp': 1, 'core': core, 'list': vortices, 'part': part, 'box': True}, 'shape': {'type': 'everywhere'}}
           for c, part in (('p', 'cos'), ('q', 'sin'))]
    b, e = 6 / N, 14 / N
    for x0, y0, x1, y1 in ((0, 0, 1, b), (0, 1 - b, 1, 1), (0, 0, b, 1), (1 - b, 0, 1, 1)):
        out += [rect('V', 30, x0, y0, x1, y1), rect('p', 0, x0, y0, x1, y1), rect('q', 0, x0, y0, x1, y1)]
    # fade the fluid in from each wall (a sharp edge rings with short waves that never die away)
    for axis, lo, hi, frm, to in (('x', b, e, 0, 1), ('x', 1 - e, 1 - b, 1, 0), ('y', b, e, 0, 1), ('y', 1 - e, 1 - b, 1, 0)):
        shape = {'type': 'rectangle', 'x0': lo, 'y0': 0, 'x1': hi, 'y1': 1} if axis == 'x' else {'type': 'rectangle', 'x0': 0, 'y0': lo, 'x1': 1, 'y1': hi}
        out += [{'chem': c, 'op': 'multiply', 'fill': {'type': 'ramp', 'from': frm, 'to': to, 'axis': axis}, 'shape': shape} for c in ('p', 'q')]
    return out


scene('schrodinger-vortices', 'Schrödinger quantum vortices',
      'Defocusing Schrödinger (g = −1, the Gross-Pitaevskii equation of a superfluid such as a Bose-Einstein condensate): a uniform '
      'fluid in a box with quantised vortices, holes where the phase winds once round (tint shows the phase). Left: a vortex and an '
      'antivortex, which travel together in a straight line. Right: two same-sign pairs, which orbit round each other in opposite '
      'directions. Vortices can\'t be made or destroyed one at a time, only in opposite pairs. Try: erase a hole into the fluid.',
      FLUID,
      fluid([[0.22, 0.42, 1], [0.22, 0.58, -1], [0.62, 0.28, 1], [0.76, 0.28, 1], [0.62, 0.72, -1], [0.76, 0.72, -1]]),
      None, {'reagent': 'n', 'low': 0, 'high': 1.2, 'tint': 'p'}, steps=8)

random.seed(3)
turb = []
while len(turb) < 24:
    x, y = random.uniform(0.05, 0.95), random.uniform(0.05, 0.95)
    if all(math.hypot(x - a, y - b) > 0.07 for a, b, _ in turb): turb.append([round(x, 3), round(y, 3), 1 if len(turb) % 2 else -1])
scene('schrodinger-vortex-turbulence', 'Schrödinger quantum turbulence',
      'Defocusing Schrödinger (a superfluid, g = −1, in a box) with 24 quantised vortices, 12 of each sign, scattered at random: quantum '
      'turbulence. Opposite pairs race off together, same-sign ones circle each other, and close opposite pairs can annihilate in a '
      'burst of sound waves. Tint shows the phase. Try: Restart, or erase new holes.',
      FLUID, fluid(turb), None, {'reagent': 'n', 'low': 0, 'high': 1.2, 'tint': 'p'}, steps=16)

# Onsager clustering: like-sign vortices gather into large clusters
rnd = random.Random(21)
shear = []
for row, (y, n) in enumerate(((0.3, 1), (0.7, -1))):
    for i in range(9):
        shear.append([round(0.1 + (i + 0.5) * 0.8 / 9 + rnd.uniform(-0.008, 0.008), 4), round(y + rnd.uniform(-0.01, 0.01), 4), n])
scene('schrodinger-onsager-shear', 'Schrödinger Onsager clusters: shear layer',
      'Defocusing Schrödinger (a superfluid in a box, g = −1): a row of 9 vortices spinning one way (top) and a row of 9 spinning '
      'the other (bottom): two quantum shear layers. Each row wobbles and rolls up (a quantum Kelvin-Helmholtz instability), and '
      'the vortices sort themselves into one large swirling cluster of each sign, which then wander round the box together (measured: '
      '18 vortices, 2–3 lost at the walls; 82–95% keep a same-sign nearest neighbour through 60k steps). Onsager predicted in 1949 that '
      'vortices with this much energy cluster rather than mix (a negative-temperature state); it was first seen directly in '
      'Bose-Einstein condensates in 2019.',
      FLUID, fluid(shear), None, {'reagent': 'n', 'low': 0, 'high': 1.2, 'tint': 'p'}, steps=16)

rnd = random.Random(5)
rand = []
while len(rand) < 64:
    x, y = rnd.uniform(0.08, 0.92), rnd.uniform(0.08, 0.92)
    if all(math.hypot(x - a, y - b) > 0.055 for a, b, _ in rand): rand.append([round(x, 4), round(y, 4), 1 if len(rand) % 2 else -1])
scene('schrodinger-onsager-random', 'Schrödinger Onsager clusters: random start',
      'Defocusing Schrödinger (a superfluid in a box): 64 vortices, 32 of each sign, scattered at random. Close opposite pairs find '
      'each other and annihilate in bursts of sound; losing those low-energy pairs leaves the survivors with more energy each '
      '("evaporative heating"), and like-sign vortices start to gather into clusters, as Onsager predicted. Slower and less tidy than '
      'the shear layer: give it time (measured: 64 vortices fall to 14 by 80k steps, while the share with a same-sign nearest '
      'neighbour climbs from 0.42 to 0.71). Tip: Display → mode → reagent + param outlines shows the box walls.',
      FLUID, fluid(rand), None, {'reagent': 'n', 'low': 0, 'high': 1.2, 'tint': 'p'}, steps=16)

# --- harmonic trap
W = 0.1                               # trap frequency
R = 0.75                              # bowl circle (normalized), covers the corners
VRIM = 0.5 * W * W * (R * N * 0.25) ** 2
SIG0 = 1 / math.sqrt(W) / 0.25        # ground-state width in cells
scene('schrodinger-harmonic-trap', 'Schrödinger harmonic trap',
      f'Linear Schrödinger equation in a bowl-shaped potential V = ½ω²r² (ω = {W}). Left: a packet the exact width of the ground '
      'state, pulled to one side, swings back and forth through the centre forever without spreading: a coherent state, the most '
      'classical a quantum state gets. Top: a squeezed packet, narrower than the ground state, breathes (spreads and refocuses twice '
      'per swing) as it swings. Where they cross they interfere. Period about 1260 steps.',
      LIN,
      [{'chem': 'V', 'op': 'overwrite', 'fill': {'type': 'bowl', 'value': round(VRIM, 3)}, 'shape': {'type': 'circle', 'cx': 0.5, 'cy': 0.5, 'r': R}}]
      + packet(0.3, 0.5, round(SIG0, 2)) + packet(0.5, 0.25, round(SIG0 / 2.2, 2)),
      None, {'reagent': 'n', 'low': 0, 'high': 1, 'tint': 'p'}, steps=8)

W2 = 0.05
scene('schrodinger-trap-soliton', 'Schrödinger soliton in a trap',
      f'Self-focusing Schrödinger (g = 1, saturable) in a bowl potential (ω = {W2}): two solitons launched sideways orbit the centre '
      'like planets, held together by their own nonlinearity so they don\'t spread, and collide each half orbit, passing through '
      'or bouncing depending on their phase.',
      {'g': 1, 's': 0.5},
      [{'chem': 'V', 'op': 'overwrite', 'fill': {'type': 'bowl', 'value': round(0.5 * W2 * W2 * (R * N * 0.25) ** 2, 3)}, 'shape': {'type': 'circle', 'cx': 0.5, 'cy': 0.5, 'r': R}}]
      + packet(0.3, 0.5, 7, amp=2.2, ky=-0.16) + packet(0.7, 0.5, 7, amp=2.2, ky=0.16, phase=1.5),
      None, {'reagent': 'n', 'low': 0, 'high': 4, 'tint': 'p'}, steps=8)

# --- periodic contraptions
PER, CH = 16, 10                      # channel period and width (cells)


def channels(v):
    out = [rect('V', v, 0, 0, 1, 1)]
    for i in range(N // PER):
        out.append(rect('V', 0, (i * PER + 3) / N, 0, (i * PER + 3 + CH) / N, 1))
    return out


scene('schrodinger-waveguide-array', 'Schrödinger waveguide array',
      f'Linear Schrödinger equation in a periodic potential: {N // PER} parallel channels (V = 0, {CH} cells wide) separated by low '
      'walls (V = 1.5) the wave can tunnel through. A packet started in one channel leaks sideways channel to channel: discrete '
      'diffraction, where the wave runs out in two strong outer lobes with a dark middle, unlike free spreading, which is brightest in '
      'the middle. Coupled optical waveguide arrays do exactly this. It starts as a line down one channel, so the spread is all sideways.',
      LIN, channels(1.5) + [o for j in range(13) for o in packet((7 * PER + 3 + CH / 2) / N, 0.26 + j * 0.04, 4, amp=1)],
      absorb('tb'), {'reagent': 'n', 'low': 0, 'high': 0.6, 'tint': 'p'}, steps=8)

# Bloch oscillations: the channels tilted by a ramp
TB = 1200 * 0.05                      # Bloch period (time)
F = 2 * math.pi / (TB * PER * 0.25)
ramp = round(F * N * 0.25, 3)
scene('schrodinger-bloch', 'Schrödinger Bloch oscillations',
      f'The waveguide array tilted: a steady push to the right (V falls by {ramp} across the field). In free space the packet would '
      'accelerate away. In the periodic channels it moves right, slows, turns round and comes back, oscillating in place forever: '
      'Bloch oscillations, because momentum in a lattice is cyclic, so a steady force sweeps the wave round its band and back. '
      'Period about 1200 steps. Seen in cold atoms in optical lattices and in electrons in superlattices.',
      LIN, channels(1.5) + [{'chem': 'V', 'op': 'add', 'fill': {'type': 'ramp', 'from': ramp, 'to': 0, 'axis': 'x'}, 'shape': {'type': 'everywhere'}},
                            rect('V', 30, 0, 0, 0.012, 1), rect('V', 30, 0.988, 0, 1, 1)]
      + packet(0.5, 0.5, 22),
      absorb('tb'), {'reagent': 'n', 'low': 0, 'high': 1, 'tint': 'p'}, steps=8)

# Talbot: a lattice of tiny packets at rest re-forms itself
A = 32
tal = []
for j in range(N // A):
    for i in range(N // A):
        tal.append({'chem': 'p', 'op': 'add', 'fill': {'type': 'packet', 'amp': 1.5, 'sigma': 2.5, 'part': 'cos'},
                    'shape': {'type': 'circle', 'cx': (i + 0.5) * A / N, 'cy': (j + 0.5) * A / N, 'r': 10 / N}})
TT = round((A * 0.25) ** 2 / math.pi / 0.05)
scene('schrodinger-talbot', 'Schrödinger Talbot kaleidoscope',
      f'Linear Schrödinger equation, no potential: a square lattice of {len(tal)} tiny packets at rest. Each spreads and they all '
      'interfere, filling the field with ever finer patterns, and yet the whole lattice re-forms exactly after the Talbot time '
      f'(about {TT} steps), shifted by half a cell at half that time, with copies at double and quadruple density at simple fractions '
      'in between: the quantum carpet, or Talbot effect (Talbot, 1836, with light through a grating).',
      LIN, tal, None, {'reagent': 'n', 'low': 0, 'high': 0.5, 'tint': 'p'}, steps=2)

# Bragg crystal: a lattice of posts splits a beam into discrete beams
posts = []
for j in range(N // PER):
    for i in range(6):
        posts.append({'chem': 'V', 'op': 'add', 'fill': {'type': 'bump', 'value': 3, 'edge': 1}, 'shape': {'type': 'circle', 'cx': (128 + i * PER) / N, 'cy': (j * PER + 8) / N, 'r': 3 / N}})
scene('schrodinger-bragg', 'Schrödinger Bragg crystal',
      f'Linear Schrödinger equation: a packet fired into a crystal, a slab of posts (V = 3) every {PER} cells. Because the posts are '
      'periodic, scattered waves only add up in particular directions, so the packet leaves as a few sharp beams (Bragg diffraction, '
      'how X-rays reveal crystal structure) rather than spraying everywhere. Try: change the packet speed to move the beams.',
      LIN, posts + packet(0.22, 0.5, 14, kx=0.55, ky=0.18),
      absorb(), {'reagent': 'n', 'low': 0, 'high': 0.3, 'tint': 'p'}, steps=4)


# --- soliton phase collider and ring push-off (focusing, the ring track's medium)
SOL = dict(sigma=7, amp=2.2, r=0.1)
lanes, phases = (0.2, 0.4, 0.6, 0.8), (0, 90, 180, 270)
col = []
for y, ph in zip(lanes, phases):
    col.append({'chem': 'V', 'op': 'add', 'fill': {'type': 'constant', 'value': -0.6}, 'shape': {'type': 'rectangle', 'x0': 0, 'y0': y - 8 / N, 'x1': 1, 'y1': y + 8 / N}})
    col += packet(0.3, y, kx=0.05, **SOL) + packet(0.7, y, kx=-0.05, phase=math.radians(ph), **SOL)
scene('schrodinger-phase-collider', 'Schrödinger soliton phase collider',
      'Focusing saturable Schrödinger: four straight channels (V = −0.6, the ring track\'s depth), each with two identical solitons '
      'meeting head-on slowly. The only difference between the lanes is the right-hand soliton\'s phase relative to the left one: '
      '0° (top), 90°, 180°, 270° (bottom). Measured in the lab: in phase (0°) their fields add, they merge into one bright peak '
      'and then come out again, equal in power (in open space at this speed, the nls-collisions scene, they stay fused). At 180° '
      'the fields cancel in the middle: a dark node keeps them about 19 cells apart, and they bounce back with equal power. At 90° '
      'they trade power, ending about 890 against 520 (out of 2 × 700), and the weaker one is flung out fast; 270° is the mirror '
      'image, the other one winning. Faster solitons pass through whatever the phase. The border absorbs. Try: Display → mode → '
      'reagent + param outlines to see the channels; the soliton stamps (four phases, still or moving) to stage your own '
      'collisions.',
      {}, col, absorb(), {'reagent': 'n', 'low': 0, 'high': 5, 'tint': 'p', 'tintLow': -2.5, 'tintHigh': 2.5}, steps=4)

# two solitons at rest on the ring track, half a soliton apart in opposite phase: they push each other off round the track
R0 = (0.3046875 + 0.2421875) / 2
# the ring track's V (as in nls-ring.json): a channel of −0.6 between r .242 and .305
push = [{'chem': 'V', 'op': 'add', 'fill': {'type': 'bump', 'value': -0.6, 'edge': 2}, 'shape': {'type': 'circle', 'cx': 0.5, 'cy': 0.5, 'r': 0.3046875}},
        {'chem': 'V', 'op': 'add', 'fill': {'type': 'bump', 'value': 0.6, 'edge': 2}, 'shape': {'type': 'circle', 'cx': 0.5, 'cy': 0.5, 'r': 0.2421875}}]
for ang, ph in ((-0.16, 0), (0.16, 180)):
    push += packet(0.5 + R0 * math.cos(ang), 0.5 + R0 * math.sin(ang), phase=math.radians(ph), **SOL)
scene('schrodinger-ring-pushoff', 'Schrödinger ring push-off',
      'The ring track (a circular channel of low V) with two solitons placed at rest, close together, in opposite phase. Neither is '
      'moving, but the dark node between them pushes them apart: they slide off round the track in opposite directions, meet again '
      'on the far side, bounce, and so on. Change the phase and they\'d attract instead (try the soliton stamps: drop "still · phase 0" and '
      '"still · phase π" on the track, or two at phase 0). The border absorbs.',
      {}, push, absorb(), {'reagent': 'n', 'low': 0, 'high': 5, 'tint': 'p', 'tintLow': -2.5, 'tintHigh': 2.5}, steps=8)
