// Builds the home page's clips (docs/, served by GitHub Pages) from the clips picked yes on the review page
// (lab/clip-review.mjs): each one encoded for the web (H.264, at most 720 px across, no sound, fast start) into
// docs/clips/, with a poster frame, and listed in docs/clips.json.
//   node lab/site-clips.mjs [folder, default ~/Videos/rdui-examples]
// clips.json is yours to edit: a clip already listed keeps its title, text and place in the list (only its files are
// made again), a new yes is added at the end, and one no longer picked yes is dropped. Its order is the page's.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

const dir = path.resolve(process.argv[2] ?? path.join(os.homedir(), 'Videos', 'rdui-examples'));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'docs', 'clips');
const listFile = path.join(root, 'docs', 'clips.json');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

const picks = readJson(path.join(dir, 'picks.json'), {});
const notes = readJson(path.join(dir, 'notes.json'), {});
const yes = Object.keys(picks).filter((f) => picks[f].pick === 'yes' && fs.existsSync(path.join(dir, f))).sort();
const old = readJson(listFile, []);
// a first title from the clip's description: its scene's name, the part before the first full stop (variants' notes
// start "Variant b: ...", so the name comes after that)
const title = (f) => {
  const n = (notes[f] ?? f).replace(/^Variant \w: [^.]*\.\s*/, '');
  return n.split(/\.\s/)[0].replace(/^Screen capture: /, '').trim();
};
const list = [...old.filter((c) => yes.includes(c.source)), ...yes.filter((f) => !old.some((c) => c.source === f)).map((f) => ({ source: f, title: title(f), text: '' }))];

fs.mkdirSync(out, { recursive: true });
for (const c of list) {
  const src = path.join(dir, c.source), base = c.source.replace(/\.mp4$/, '');
  c.video = `clips/${base}.mp4`;
  c.poster = `clips/${base}.jpg`;
  console.log(c.source);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-an', '-vf', "scale='min(720,iw)':-2:flags=lanczos", '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(root, 'docs', c.video)]);
  // (a frame a third of the way in: the first is often a bare seed)
  const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], { encoding: 'utf8' }));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(secs / 3), '-i', src, '-frames:v', '1', '-vf', "scale='min(720,iw)':-2", '-q:v', '4', path.join(root, 'docs', c.poster)]);
}
// clips no longer listed: their files go
const keep = new Set(list.flatMap((c) => [path.basename(c.video), path.basename(c.poster)]));
for (const f of fs.readdirSync(out)) if (!keep.has(f)) fs.rmSync(path.join(out, f));
fs.writeFileSync(listFile, JSON.stringify(list, null, 1) + '\n');
const size = fs.readdirSync(out).reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0);
console.log(`${list.length} clips, ${(size / 1e6).toFixed(1)} MB in docs/clips`);
