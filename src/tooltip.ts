/**
 * Tooltips drawn in the page instead of the browser's own. Chrome draws a native tooltip as a separate window, and on
 * Dan's desktop (X11, KWin, NVIDIA, Chrome on Vulkan) showing and hiding those sets off frames where parts of the page
 * go see-through. Any element's `title` is taken over (moved to data-tip) as the pointer reaches it, so the browser never
 * shows one; titles set or changed later are picked up the same way. Mouse and pen only: touch has no hover.
 */
export function inPageTooltips() {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  document.body.append(tip);
  let target: HTMLElement | null = null;
  let timer = 0;
  let px = 0, py = 0;

  const hide = () => {
    clearTimeout(timer);
    tip.hidden = true;
    target = null;
  };
  const place = () => {
    const gap = 14, r = tip.getBoundingClientRect();
    let x = px + gap, y = py + gap + 4;
    if (x + r.width > innerWidth - 4) x = Math.max(4, px - gap - r.width);
    if (y + r.height > innerHeight - 4) y = Math.max(4, py - gap - r.height);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    // take over every title from here up, so no ancestor's native tooltip shows either
    let found: HTMLElement | null = null;
    for (let n = e.target as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
      if (n.hasAttribute('title')) {
        const t = n.getAttribute('title')!;
        n.removeAttribute('title');
        if (t) n.dataset.tip = t;
      }
      if (!found && n.dataset.tip) found = n;
    }
    if (found === target) return;
    hide();
    if (!found) return;
    target = found;
    px = e.clientX; py = e.clientY;
    timer = window.setTimeout(() => {
      if (!target?.isConnected || !target.dataset.tip) return;
      tip.textContent = target.dataset.tip;
      tip.hidden = false;
      place();
    }, 600);
  });
  document.addEventListener('pointermove', (e) => {
    px = e.clientX; py = e.clientY;
    if (!tip.hidden) place();
  });
  document.addEventListener('pointerout', (e) => {
    if (target && !target.contains(e.relatedTarget as Node | null)) hide();
  });
  for (const ev of ['pointerdown', 'wheel', 'keydown', 'blur'] as const) addEventListener(ev, hide, { capture: true, passive: true });
}

/** A note by the pointer, in the tooltips' style (drawn in the page, as they are), gone after `ms` or at the next press. */
export function noteAt(x: number, y: number, text: string, ms = 6000) {
  const note = document.createElement('div');
  note.className = 'tip';
  note.textContent = text;
  document.body.append(note);
  const r = note.getBoundingClientRect();
  note.style.left = `${Math.max(4, Math.min(x + 14, innerWidth - r.width - 4))}px`;
  note.style.top = `${Math.max(4, Math.min(y + 18, innerHeight - r.height - 4))}px`;
  const done = () => {
    note.remove();
    clearTimeout(timer);
    document.removeEventListener('pointerdown', done, true);
  };
  const timer = window.setTimeout(done, ms);
  document.addEventListener('pointerdown', done, true);
}
