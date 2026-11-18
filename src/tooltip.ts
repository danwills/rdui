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
