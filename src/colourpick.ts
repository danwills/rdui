// A small colour picker for the custom palette (instead of the browser's): a saturation/value
// square, a hue strip, a hex box, an eyedropper where the browser has one (the sim pauses only
// while it's picking), and ✕. Esc, Enter or a press outside close it too. Changes apply live.
import { el, button } from './ui';

type RGB = [number, number, number];

function rgbToHsv([r, g, b]: RGB): RGB {
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, max ? d / max : 0, max];
}
function hsvToRgb(h: number, s: number, v: number): RGB {
  return [5, 3, 1].map((n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }) as RGB;
}
const hex = (c: RGB) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');

let openOne: (() => void) | null = null;

/** Opens the picker by `anchor`. `hold(true/false)` pauses the sim while the eyedropper is picking. */
export function openColourPicker(anchor: HTMLElement, start: RGB, onChange: (c: RGB) => void, hold: (on: boolean) => void) {
  openOne?.();
  let [h, s, v] = rgbToHsv(start);
  const W = 200, SQ = 140, HB = 16;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = (w: number, ht: number) => { const c = el('canvas'); c.width = w * dpr; c.height = ht * dpr; c.style.width = `${w}px`; c.style.height = `${ht}px`; return c; };
  const sv = canvas(W, SQ), hue = canvas(W, HB);
  const hexBox = el('input', { type: 'text', class: 'num', value: hex(start), spellcheck: 'false' });
  const swatch = el('span', { class: 'cp-swatch' });
  const tools: HTMLElement[] = [];
  if ('EyeDropper' in window) tools.push(button('💧', () => void drop(), 'pick a colour from the screen (the sim pauses while you pick)'));
  const close = () => {
    box.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', key, true);
    openOne = null;
  };
  tools.push(button('✕', close, 'close (Esc)'));
  const box = el('div', { class: 'cp' }, sv, hue, el('div', { class: 'cp-row' }, swatch, hexBox, ...tools));

  function draw() {
    const g = sv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const base = hsvToRgb(h, 1, 1);
    const across = g.createLinearGradient(0, 0, W, 0);
    across.addColorStop(0, '#fff');
    across.addColorStop(1, hex(base));
    g.fillStyle = across;
    g.fillRect(0, 0, W, SQ);
    const down = g.createLinearGradient(0, 0, 0, SQ);
    down.addColorStop(0, 'rgba(0,0,0,0)');
    down.addColorStop(1, '#000');
    g.fillStyle = down;
    g.fillRect(0, 0, W, SQ);
    g.strokeStyle = v > 0.5 ? '#000' : '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(s * W, (1 - v) * SQ, 6, 0, Math.PI * 2);
    g.stroke();
    const k = hue.getContext('2d')!;
    k.setTransform(dpr, 0, 0, dpr, 0, 0);
    const strip = k.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 6; i++) strip.addColorStop(i / 6, hex(hsvToRgb(i / 6, 1, 1)));
    k.fillStyle = strip;
    k.fillRect(0, 0, W, HB);
    k.fillStyle = '#fff';
    k.fillRect(h * W - 1.5, 0, 3, HB);
    k.strokeStyle = '#000';
    k.strokeRect(h * W - 2.5, 0.5, 5, HB - 1);
    const c = hsvToRgb(h, s, v);
    swatch.style.background = hex(c);
    if (document.activeElement !== hexBox) hexBox.value = hex(c);
  }
  const apply = () => {
    draw();
    onChange(hsvToRgb(h, s, v));
  };
  const drag = (c: HTMLCanvasElement, at: (fx: number, fy: number) => void) => {
    const go = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      at(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
      apply();
    };
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); go(e); });
    c.addEventListener('pointermove', (e) => { if (c.hasPointerCapture(e.pointerId)) go(e); });
  };
  drag(sv, (fx, fy) => { s = fx; v = 1 - fy; });
  drag(hue, (fx) => { h = Math.min(0.9999, fx); });
  hexBox.addEventListener('keydown', (e) => e.stopPropagation());
  hexBox.addEventListener('change', () => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hexBox.value.trim());
    if (!m) return;
    [h, s, v] = rgbToHsv([0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255) as RGB);
    apply();
  });
  async function drop() {
    hold(true);
    try {
      const r = await new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper().open();
      const m = /^#?([0-9a-f]{6})$/i.exec(r.sRGBHex);
      if (m) {
        [h, s, v] = rgbToHsv([0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255) as RGB);
        apply();
      }
    } catch { /* cancelled */ } finally {
      hold(false);
    }
  }
  const outside = (e: PointerEvent) => { if (!box.contains(e.target as Node) && e.target !== anchor) close(); };
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' && e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', key, true);
  document.body.append(box);
  // beside the swatch, kept on screen
  const a = anchor.getBoundingClientRect(), b = box.getBoundingClientRect();
  box.style.left = `${Math.max(6, Math.min(innerWidth - b.width - 6, a.right - b.width))}px`;
  box.style.top = `${a.bottom + 6 + b.height < innerHeight ? a.bottom + 6 : Math.max(6, a.top - b.height - 6)}px`;
  draw();
  openOne = close;
}
