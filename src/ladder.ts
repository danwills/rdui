// The value ladder: hold the middle mouse button on a slider row (or long-press it on a touch
// screen; a quick middle click instead puts the row's default back) and a ladder of step sizes pops up, 100 at the top down to 0.0001. The row under the
// pointer is the step; dragging left or right takes steps off or adds them. Changing row carries
// on from the value reached (as Houdini's ladder). Letting go keeps the value; Esc puts it back.
// Drags don't stop at the screen's edge: a mouse or finger held near the left or right edge keeps going, faster
// the nearer (pointer lock, which hides the mouse and reads movement, is there but off: see LOCK).

export interface LadderTarget {
  get(): number;
  set(v: number): void;
  /** The slider's range: the ladder opens on the step nearest a hundredth of it. */
  range: [number, number];
  /** Hard limits, for sliders that can't go past their ends. */
  clamp?: [number, number];
  /** A middle click (let go before the ladder opens) puts the default back. */
  reset?: () => void;
}

const STEPS = [100, 10, 1, 0.1, 0.01, 0.001, 0.0001];
const LONG_PRESS = 450; // ms
const SLOP = 8; // px a long-press may wander
const MOUSE_HOLD = 200; // ms a middle button is held (or 3 px moved) before the ladder opens; let go sooner, it's a click
const EDGE = 40; // px from the screen's side where a drag keeps going by itself
// Pointer lock is off: Chrome announces it with a bubble that is a window of its own, and on Dan's desktop (X11, KWin,
// NVIDIA, Vulkan) such windows set off see-through flicker. A mouse held near the side keeps going instead, as a finger does.
const LOCK = false;
const targets = new WeakMap<Element, LadderTarget>();
let claimed = -1; // the pointer whose gesture opened a ladder (the slider guard leaves it alone)

/** Gives a slider row a value ladder. */
export function ladder(row: Element, t: LadderTarget) {
  targets.set(row, t);
  install();
}

const claimWatchers: (() => void)[] = [];
/** Calls back when a ladder takes over a gesture (the slider guard then forgets it: no tap, no undo). */
export function onLadderClaim(f: () => void) {
  claimWatchers.push(f);
}

const fmtStep = (s: number) => (s >= 1 ? String(s) : s.toFixed(Math.round(-Math.log10(s))));
const fmtValue = (v: number) => String(Number(v.toPrecision(8)));

function find(t: EventTarget | null): [Element, LadderTarget] | null {
  for (let e = t instanceof Element ? t : null; e; e = e.parentElement) {
    const l = targets.get(e);
    if (l) return [e, l];
  }
  return null;
}

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  let pending: { id: number; x: number; y: number; timer: number } | null = null;
  let mousePending: { id: number; x: number; y: number; t: LadderTarget; timer: number; start: PointerEvent } | null = null;
  const cancelPending = () => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  };

  document.addEventListener('pointerdown', (e) => {
    cancelPending();
    if (claimed !== -1 && claimed !== e.pointerId) claimed = -1;
    const hit = find(e.target);
    if (!hit) return;
    if (e.pointerType === 'mouse') {
      if (e.button !== 1) return;
      e.preventDefault(); // no autoscroll or paste
      const start = e;
      mousePending = { id: e.pointerId, x: e.clientX, y: e.clientY, t: hit[1], timer: window.setTimeout(() => { mousePending = null; open(hit[1], start); }, MOUSE_HOLD), start };
    } else {
      const start = e;
      pending = { id: e.pointerId, x: e.clientX, y: e.clientY, timer: window.setTimeout(() => { pending = null; open(hit[1], start); }, LONG_PRESS) };
    }
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (mousePending && e.pointerId === mousePending.id && Math.hypot(e.clientX - mousePending.x, e.clientY - mousePending.y) > 3) {
      const m = mousePending;
      clearTimeout(m.timer);
      mousePending = null;
      open(m.t, m.start);
    }
    if (pending && e.pointerId === pending.id && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > SLOP) cancelPending();
  }, true);
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, (e) => {
    if (mousePending && (e as PointerEvent).pointerId === mousePending.id) {
      const m = mousePending;
      clearTimeout(m.timer);
      mousePending = null;
      if (type === 'pointerup') m.t.reset?.();
    }
    if (pending && (e as PointerEvent).pointerId === pending.id) cancelPending();
  }, true);
  // a middle click on a row isn't a paste or an autoscroll; a long-press isn't a context menu
  for (const type of ['mousedown', 'mouseup', 'auxclick']) document.addEventListener(type, (e) => {
    if ((e as MouseEvent).button === 1 && find(e.target)) e.preventDefault();
  }, true);
  document.addEventListener('contextmenu', (e) => {
    if (claimed !== -1 || (pending && find(e.target))) e.preventDefault();
  }, true);
}

function open(t: LadderTarget, start: PointerEvent) {
  claimed = start.pointerId;
  claimWatchers.forEach((f) => f());
  const touch = start.pointerType !== 'mouse';
  const original = t.get();
  const span = Math.abs(t.range[1] - t.range[0]) || 1;
  let row = STEPS.reduce((best, s, i) => (Math.abs(Math.log10(s / (span / 100))) < Math.abs(Math.log10(STEPS[best] / (span / 100))) ? i : best), 0);
  let base = original, value = original;
  // where the drag has got to: the pointer, plus how far it has carried on past the screen's edge
  // (locked: the mouse's movement, summed)
  let x = start.clientX, y = start.clientY, lastX = start.clientX, drift = 0, baseX = x;
  const PX = touch ? 16 : 10; // px per step

  const rows = STEPS.map((s) => {
    const r = document.createElement('div');
    r.className = 'ladder-row';
    r.innerHTML = `<span class="ladder-step">${fmtStep(s)}</span><span class="ladder-value"></span>`;
    return r;
  });
  const head = document.createElement('div');
  head.className = 'ladder-head';
  const box = document.createElement('div');
  box.className = 'ladder' + (touch ? ' touch' : '');
  box.append(head, ...rows);
  document.body.append(box);
  // the starting row under the pointer (on a touch screen, beside the finger so it can be seen)
  const rh = rows[0].getBoundingClientRect().height, w = box.getBoundingClientRect().width;
  const headH = head.getBoundingClientRect().height;
  let left = touch ? start.clientX - w - 24 : start.clientX - w / 2;
  if (left < 4) left = touch ? start.clientX + 24 : 4;
  left = Math.min(left, innerWidth - w - 4);
  const top = start.clientY - headH - rh * (row + 0.5);
  box.style.left = `${Math.max(4, left)}px`;
  box.style.top = `${top}px`; // may run off screen: the rows still follow the pointer's height

  const show = () => {
    rows.forEach((r, i) => {
      r.classList.toggle('active', i === row);
      (r.lastChild as HTMLElement).textContent = i === row ? fmtValue(value) : '';
    });
    const d = value - original;
    head.textContent = `${fmtValue(value)}${d ? `  (${d > 0 ? '+' : ''}${fmtValue(d)})` : ''}`;
  };
  const apply = (v: number) => {
    if (t.clamp) v = Math.min(t.clamp[1], Math.max(t.clamp[0], v));
    value = Number(v.toPrecision(12));
    t.set(value);
    show();
  };
  show();

  const update = () => {
    const r = Math.min(STEPS.length - 1, Math.max(0, Math.floor((y - top - headH) / rh)));
    if (r !== row) {
      row = r;
      base = value;
      baseX = x;
    }
    apply(base + Math.trunc((x - baseX) / PX) * STEPS[row]);
  };
  const locked = () => document.pointerLockElement === box;
  const move = (e: PointerEvent) => {
    if (e.pointerId !== start.pointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (locked()) {
      // the rows stay in reach: no moving miles past the top or bottom one
      x += e.movementX;
      y = Math.min(top + headH + rh * STEPS.length - 1, Math.max(top + headH, y + e.movementY));
    } else {
      lastX = e.clientX;
      x = e.clientX + drift;
      y = e.clientY;
    }
    update();
  };
  // unlocked, held near the screen's side: carry on that way, up to 8 px a frame
  let raf = 0;
  const edge = () => {
    raf = requestAnimationFrame(edge);
    if (locked()) return;
    const d = lastX < EDGE ? lastX - EDGE : lastX > innerWidth - EDGE ? lastX - (innerWidth - EDGE) : 0;
    if (!d) return;
    drift += (d / EDGE) * 8;
    x = lastX + drift;
    update();
  };
  raf = requestAnimationFrame(edge);
  // Esc (which the browser spends on unlocking) puts the value back, as it does unlocked
  let wasLocked = false;
  const lockChange = () => {
    if (locked()) wasLocked = true;
    else if (wasLocked) close(false);
  };
  // the slider under the finger mustn't move with the drag, nor its events reach the app
  const block = (e: Event) => e.stopImmediatePropagation();
  const noScroll = (e: TouchEvent) => e.preventDefault();
  const close = (keep: boolean) => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('keydown', key, true);
    document.removeEventListener('touchmove', noScroll);
    document.removeEventListener('pointerlockchange', lockChange);
    cancelAnimationFrame(raf);
    if (locked()) document.exitPointerLock();
    // (the slider's own change comes a little after the finger lifts)
    setTimeout(() => {
      for (const type of ['input', 'change']) window.removeEventListener(type, block, true);
    }, 300);
    box.remove();
    if (!keep) apply(original);
    else t.set(value); // the slider shows the value, whatever its own drag did
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== start.pointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close(true);
  };
  const cancel = (e: PointerEvent) => { if (e.pointerId === start.pointerId) close(true); };
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' && e.key !== 'Enter') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close(e.key === 'Enter');
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', cancel, true);
  window.addEventListener('keydown', key, true);
  for (const type of ['input', 'change']) window.addEventListener(type, block, true);
  document.addEventListener('touchmove', noScroll, { passive: false });
  document.addEventListener('pointerlockchange', lockChange);
  // (a browser that won't lock falls back to the edge)
  if (!touch && LOCK) Promise.resolve(box.requestPointerLock?.()).catch(() => {});
}
