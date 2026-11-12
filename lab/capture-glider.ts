// Settle the starter glider rotated onto the x axis and capture it as an
// axis-locked starter stamp.
import { GS_HISTORY_WAVE } from '../src/rule';
import { rotateStampBy, stampToJSON } from '../src/stamps';
import { makeLab, glider, blobs, capture, log } from './lab';

export default async function () {
  const lab = await makeLab(GS_HISTORY_WAVE, 512);
  lab.place(rotateStampBy(glider(), -8), 100, 256);
  await lab.run(8000);
  const [b] = blobs((await lab.read()).state, 512, lab.layout.S, 1, 0.2);
  log('glider at', b);
  const s = await capture(lab, b.x, b.y, 24, 24, 'starter-glider-hw-axis', 'HW glider → (axis)');
  await window.__saveText('glider-axis.json', JSON.stringify(stampToJSON(s)));
  // verify the captured stamp heads along the axis
  const v = await makeLab(GS_HISTORY_WAVE, 512);
  v.place(s, 100, 256);
  await v.run(1000);
  const p0 = blobs((await v.read()).state, 512, v.layout.S, 1, 0.2)[0];
  await v.run(10000);
  const p1 = blobs((await v.read()).state, 512, v.layout.S, 1, 0.2)[0];
  log('captured stamp: from', p0, 'to', p1, 'heading', ((Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI).toFixed(2));
}
