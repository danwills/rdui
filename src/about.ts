/**
 * The About box: what rdui is, who made it, its licence (GPL-3.0-or-later), where its source is, and credits for the
 * third-party work it includes (as NOTICE lists them). A native <dialog>: Esc or a click outside it closes it.
 */
import { el } from './ui';

export const SOURCE_URL = 'https://github.com/danwills/rdui';

const link = (href: string, text: string) => el('a', { href, target: '_blank', rel: 'noopener' }, text);

let dialog: HTMLDialogElement | null = null;

export function showAbout() {
  if (!dialog) {
    // (the content in an inner box, so a click on the dialog itself is a click on the backdrop)
    dialog = el('dialog', { class: 'about' }, el('div', {},
      el('h1', {}, 'rdui'),
      el('p', { class: 'sub' }, `reaction-diffusion sandbox · ${__BUILD__}`),
      el('p', {}, 'A WebGPU playground for reaction-diffusion and related field rules: run them, paint into them, tune them live, and collect what they grow. Rules are written in ',
        link('https://github.com/GollyGang/ready', 'Ready'), '’s formula language, and Ready .vti patterns can be opened directly.'),
      el('p', {}, 'Made by Dan Wills, with Claude.'),
      el('h2', {}, 'Licence'),
      el('p', {}, 'rdui is free software: you can use, study, share and change it under the ',
        link('https://www.gnu.org/licenses/gpl-3.0.html', 'GNU General Public License'), ', version 3 or (at your option) any later version. It comes with no warranty.'),
      el('p', {}, 'Source code: ', link(SOURCE_URL, SOURCE_URL.replace('https://', ''))),
      el('h2', {}, 'Credits'),
      el('ul', {},
        el('li', {}, link('https://github.com/GollyGang/ready', 'Ready'), ' (GPL-3.0): the formula language and .vti format; the Phyllotaxis rule is ported from its Pennybacker2013 kernel (Pennybacker & Newell, 2013), and some bundled patterns derive from its collection.'),
        el('li', {}, 'Colour maps: ', link('https://colorbrewer2.org', 'ColorBrewer'), ' (Cynthia A. Brewer, Mark Harrower and The Pennsylvania State University; Apache-2.0), inferno (Smith, van der Walt and Firing; CC0), terrain (matplotlib), and the ',
          link('https://colorcet.com', 'CET Perceptually Uniform Colour Maps'), ' (Peter Kovesi; CC BY 4.0).'),
        el('li', {}, link('https://github.com/Vanilagy/mp4-muxer', 'mp4-muxer'), ' (MIT), for video export.')),
      el('form', { method: 'dialog' }, el('button', { autofocus: '' }, 'Close'))));
    // a click on the backdrop (outside the box) closes it too
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog!.close(); });
    document.body.append(dialog);
  }
  dialog.showModal();
}
