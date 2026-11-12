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
