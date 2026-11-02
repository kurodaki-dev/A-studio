import { h, btn, icon, hint, openMenu, openModal, confirmBox, alertBox } from './dom.js';
import { startDrag } from './dnd.js';
import { CATALOG, CATEGORIES } from '../audio/catalog.js';
import { listProjects, deleteProject } from '../persist.js';
import { listSamples, importFiles, deleteSamples, onSamplesChange } from '../samples.js';
import { addChannel, createChannel } from './rack.js';
import { zonesFromSamples } from '../zones.js';
import { store } from '../store.js';
import { pluginInstruments } from '../plugins.js';
import { t, fmtNum } from '../i18n.js';

const PREVIEW_KEY = { drums: 60, bass: 36, keys: 60, synth: 60, strings: 55, winds: 67, mallets: 72 };

// FL Studio style browser: a tree beside the editors. Items can be dragged
// onto the playlist, the piano roll or the channel rack.
export function createSidebar(engine, actions) {
  const open = new Set(['samples', 'builtin', 'plugins']);
  const search = h('input', { class: 'input side-search', type: 'search', placeholder: t('Search'), 'aria-label': t('Search the browser'), onInput: () => build() });
  const tree = h('div', { class: 'side-tree', role: 'tree' });
  const el = h('aside', { class: 'sidebar', 'aria-label': t('Browser') },
    h('div', { class: 'side-head' },
      h('span', { class: 'ptitle' }, t('Browser')),
      btn('Upload', t('Import samples or a ZIP / RAR pack'), () => importDialog()),
      btn('ChevronLeft', t('Close browser'), () => actions.toggleSidebar(false), 'ghost'),
    ),
    h('div', { class: 'side-search-wrap' }, search),
    tree,
  );

  function previewInstrument(inst) {
    engine.previewInstrument(inst.id, [PREVIEW_KEY[inst.cat] || 60], inst.cat === 'drums' ? 0.05 : 0.7);
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
      for (const part of (s.folder || t('Imported')).split('/')) {
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
          { label: t('Make an instrument from this folder'), icon: 'Piano', onClick: () => {
            const zones = zonesFromSamples(child.items);
            if (!zones.length) {
              alertBox(t('Multi sample instrument'), t('No note found in the file names. Name the samples after their note, for example "Piano C4.wav" or "Piano 60.wav".'));
              return;
            }
            let c = null;
            store.change((p) => {
              c = createChannel(p, 'sampler');
              if (!c) return;
              c.name = name.slice(0, 40);
              c.sample = zones[0].sample;
              c.zones = zones;
            });
            if (c) hint(c.name + ': ' + zones.length + t(' samples mapped to keys.'));
          } },
          { label: t('Delete this folder'), icon: 'Trash', onClick: async () => {
            const list = ids(child);
            if (await confirmBox(t('Delete samples'), list.length + t(' sample(s) from the folder “') + name + t('” will be deleted from this device. Channels and clips using them will go silent.'), t('Delete'))) deleteSamples(list);
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
          extra: h('span', { class: 'side-count' }, s.duration ? fmtNum(s.duration) + ' s' : ''),
          onMenu: (anchor) => openMenu(anchor, [
            { label: t('Preview'), icon: 'Play', onClick: () => engine.previewSample(s.id) },
            { label: t('Add to rack'), icon: 'Plus', onClick: () => actions.addSampler(s.id) },
            { label: t('Delete'), icon: 'Trash', onClick: async () => {
              if (await confirmBox(t('Delete sample'), '« ' + s.name + t('” will be deleted from this device.'), t('Delete'))) deleteSamples([s.id]);
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
    rows.push(folderRow('projects', t('Projects'), 0, projects.length));
    if (q || open.has('projects')) {
      if (!projects.length) rows.push(h('div', { class: 'side-empty' }, t('No saved project')));
      for (const pr of projects) {
        rows.push(itemRow({
          label: pr.name, iconName: 'FileText', depth: 1,
          onTap: () => actions.openProject(pr.name),
          onMenu: (anchor) => openMenu(anchor, [
            { label: t('Open'), icon: 'FolderOpen', onClick: () => actions.openProject(pr.name) },
            { label: t('Delete'), icon: 'Trash', onClick: async () => {
              if (await confirmBox(t('Delete project'), t('Project “') + pr.name + t('” will be deleted from this device.'), t('Delete'))) {
                deleteProject(pr.name);
                build();
              }
            } },
          ]),
        }));
      }
    }

    const samples = listSamples().filter((s) => match(s.name) || match(s.folder));
    rows.push(folderRow('samples', t('My samples'), 0, samples.length));
    if (q || open.has('samples')) {
      if (!listSamples().length) {
        rows.push(h('div', { class: 'side-empty' }, t('Import audio files or a ZIP / RAR pack with the import button above.')));
      } else rows.push(...sampleTree(samples, q));
    }

    const plugins = pluginInstruments().filter((p) => match(p.name));
    if (pluginInstruments().length) {
      rows.push(folderRow('plugins', t('Plugins'), 0, plugins.length));
      if (q || open.has('plugins')) {
        for (const p of plugins) {
          const inst = { id: 'plugin:' + p.id, name: p.name, cat: p.category };
          rows.push(itemRow({
            label: p.name, iconName: 'Puzzle', depth: 1,
            item: { kind: 'instrument', id: inst.id, name: p.name },
            onTap: () => previewInstrument(inst),
            onMenu: (anchor) => openMenu(anchor, [
              { label: t('Preview'), icon: 'Play', onClick: () => previewInstrument(inst) },
              { label: t('Add to rack'), icon: 'Plus', onClick: () => addChannel(inst.id, engine) },
            ]),
          }));
        }
      }
    }

    rows.push(folderRow('builtin', t('Built in sounds'), 0, CATALOG.length));
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
                { label: t('Preview'), icon: 'Play', onClick: () => previewInstrument(inst) },
                { label: t('Add to rack'), icon: 'Plus', onClick: () => addChannel(inst.id, engine) },
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
      const status = h('p', null, t('Importing...'));
      const m = openModal({ title: 'Import', body: status, actions: [] });
      try {
        const r = await importFiles(files, (done, total) => { status.textContent = t('Importing: ') + done + ' / ' + total; });
        m.close();
        open.add('samples');
        build();
        if (r.added) hint(r.added + t(' sample(s) imported'));
        if (r.skipped) alertBox('Import', r.added + t(' sample(s) imported. ') + r.skipped + t(' file(s) skipped: unknown format or unreadable file.'));
        else if (!r.added) alertBox('Import', t('No audio file found.'));
      } catch (e) {
        m.close();
        alertBox(t('Import failed'), String((e && e.message) || e));
      }
    });
    input.click();
  }

  onSamplesChange(() => build());
  build();
  return { el, refresh: build };
}
