#!/usr/bin/env python3
"""Steady solitons of the Saturable Schrödinger rule (builtin 8): ½∇²φ − βφ + g·φ³/(1+sφ²) = 0 on the
rule's own grid (N cells, dx, spectral Laplacian, periodic). Found by imaginary-time descent at fixed
power (renormalising each step), which settles into the ground state for that power; β (the frequency:
the phase turns β·timestep per step) comes from the converged field. Prints the family P(β).

  python3 lab/nls-family.py [powers...]     (power = Σ|ψ|² over cells, as the lab reports it)
  python3 lab/nls-family.py --save P out.npy
"""
import sys, numpy as np

N, DX, G, S, DT = 256, 0.25, 1.0, 0.5, 0.018
k = 2 * np.pi * np.fft.fftfreq(N, d=DX)
K2 = k[None, :] ** 2 + k[:, None] ** 2
x = (np.arange(N) - N / 2) * DX
R2 = x[None, :] ** 2 + x[:, None] ** 2


def ground(P, tau=0.05, iters=20000, tol=1e-10):
    phi = np.exp(-R2 / 8.0)
    phi *= np.sqrt(P / (phi ** 2).sum())
    for i in range(iters):
        I = phi ** 2
        nl = G * I / (1 + S * I) * phi
        new = np.real(np.fft.ifft2((np.fft.fft2(phi) + tau * np.fft.fft2(nl)) / (1 + tau * 0.5 * K2)))
        new *= np.sqrt(P / (new ** 2).sum())
        if i % 200 == 0 and np.abs(new - phi).max() < tol:
            phi = new
            break
        phi = new
    I = phi ** 2
    lap = np.real(np.fft.ifft2(-K2 * np.fft.fft2(phi)))
    beta = ((0.5 * lap * phi + G * I / (1 + S * I) * I).sum()) / I.sum()
    return phi, beta, i


if __name__ == '__main__':
    if sys.argv[1:2] == ['--save']:
        phi, beta, it = ground(float(sys.argv[2]))
        np.save(sys.argv[3], phi)
        print(f'power {sys.argv[2]}: β {beta:.4f}, phase {beta*DT:.5f} rad/step (period {2*np.pi/(beta*DT):.0f} steps), peak {phi.max()**2:.3f}, iters {it}')
        sys.exit()
    for P in map(float, sys.argv[1:] or [100, 110, 120, 140, 170, 200, 300, 450, 694]):
        phi, beta, it = ground(P)
        I = phi ** 2
        rms = np.sqrt((I * R2).sum() / I.sum()) / DX
        print(f'power {P:5.0f}: β {beta:.4f}  phase {beta*DT:.5f} rad/step (period {2*np.pi/max(beta*DT,1e-9):6.0f} steps)  peak {I.max():6.3f}  rms radius {rms:5.1f} cells  ({it} iters)')
