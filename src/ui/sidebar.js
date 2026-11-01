import { h, btn, icon, hint, openMenu, openModal, confirmBox, alertBox } from './dom.js';
import { startDrag } from './dnd.js';
import { makeChannel, defaultParams } from '../store.js';
import { CATALOG, CATEGORIES } from '../audio/catalog.js';
import { listProjects, deleteProject } from '../persist.js';
import { listSamples, importFiles, deleteSamples, onSamplesChange } from '../samples.js';
import { addChannel } from './rack.js';

const PREVIEW_KEY = { drums: 60, bass: 36, keys: 60, synth: 60, strings: 55, winds: 67, mallets: 72 };

// FL Studio style browser: a tree beside the editors. Items can be dragged
// onto the playlist, the piano roll or the channel rack.
export function createSidebar(engine, actions) {
  const open = new Set(['samples', 'builtin']);
  const search = h('input', { class: 'input side-search', type: 'search', placeholder: 'Rechercher', 'aria-label': 'Rechercher dans le navigateur', onInput: () => build() });
  const tree = h('div', { class: 'side-tree', role: 'tree' });
  const el = h('aside', { class: 'sidebar', 'aria-label': 'Navigateur' },
    h('div', { class: 'side-head' },
      h('span', { class: 'ptitle' }, 'Navigateur'),
      btn('Upload', 'Importer des samples ou un pack ZIP', () => importDialog()),
      btn('ChevronLeft', 'Fermer le navigateur', () => actions.toggleSidebar(false), 'ghost'),
    ),
    h('div', { class: 'side-search-wrap' }, search),
    tree,
  );
  const previewChannels = new Map();

  function previewInstrument(inst) {
    let c = previewChannels.get(inst.id);
    if (!c) {
      c = makeChannel(inst.id, inst.name, 0);
      c.id = '__preview_' + inst.id;
      c.params = defaultParams();
      previewChannels.set(inst.id, c);
    }
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
    const v = engine.noteOn(c, PREVIEW_KEY[inst.cat] || 60, 0.8);
    setTimeout(() => engine.noteOff(v), inst.cat === 'drums' ? 50 : 700);
  }

  // Row with tap (preview or open) and drag (horizontal move or long press).
  function itemRow({ label, iconName, depth, item, onTap, onMenu, extra }) {
    const row = h('div', { class: 'side-row item', role: 'treeitem', style: { paddingLeft: 8 + depth * 14 + 'px' } },
      icon(iconName, 14), h('span', { class: 'side-label' }, label), extra || null,
      onMenu ? h('button', { class: 'side-more', type: 'button', title: 'Actions', 'aria-label': 'Actions', onClick: (e) => { e.stopPropagation(); onMenu(e.currentTarget); } }, icon('Menu', 14)) : null,
    );
    let st = null;
    row.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.side-more')) return;
      st = { x: e.clientX, y: e.clientY, id: e.pointerId, lp: null };
      if (item) {
        st.lp = setTimeout(() => {
          if (st) {
            startDrag(item, e);
            st = null;
          }
        }, 380);
      }
    });
    row.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id) return;
      const dx = e.clientX - st.x;
      const dy = e.clientY - st.y;
      if (Math.hypot(dx, dy) < 8) return;
      clearTimeout(st.lp);
      if (item && Math.abs(dx) > Math.abs(dy)) {
        e.preventDefault();
        startDrag(item, e);
      }
      st = null;
    });
    const stop = (e) => {
      if (!st) return;
      clearTimeout(st.lp);
      const tap = e.type === 'pointerup';
      st = null;
      if (tap && onTap) onTap();
    };
    row.addEventListener('pointerup', stop);
    row.addEventListener('pointercancel', stop);
    return row;
  }

  function folderRow(key, label, depth, count, onMenu) {
    const isOpen = open.has(key);
    return h('div', { class: 'side-row folder', role: 'treeitem', 'aria-expanded': String(isOpen), style: { paddingLeft: 4 + depth * 14 + 'px' }, onClick: (e) => {
      if (e.target.closest('.side-more')) return;
      if (isOpen) open.delete(key);
      else open.add(key);
      build();
    } },
      icon(isOpen ? 'ChevronDown' : 'ChevronRight', 14), icon('FolderOpen', 14), h('span', { class: 'side-label' }, label),
      count != null ? h('span', { class: 'side-count' }, String(count)) : null,
      onMenu ? h('button', { class: 'side-more', type: 'button', title: 'Actions', 'aria-label': 'Actions', onClick: (e) => { e.stopPropagation(); onMenu(e.currentTarget); } }, icon('Menu', 14)) : null,
    );
  }

  function sampleTree(samples, q) {
    // Group by folder path.
    const root = { folders: new Map(), items: [] };
    for (const s of samples) {
      let node = root;
      for (const part of (s.folder || 'Importés').split('/')) {
        if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), items: [] });
        node = node.folders.get(part);
      }
      node.items.push(s);
    }
    const rows = [];
    const count = (node) => node.items.length + [...node.folders.values()].reduce((a, n) => a + count(n), 0);
    const ids = (node) => [...node.items.map((s) => s.id), ...[...node.folders.values()].flatMap(ids)];
    const walk = (node, path, depth) => {
      for (const [name, child] of [...node.folders.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'))) {
        const key = 'samples/' + path + name;
        rows.push(folderRow(key, name, depth, count(child), (anchor) => openMenu(anchor, [
          { label: 'Supprimer ce dossier', icon: 'Trash', onClick: async () => {
            const list = ids(child);
            if (await confirmBox('Supprimer des samples', list.length + ' sample(s) du dossier « ' + name + ' » seront supprimés de cet appareil. Les canaux et clips qui les utilisent deviendront muets.', 'Supprimer')) deleteSamples(list);
          } },
        ])));
        if (q || open.has(key)) walk(child, path + name + '/', depth + 1);
      }
      for (const s of node.items) {
        rows.push(itemRow({
          label: s.name,
          iconName: 'AudioWaveform',
          depth,
          item: { kind: 'sample', id: s.id, name: s.name },
          onTap: () => engine.previewSample(s.id),
          extra: h('span', { class: 'side-count' }, s.duration ? s.duration.toFixed(1).replace('.', ',') + ' s' : ''),
          onMenu: (anchor) => openMenu(anchor, [
            { label: 'Écouter', icon: 'Play', onClick: () => engine.previewSample(s.id) },
            { label: 'Ajouter au rack', icon: 'Plus', onClick: () => actions.addSampler(s.id) },
            { label: 'Supprimer', icon: 'Trash', onClick: async () => {
              if (await confirmBox('Supprimer le sample', '« ' + s.name + ' » sera supprimé de cet appareil.', 'Supprimer')) deleteSamples([s.id]);
            } },
          ]),
        }));
      }
    };
    walk(root, '', 1);
    return rows;
  }

  function build() {
    const q = search.value.trim().toLowerCase();
    const match = (name) => !q || name.toLowerCase().includes(q);
    const rows = [];

    const projects = listProjects().filter((p) => match(p.name));
    rows.push(folderRow('projects', 'Projets', 0, projects.length));
    if (q || open.has('projects')) {
      if (!projects.length) rows.push(h('div', { class: 'side-empty' }, 'Aucun projet enregistré'));
      for (const pr of projects) {
        rows.push(itemRow({
          label: pr.name, iconName: 'FileText', depth: 1,
          onTap: () => actions.openProject(pr.name),
          onMenu: (anchor) => openMenu(anchor, [
            { label: 'Ouvrir', icon: 'FolderOpen', onClick: () => actions.openProject(pr.name) },
            { label: 'Supprimer', icon: 'Trash', onClick: async () => {
              if (await confirmBox('Supprimer le projet', 'Le projet « ' + pr.name + ' » sera supprimé de cet appareil.', 'Supprimer')) {
                deleteProject(pr.name);
                build();
              }
            } },
          ]),
        }));
      }
    }

    const samples = listSamples().filter((s) => match(s.name) || match(s.folder));
    rows.push(folderRow('samples', 'Mes samples', 0, samples.length));
    if (q || open.has('samples')) {
      if (!listSamples().length) {
        rows.push(h('div', { class: 'side-empty' }, 'Importez des fichiers audio ou un pack ZIP avec le bouton d’import en haut.'));
      } else rows.push(...sampleTree(samples, q));
    }

    rows.push(folderRow('builtin', 'Sons intégrés', 0, CATALOG.length));
    if (q || open.has('builtin')) {
      for (const cat of CATEGORIES) {
        const insts = CATALOG.filter((x) => x.cat === cat.id && match(x.name));
        if (!insts.length) continue;
        const key = 'builtin/' + cat.id;
        rows.push(folderRow(key, cat.name, 1, insts.length));
        if (q || open.has(key)) {
          for (const inst of insts) {
            rows.push(itemRow({
              label: inst.name, iconName: cat.icon, depth: 2,
              item: { kind: 'instrument', id: inst.id, name: inst.name },
              onTap: () => previewInstrument(inst),
              onMenu: (anchor) => openMenu(anchor, [
                { label: 'Écouter', icon: 'Play', onClick: () => previewInstrument(inst) },
                { label: 'Ajouter au rack', icon: 'Plus', onClick: () => addChannel(inst.id, engine) },
              ]),
            }));
          }
        }
      }
    }
    tree.replaceChildren(...rows);
  }

  function importDialog() {
    const input = h('input', { type: 'file', multiple: true });
    input.addEventListener('change', async () => {
      const files = [...(input.files || [])];
      if (!files.length) return;
      const status = h('p', null, 'Import en cours...');
      const m = openModal({ title: 'Import', body: status, actions: [] });
      try {
        const r = await importFiles(files, (done, total) => { status.textContent = 'Import en cours : ' + done + ' / ' + total; });
        m.close();
        open.add('samples');
        build();
        if (r.added) hint(r.added + ' sample(s) importé(s)');
        if (r.skipped) alertBox('Import', r.added + ' sample(s) importé(s). ' + r.skipped + ' fichier(s) ignoré(s) : format non reconnu ou fichier illisible.');
        else if (!r.added) alertBox('Import', 'Aucun fichier audio trouvé.');
      } catch (e) {
        m.close();
        alertBox('Import impossible', String((e && e.message) || e));
      }
    });
    input.click();
  }

  onSamplesChange(() => build());
  build();
  return { el, refresh: build };
}
