import { h, icon, openModal } from './dom.js';
import { t } from '../i18n.js';
import { fetchCatalog } from '../github.js';
import { getPlugin } from '../plugins.js';
import { allThemes } from '../themes.js';
import { installFromGithub } from './githubInstall.js';

const TYPE_ICON = { instrument: 'AudioLines', effect: 'AudioWaveform', extension: 'Puzzle', theme: 'Palette' };

// Plugin catalog: the list in public/plugins/catalog.json of the repository.
export function openCatalog({ onInstalled } = {}) {
  const status = h('div', { class: 'editor-status', role: 'status' }, t('Loading the catalog...'));
  const search = h('input', { class: 'input', type: 'search', placeholder: t('Search'), 'aria-label': t('Search the catalog') });
  const list = h('div', { class: 'set-list' });
  let entries = [];
  let filter = 'all';

  const installed = (e) => (e.kind === 'theme' ? allThemes().some((x) => x.id === e.id) : !!getPlugin(e.id));
  const tabs = h('div', { class: 'set-actions cat-tabs' });

  function render() {
    tabs.replaceChildren(...['all', 'instrument', 'effect', 'extension', 'theme'].map((k) => h('button', { class: 'b tb' + (filter === k ? ' on' : ''), type: 'button', onClick: () => { filter = k; render(); } }, k === 'all' ? t('All') : t(k === 'theme' ? 'Themes' : k[0].toUpperCase() + k.slice(1) + 's'))));
    const q = search.value.trim().toLowerCase();
    const shown = entries.filter((e) => (filter === 'all' || e.type === filter) && (!q || (e.name + ' ' + e.description + ' ' + e.author).toLowerCase().includes(q)));
    list.replaceChildren(...shown.map((e) => {
      const b = h('button', { class: 'b tb' + (installed(e) ? '' : ' primary'), type: 'button', onClick: async () => {
        b.disabled = true;
        try {
          const name = await installFromGithub({ kind: e.kind, url: e.url, name: e.name_ });
          status.textContent = t('Installed: ') + name;
          status.className = 'editor-status ok';
          onInstalled && onInstalled();
          render();
        } catch (err) {
          b.disabled = false;
          status.textContent = e.name + ': ' + String((err && err.message) || err);
          status.className = 'editor-status err';
        }
      } }, icon(installed(e) ? 'RefreshCw' : 'Download', 16), installed(e) ? t('Reinstall') : t('Install'));
      return h('div', { class: 'set-item cat-item' },
        icon(TYPE_ICON[e.type] || 'Puzzle', 18),
        h('span', { class: 'set-item-name static' }, e.name, h('small', null, [t(e.type), e.author].filter(Boolean).join(' · ')), h('small', { class: 'cat-desc' }, e.description)),
        b);
    }));
    if (!shown.length && entries.length) list.append(h('p', { class: 'empty' }, t('Nothing matches.')));
  }

  search.addEventListener('input', render);
  openModal({
    title: t('Plugin catalog'),
    wide: true,
    body: h('div', { class: 'form' },
      h('p', { class: 'set-note' }, t('Plugins and themes shared by the community. To add yours, see the plugins folder of the A Studio repository.')),
      search, tabs, status, list),
  });
  fetchCatalog()
    .then((e) => {
      entries = e;
      status.textContent = entries.length + ' ' + t('items');
      status.className = 'editor-status';
      render();
    })
    .catch((err) => {
      status.textContent = t('Could not load the catalog: ') + String((err && err.message) || err);
      status.className = 'editor-status err';
    });
  render();
}
