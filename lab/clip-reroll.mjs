// Works through the re-rolls asked for on the clip review page (lab/clip-review.mjs): each one re-records a clip from
// its recipe (.recipes/<clip>.json, written by record-app.mjs) and puts the new take in its place, the old one moved to
// old/ (as <clip>-<time>.mp4).
//   node lab/clip-reroll.mjs [folder, default ~/Videos/rdui-examples]
// A colour re-roll rolls 🎲 again, kept apart from the take's colours (and from the takes it has replaced); a seed
// re-roll keeps the take's colours (its saved look; a take without one gets new colours) and starts the rule over (rules
// that seed at random start differently). Either way the clip keeps the start, slowed to fill the clip if the pattern
// settles early (record-app's fit). The queue is rerolls.json in the folder: [{ name, kind, state }],
// state queued, recording, done or failed. Recordings share the GPU's slots with other recorders (lab/gpu-slot.sh).
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync, spawnSync } from 'child_process';

const dir = path.resolve(process.argv[2] ?? path.join(os.homedir(), 'Videos', 'rdui-examples'));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const queueFile = path.join(dir, 'rerolls.json');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
// (the page appends to the queue as this works through it: re-read it for every change)
const update = (at, change) => {
  const q = readJson(queueFile, []);
  const job = q.find((j) => j.at === at);
  if (job) Object.assign(job, change);
  fs.writeFileSync(queueFile, JSON.stringify(q, null, 1));
};
const meanColour = (f) => [...execFileSync('ffmpeg', ['-v', 'error', '-sseof', '-0.5', '-i', f, '-frames:v', '1', '-vf', 'scale=1:1:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];

console.log(`re-rolls for ${dir}`);
for (;;) {
  const job = readJson(queueFile, []).find((j) => j.state === 'queued');
  if (!job) { await new Promise((r) => setTimeout(r, 5000)); continue; }
  const clip = path.join(dir, job.name), base = job.name.replace(/\.mp4$/, '');
  const recipe = readJson(path.join(dir, '.recipes', base + '.json'), null);
  if (!recipe || !fs.existsSync(clip)) { update(job.at, { state: 'failed', why: recipe ? 'no clip' : 'no recipe' }); continue; }
  update(job.at, { state: 'recording' });
  console.log(job.kind, job.name);
  const { look, ...cfgRest } = { ...recipe.cfg, look: recipe.look };
  // (older takes recorded on from a grown field, cutting off the start: start over instead)
  const { restart: _r, diceWarm: _d, warm: _w, ...cfgStart } = cfgRest;
  const cfg = { ...cfgStart, fit: true };
  // the colours to stay apart from: this take's and those it replaced
  const avoid = [meanColour(clip), ...(recipe.replaced ?? [])];
  const custom = !cfg.palette;
  if (job.kind === 'colour' && custom) Object.assign(cfg, { dice: 1, avoid, tries: 25 });
  if (job.kind === 'seed' && !cfg.palette) Object.assign(cfg, look?.custom ? { dice: 0, look } : { dice: 1 });
  const tmp = path.join(dir, '.reroll-' + job.name);
  const r = spawnSync('lab/gpu-slot.sh', [dir, 'node', 'lab/record-app.mjs', recipe.id, tmp, JSON.stringify(cfg)], { cwd: root, encoding: 'utf8', timeout: 1800000 });
  if (r.status !== 0 || !fs.existsSync(tmp)) { update(job.at, { state: 'failed', why: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|lost/.test(l)).pop()?.slice(0, 160) ?? 'no video' }); continue; }
  fs.mkdirSync(path.join(dir, 'old'), { recursive: true });
  fs.renameSync(clip, path.join(dir, 'old', `${base}-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`));
  fs.renameSync(tmp, clip);
  // record-app wrote the new take's recipe under the temporary name: move it into place, remembering the colours replaced
  const tmpRecipe = path.join(dir, '.recipes', '.reroll-' + base + '.json');
  const fresh = readJson(tmpRecipe, recipe);
  fresh.replaced = avoid;
  fs.writeFileSync(path.join(dir, '.recipes', base + '.json'), JSON.stringify(fresh, null, 1));
  fs.rmSync(tmpRecipe, { force: true });
  update(job.at, { state: 'done' });
  console.log('done', job.name);
}
