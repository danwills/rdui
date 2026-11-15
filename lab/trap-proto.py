#!/usr/bin/env python3
"""Prototype of a soliton trap for the Saturable Schrödinger rule (numpy, same equation and units):
inside a disc (smooth mask m), add a Ginzburg–Landau part
    ψ_t += m·[ D∇²ψ + (−δ + ε·I − μ·I²)ψ ]          I = |ψ|²
D (diffusion) takes the soliton's motion away; −δ is loss (an empty trap stays empty), ε·I gain,
−μ·I² saturation (a captured soliton settles to one size). Optionally a V well in the disc.
A standard soliton (power ~694) is sent at the trap; prints its track, speed and power.

  python3 lab/trap-proto.py '{"D":0.3,"delta":0.05,"eps":0.03,"mu":0.002,"R":20,"well":-0.6}'
"""
import json, sys, numpy as np
sys.path.insert(0, __file__.rsplit('/', 1)[0])

N, DX, DT, G, S = 256, 0.25, 0.018, 1.0, 0.5
cfg = {'D': 0.3, 'delta': 0.05, 'eps': 0.03, 'mu': 0.002, 'R': 20, 'well': 0.0, 'k': 0.08, 'steps': 30000, 'every': 2000, 'power': 694, 'empty': False, 'local': False}
cfg.update(json.loads(sys.argv[1]) if len(sys.argv) > 1 else {})

k = 2 * np.pi * np.fft.fftfreq(N, d=DX)
K2 = k[None, :] ** 2 + k[:, None] ** 2
KIN = np.exp(-0.5j * K2 * DT)
yy, xx = np.mgrid[:N, :N]
cx, cy = 170, 128                                    # trap centre (cells)
r = np.hypot(xx - cx, yy - cy)
m = 0.5 * (1 - np.tanh((r - cfg['R']) / 3))          # smooth disc
V = cfg['well'] * m


def ground(P):
    # the standard soliton (imaginary-time descent at fixed power, as lab/nls-family.py)
    x = (np.arange(N) - N / 2) * DX
    R2 = x[None, :] ** 2 + x[:, None] ** 2
    phi = np.exp(-R2 / 2)
    phi *= np.sqrt(P / (phi ** 2).sum())
    for _ in range(3000):
        I = phi ** 2
        new = np.real(np.fft.ifft2((np.fft.fft2(phi) + 0.05 * np.fft.fft2(G * I / (1 + S * I) * phi)) / (1 + 0.025 * K2)))
        phi = new * np.sqrt(P / (new ** 2).sum())
    return phi


def lap(f):
    return (np.roll(f, 1, 0) + np.roll(f, -1, 0) + np.roll(f, 1, 1) + np.roll(f, -1, 1) - 4 * f) / DX ** 2


psi = np.zeros((N, N), complex)
if not cfg['empty']:
    phi = np.roll(np.roll(ground(cfg['power']), 128 - N // 2, 0), 60 - N // 2, 1)   # centred at (60, 128)
    psi = phi * np.exp(1j * cfg['k'] * xx)                                          # heading east at k
D, de, ep, mu = cfg['D'], cfg['delta'], cfg['eps'], cfg['mu']
last = None
for t in range(cfg['steps'] + 1):
    if t % cfg['every'] == 0:
        I = np.abs(psi) ** 2
        tot = I.sum()
        if tot > 1e-6:
            i = np.unravel_index(I.argmax(), I.shape)
            box = (np.abs(xx - i[1]) < 20) & (np.abs(yy - i[0]) < 20)
            mx = (I * xx * box).sum() / (I * box).sum()
            v = '' if last is None else f'speed {(mx - last) / cfg["every"]:.4f} cells/step'
            last = mx
            print(f't={t}: soliton x {mx:.1f} (trap at {cx}, radius {cfg["R"]}), peak {I.max():.2f}, power near it {(I * box).sum():.0f}, total {tot:.0f}, in trap {(I * (r < cfg["R"] + 6)).sum():.0f}  {v}')
        else:
            print(f't={t}: empty (total power {tot:.2e})')
    if t == cfg['steps']: break
    kin = np.fft.ifft2(KIN * np.fft.fft2(psi))
    if cfg['local']:
        # friction from the kinetic step alone (as the rule can do it, cell by cell): −β·m·i·(ψ_kin − ψ),
        # β = 2D·dt per step... per unit time it damps like D∇² with D = β/2
        kin = kin - 2 * D * m * 1j * (kin - psi)
    psi = kin
    I = np.abs(psi) ** 2
    psi *= np.exp(1j * (G * I / (1 + S * I) - V) * DT)
    I = np.abs(psi) ** 2
    psi = psi + DT * m * ((0 if cfg['local'] else D * lap(psi)) + (-de + ep * I - mu * I * I) * psi)
