// Recordings kept in the browser (its private file storage, OPFS), as well as downloaded: each video with a note of
// what it was, listed by Old Recordings to watch again, save again or delete. Also plays any video file opened.
import { el, button } from './ui';

export interface RecordingMeta {
  file: string;
  rule: string;
  /** When it was recorded (ISO). */
  date: string;
  seconds: number;
  frames: number;
  width: number;
  height: number;
  size: number;
  /** Where its EXR sequences went, if any. */
  exr?: string;
}

async function dir() {
  if (!navigator.storage?.getDirectory) return null;
  return (await navigator.storage.getDirectory()).getDirectoryHandle('recordings', { create: true });
}

/** Keeps a recording (false if the browser can't). Asks once for storage the browser won't clear by itself. */
export async function keepRecording(blob: Blob, meta: RecordingMeta): Promise<boolean> {
  try {
    const d = await dir();
    if (!d) return false;
    void navigator.storage.persist?.();
    for (const [name, data] of [[meta.file, blob], [`${meta.file}.json`, JSON.stringify(meta)]] as const) {
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(data);
      await w.close();
    }
    return true;
  } catch {
    return false;
  }
}

async function list(): Promise<RecordingMeta[]> {
  const d = await dir();
  if (!d) return [];
  const out: RecordingMeta[] = [];
  for await (const [name, h] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (!name.endsWith('.json') || h.kind !== 'file') continue;
    try { out.push(JSON.parse(await (await (h as FileSystemFileHandle).getFile()).text())); } catch { /* a broken note: skipped */ }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

/** The Old Recordings view: a player on top, the kept recordings below, newest first. */
export async function openRecordings() {
  const urls: string[] = [];
  const url = (b: Blob) => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  const player = el('video', { class: 'recs-player', controls: '', loop: '', playsinline: '' }) as HTMLVideoElement;
  const caption = el('p', { class: 'hint' });
  const usage = el('span', { class: 'hint' });
  const grid = el('div', { class: 'recs-grid' });
  const picker = el('input', { type: 'file', accept: 'video/*' }) as HTMLInputElement;
  picker.style.display = 'none';
  const play = (b: Blob, text: string) => {
    player.src = url(b);
    void player.play().catch(() => {});
    caption.textContent = text;
  };
  picker.addEventListener('change', () => {
    const f = picker.files?.[0];
    if (f) play(f, `${f.name} · ${mb(f.size)} (from disk)`);
  });
  const close = () => {
    root.remove();
    document.removeEventListener('keydown', onKey);
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const root = el('div', { class: 'recs' },
    el('div', { class: 'recs-head' }, el('strong', {}, 'Old Recordings'), usage,
      button('Open File…', () => picker.click(), 'play a video file from your disk (a recording downloaded before, say)'),
      button('✕', close, 'close (Esc)')),
    player, caption, grid, picker);
  document.body.append(root);

  async function render() {
    grid.replaceChildren();
    const d = await dir();
    if (!d) { grid.append(el('p', { class: 'hint' }, 'This browser can\'t keep recordings: open them from disk instead (Open File…).')); return; }
    const recs = await list();
    const est = await navigator.storage.estimate?.();
    usage.textContent = `${recs.length} kept, ${mb(recs.reduce((s, r) => s + r.size, 0))}${est?.quota ? ` (room for about ${mb(est.quota - (est.usage ?? 0))} more)` : ''}`;
    if (!recs.length) grid.append(el('p', { class: 'hint' }, 'None kept yet: recordings made from now on are kept here as well as downloaded. Older ones are wherever your browser saves downloads (usually Downloads, named rdui-…mp4): Open File… plays them.'));
    for (const r of recs) {
      const file = await d.getFileHandle(r.file).then((h) => h.getFile()).catch(() => null);
      const when = new Date(r.date).toLocaleString();
      const text = `${r.rule} · ${when} · ${r.seconds} s, ${r.width}×${r.height}, ${mb(r.size)}${r.exr ? ` · EXRs in ${r.exr}` : ''}`;
      const thumb = el('video', { class: 'recs-thumb', preload: 'metadata', playsinline: '' }) as HTMLVideoElement;
      thumb.muted = true;
      if (file) thumb.src = url(file) + '#t=0.5';
      const card = el('div', { class: 'recs-card', title: 'play it above' }, thumb,
        el('div', { class: 'recs-text' }, el('strong', {}, r.rule), el('span', {}, `${when} · ${r.seconds} s · ${mb(r.size)}`), r.exr ? el('span', {}, `EXRs: ${r.exr}`) : ''),
        el('div', { class: 'buttons' },
          button('⬇', () => {
            if (!file) return;
            const a = el('a', { href: url(file), download: r.file });
            document.body.append(a);
            a.click();
            a.remove();
          }, 'save it (download) again'),
          button('🗑', async () => {
            if (!confirm(`Delete ${r.file} from the kept recordings? (Copies you downloaded stay.)`)) return;
            await d.removeEntry(r.file).catch(() => {});
            await d.removeEntry(`${r.file}.json`).catch(() => {});
            await render();
          }, 'delete it from the kept recordings')));
      card.addEventListener('click', (e) => { if (file && !(e.target as HTMLElement).closest('button')) play(file, text); });
      if (!file) card.classList.add('missing');
      grid.append(card);
    }
    const first = recs[0];
    if (first && !player.src) {
      const f = await d.getFileHandle(first.file).then((h) => h.getFile()).catch(() => null);
      if (f) { player.src = url(f); caption.textContent = `${first.rule} · ${new Date(first.date).toLocaleString()} · ${first.seconds} s, ${first.width}×${first.height}, ${mb(first.size)}${first.exr ? ` · EXRs in ${first.exr}` : ''}`; }
    }
  }
  await render();
}
