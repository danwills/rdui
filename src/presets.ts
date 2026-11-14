// Gray-Scott (feed, kill) points with well-known behaviour, for Du=1, Dv=0.5, dt=1
// on the 9-point stencil. Names roughly follow Pearson's / mrob's classification.

export interface Preset {
  name: string;
  feed: number;
  kill: number;
  note: string;
}

export const PRESETS: Preset[] = [
  { name: 'mitosis', feed: 0.0367, kill: 0.0649, note: 'spots that divide' },
  { name: 'coral', feed: 0.0545, kill: 0.062, note: 'branching growth' },
  { name: 'maze', feed: 0.029, kill: 0.057, note: 'labyrinth stripes' },
  { name: 'worms', feed: 0.078, kill: 0.061, note: 'stable worms' },
  { name: 'solitons', feed: 0.03, kill: 0.062, note: 'stable isolated spots' },
  { name: 'u-skate', feed: 0.062, kill: 0.0609, note: 'gliders on a bed' },
  { name: 'waves', feed: 0.014, kill: 0.045, note: 'travelling waves / spirals' },
  { name: 'bubbles', feed: 0.098, kill: 0.0555, note: 'holes in a sea' },
  { name: 'chaos', feed: 0.026, kill: 0.051, note: 'turbulent spots' },
  { name: 'dead', feed: 0.01, kill: 0.07, note: 'everything decays (insulator)' },
];

export const DEFAULT_PRESET = PRESETS[0];

/**
 * Pearson's pattern classes (and the ones Munafo added: ν ξ π ρ σ), placed at the
 * first example point Munafo's xmorphia gives for each (mrob.com/pub/comp/xmorphia/pearson-classes.html).
 */
export const PEARSON: { name: string; feed: number; kill: number }[] = [
  { name: 'α', feed: 0.010, kill: 0.047 },
  { name: 'β', feed: 0.014, kill: 0.039 },
  { name: 'γ', feed: 0.022, kill: 0.051 },
  { name: 'δ', feed: 0.030, kill: 0.055 },
  { name: 'ε', feed: 0.018, kill: 0.055 },
  { name: 'ζ', feed: 0.022, kill: 0.061 },
  { name: 'η', feed: 0.034, kill: 0.063 },
  { name: 'θ', feed: 0.030, kill: 0.057 },
  { name: 'ι', feed: 0.046, kill: 0.0594 },
  { name: 'κ', feed: 0.050, kill: 0.063 },
  { name: 'λ', feed: 0.026, kill: 0.061 },
  { name: 'μ', feed: 0.046, kill: 0.065 },
  { name: 'ν', feed: 0.054, kill: 0.067 },
  { name: 'ξ', feed: 0.010, kill: 0.041 },
  { name: 'π', feed: 0.062, kill: 0.061 },
  { name: 'ρ', feed: 0.090, kill: 0.059 },
  { name: 'σ', feed: 0.090, kill: 0.057 },
];
