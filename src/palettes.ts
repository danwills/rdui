// The palettes as the panel lists them, with CSS gradient previews sampled from the same formulas
// and colour maps the render shader uses (render.wgsl: palette(), hsv(), colormap()).
import { COLORMAP_NAMES, COLORMAP_RGB } from './colormaps';
import type { CustomChannel } from './sim';

type RGB = [number, number, number];
export interface PaletteEntry { id: number; name: string; title: string; group: string }

const BUILT_IN: [number, string, string][] = [
  [0, 'abyss', 'abyss'], [1, 'ember', 'ember'], [2, 'mono', 'mono'], [3, 'spectral', 'spectral'],
  [4, 'HSV', 'HSV: show → hue, tint → sat'], [5, 'HSV fleck', 'HSV fleck: a b c → V S H'],
  [6, 'OKLCH fleck', 'OKLCH fleck: a b c → L C h'], [7, 'custom', 'custom: every reagent fitted, powered, coloured, summed'],
];
const CET_GROUPS: [RegExp, string][] = [
  [/^CET-CBT/, 'CET colour-blind (tritanopic)'], [/^CET-CB/, 'CET colour-blind'], [/^CET-L/, 'CET linear'],
  [/^CET-D/, 'CET diverging'], [/^CET-C/, 'CET cyclic'], [/^CET-I/, 'CET isoluminant'], [/^CET-R/, 'CET rainbow'],
];

export const PALETTES: PaletteEntry[] = [
  ...BUILT_IN.map(([id, name, title]) => ({ id, name, title, group: 'Built-in' })),
  ...COLORMAP_NAMES.map((name, i) => ({
    id: 100 + i, name: name.replace(/^CET-/, ''), title: name,
    group: CET_GROUPS.find(([re]) => re.test(name))?.[1] ?? 'Ready',
  })),
];

let maps: Uint8Array | null = null;
const cosPal = (t: number, a: RGB, b: RGB, c: RGB, d: RGB): RGB =>
  [0, 1, 2].map((k) => a[k] + b[k] * Math.cos(6.28318 * (c[k] * t + d[k]))) as RGB;
const smoothstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const hsv = (h: number, s: number, v: number): RGB =>
  [1, 2 / 3, 1 / 3].map((d) => v * (1 + s * (Math.min(1, Math.max(0, Math.abs((((h + d) % 1) * 6) - 3) - 1)) - 1))) as RGB;

/** The palette's colour at t (0-1), or null for palettes made from several reagents (fleck, custom). */
export function paletteAt(id: number, t: number): RGB | null {
  if (id >= 100) {
    maps ??= Uint8Array.from(atob(COLORMAP_RGB), (ch) => ch.charCodeAt(0));
    const i = Math.round(Math.min(1, Math.max(0, t)) * 255), o = ((id - 100) * 256 + i) * 3;
    return [maps[o] / 255, maps[o + 1] / 255, maps[o + 2] / 255];
  }
  switch (id) {
    case 1: return [Math.min(1, t * 2.2), Math.min(1, t * t * 1.6), Math.min(1, t ** 4 * 1.2)];
    case 2: return [t, t, t];
    case 3: return cosPal(t, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [0, 0.33, 0.67]).map((v) => v * smoothstep(0, 0.08, t)) as RGB;
    case 4: return hsv(t, 1, 1);
    case 0: {
      const c = cosPal(t * 0.85, [0.5, 0.5, 0.6], [0.5, 0.5, 0.4], [1, 0.9, 0.6], [0.55, 0.6, 0.65]), k = smoothstep(0, 0.25, t);
      return [0, 1, 2].map((j) => [0.02, 0.03, 0.06][j] * (1 - k) + c[j] * k) as RGB;
    }
    default: return null;
  }
}

const css = (c: RGB) => `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(' ')})`;

/** A CSS background previewing the palette. Fleck palettes: their hues over dark to light; custom: each reagent switched on, black to its colour. */
export function paletteCss(id: number, custom: CustomChannel[] = []): string {
  if (id === 5 || id === 6) {
    const hues = Array.from({ length: 9 }, (_, i) => css(hsv(i / 8, id === 5 ? 0.85 : 0.55, id === 5 ? 1 : 0.85)));
    return `linear-gradient(to bottom, transparent, rgb(0 0 0 / 0.6)), linear-gradient(to right, ${hues.join(', ')})`;
  }
  if (id === 7) {
    const on = custom.filter((c) => c.on);
    if (!on.length) return '#000';
    const w = 100 / on.length;
    return `linear-gradient(to right, ${on.map((c, i) => `#000 ${(i * w).toFixed(1)}%, ${css(c.color)} ${((i + 1) * w).toFixed(1)}%`).join(', ')})`;
  }
  const stops = Array.from({ length: 17 }, (_, i) => css(paletteAt(id, i / 16) ?? [0, 0, 0]));
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
