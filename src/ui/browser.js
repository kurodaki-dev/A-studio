import { h, btn, icon, hint, confirmBox } from './dom.js';
import { store, makeChannel, defaultParams } from '../store.js';
import { CATALOG, CATEGORIES } from '../audio/catalog.js';
import { listProjects, deleteProject } from '../persist.js';
import { addChannel } from './rack.js';

const PREVIEW_KEY = { drums: 60, bass: 36, keys: 60, synth: 60, strings: 55, winds: 67, mallets: 72 };

export function createBrowser(engine, actions) {
  const body = h('div', { class: 'browser-body' });
  const el = h('div', { class: 'panel browser' },
    h('div', { class: 'ptools' }, h('div', { class: 'grp' }, h('span', { class: 'ptitle' }, 'Navigateur'), h('span', { class: 'rack-info' }, 'Touchez un son pour l’écouter, puis ajoutez le au rack'))),
    h('div', { class: 'browser-scroll' }, body),
  );
  const previewChannels = new Map();
  let sig = null;

  function previewChannel(id) {
    if (!previewChannels.has(id)) {
      const c = makeChannel(id, id, 0);
      c.id = '__preview_' + id;
      c.params = defaultParams();
      previewChannels.set(id, c);
    }
    return previewChannels.get(id);
  }

  function playPreview(inst) {
    // Preview channels are not part of the project: route them straight to master.
    const c = previewChannel(inst.id);
    engine.init();
    if (!engine.G.channels.has(c.id)) {
      const ctx = engine.ctx;
      const ch = { in: ctx.createGain(), filt: ctx.createBiquadFilter(), pan: ctx.createStereoPanner(), insert: 0 };
      ch.in.gain.value = 0.78;
      ch.filt.frequency.value = 20000;
      ch.in.connect(ch.filt);
      ch.filt.connect(ch.pan);
      ch.pan.connect(engine.G.inserts[0].in);
      engine.G.channels.set(c.id, ch);
    }
    const key = PREVIEW_KEY[inst.cat] || 60;
    const v = engine.noteOn(c, key, 0.8);
    setTimeout(() => engine.noteOff(v), inst.cat === 'drums' ? 50 : 700);
  }

  function build() {
    const sections = CATEGORIES.map((cat) =>
      h('section', { class: 'bsec' },
        h('h3', null, icon(cat.icon, 16), cat.name),
        CATALOG.filter((x) => x.cat === cat.id).map((inst) =>
          h('div', { class: 'brow' },
            h('button', { class: 'brow-name', type: 'button', onClick: () => playPreview(inst) }, icon('Play', 14), inst.name),
            btn('Plus', 'Ajouter ' + inst.name + ' au rack', () => addChannel(inst.id, engine)),
          ),
        ),
      ),
    );
    const projects = listProjects();
    const projSec = h('section', { class: 'bsec' },
      h('h3', null, icon('FolderOpen', 16), 'Projets enregistrés'),
      projects.length
        ? projects.map((pr) =>
            h('div', { class: 'brow' },
              h('button', { class: 'brow-name', type: 'button', onClick: () => actions.openProject(pr.name) }, icon('FileText', 14), pr.name,
                h('span', { class: 'brow-date' }, new Date(pr.savedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))),
              btn('Trash', 'Supprimer ' + pr.name, async () => {
                if (await confirmBox('Supprimer le projet', 'Le projet « ' + pr.name + ' » sera supprimé de cet appareil.', 'Supprimer')) {
                  deleteProject(pr.name);
                  hint('Projet supprimé');
                  sig = null;
                  update();
                }
              }),
            ),
          )
        : h('p', { class: 'empty' }, 'Aucun projet enregistré sur cet appareil.'),
    );
    body.replaceChildren(projSec, ...sections);
  }

  function update() {
    const s = listProjects().map((p) => p.name + p.savedAt).join('|');
    if (s !== sig) {
      sig = s;
      build();
    }
  }

  return { el, update, refresh: () => { sig = null; update(); } };
}
