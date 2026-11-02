import { h, btn, icon, openModal, alertBox, confirmBox, dropdown, hint } from './dom.js';
import { t, lang, LANGS, setLang } from '../i18n.js';
import { allThemes, currentTheme, applyTheme, installTheme, removeTheme } from '../themes.js';
import { allPlugins, installPlugin, removePlugin } from '../plugins.js';
import { openPluginEditor } from './pluginEditor.js';
import { openGithubInstall } from './githubInstall.js';
import { openCatalog } from './catalog.js';
import { fetchText } from '../github.js';
import { pickFile } from '../platform.js';
import { checkForUpdate, updatesSupported, autoCheckEnabled, setAutoCheck } from '../update.js';
import { openExternal, DOCS_URL, bugReportUrl } from '../links.js';
import { APP_VERSION } from '../version.js';

// Settings window. section: 'general' | 'extensions' scrolls to that part.
export function openSettings({ section = 'general', onExtensionsChange, engine } = {}) {
  const body = h('div', { class: 'settings' });
  const m = openModal({ title: t('Settings'), body, wide: true });

  async function importFile(kind) {
    const text = await pickFile();
    if (!text) return;
    try {
      if (kind === 'theme') {
        let raw;
        try {
          raw = JSON.parse(text);
        } catch {
          alertBox(t('Install failed'), t('This file is not valid JSON.'));
          return;
        }
        const th = installTheme(raw);
        applyTheme(th.id);
        hint(t('Theme installed: ') + th.name);
      } else {
        const p = installPlugin(text);
        hint(t('Plugin installed: ') + p.name);
      }
      onExtensionsChange && onExtensionsChange();
      render();
    } catch (e) {
      alertBox(t('Install failed'), String((e && e.message) || e));
    }
  }

  async function updateFromSource(p) {
    try {
      const code = await fetchText(p.source);
      const updated = installPlugin(code, p.source);
      hint(t('Updated: ') + updated.name + ' ' + updated.version);
      onExtensionsChange && onExtensionsChange();
      render();
    } catch (e) {
      alertBox(t('Update failed'), String((e && e.message) || e));
    }
  }

  function editor(code) {
    openPluginEditor({
      code,
      onInstalled: () => {
        onExtensionsChange && onExtensionsChange();
        render();
      },
      onTry: (p) => engine && engine.previewInstrument('plugin:' + p.id, [60, 64, 67], 0.8),
    });
  }

  function row(label, control, help) {
    return h('div', { class: 'set-row' },
      h('div', { class: 'set-label' }, h('span', null, label), help ? h('small', null, help) : null),
      h('div', { class: 'set-control' }, control),
    );
  }

  function render() {
    const themes = allThemes();
    const plugins = allPlugins();
    body.replaceChildren(
      h('section', { class: 'set-sec', id: 'set-general' },
        h('h3', null, icon('Settings', 16), t('General')),
        row(t('Language'), dropdown({ label: t('Language'), value: lang, options: LANGS.map((l) => ({ value: l.id, label: l.name })), onChange: (v) => { if (v !== lang) setLang(v); } }), t('The app reloads to apply the language.')),
        updatesSupported()
          ? row(t('Updates'), h('div', { class: 'set-inline' },
              h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: autoCheckEnabled(), onChange: (e) => setAutoCheck(e.target.checked) }), h('span', null, t('Check at startup'))),
              h('button', { class: 'b tb', type: 'button', onClick: () => checkForUpdate({ silent: false }) }, t('Check now')),
            ), t('Installed version: ') + APP_VERSION)
          : row(t('Version'), h('span', null, APP_VERSION)),
      ),
      h('section', { class: 'set-sec', id: 'set-themes' },
        h('h3', null, icon('Palette', 16), t('Themes')),
        h('div', { class: 'set-list' }, themes.map((th) =>
          h('div', { class: 'set-item' + (currentTheme().id === th.id ? ' on' : '') },
            h('span', { class: 'swatches' }, ['bg', 'panel', 'accent', 'green'].map((k) => h('i', { style: { background: th.colors[k] } }))),
            h('button', { class: 'set-item-name', type: 'button', onClick: () => { applyTheme(th.id); onExtensionsChange && onExtensionsChange(); render(); } }, th.name, th.builtIn ? h('small', null, t('built in')) : th.author ? h('small', null, th.author) : null),
            th.builtIn ? null : btn('Trash', t('Delete'), async () => {
              if (await confirmBox(t('Delete theme'), th.name, t('Delete'))) {
                removeTheme(th.id);
                onExtensionsChange && onExtensionsChange();
                render();
              }
            }),
          ),
        )),
        h('div', { class: 'set-actions' },
          h('button', { class: 'b tb', type: 'button', onClick: () => importFile('theme') }, icon('Upload', 16), t('Install a theme')),
        ),
      ),
      h('section', { class: 'set-sec', id: 'set-plugins' },
        h('h3', null, icon('Puzzle', 16), t('Plugins')),
        h('p', { class: 'set-note' }, t('Instruments and effects run only in the audio thread. Extensions run in an isolated frame and can only use the permissions they declare. None of them can read your files or other app data. Install plugins from people you trust.')),
        plugins.length
          ? h('div', { class: 'set-list' }, plugins.map((p) =>
              h('div', { class: 'set-item' },
                icon(p.type === 'effect' ? 'AudioWaveform' : p.type === 'extension' ? 'Puzzle' : 'AudioLines', 16),
                h('span', { class: 'set-item-name static' }, p.name,
                  h('small', null, [p.type === 'effect' ? t('effect') : p.type === 'extension' ? t('extension') : t('instrument'), p.version, p.author].filter(Boolean).join(' · ')),
                  p.type === 'extension' ? h('small', null, t('Permissions: ') + (p.permissions.length ? p.permissions.join(', ') : t('none'))) : null),
                p.source ? btn('RefreshCw', t('Update from GitHub'), () => updateFromSource(p)) : null,
                btn('Pencil', t('Edit'), () => editor(p.code)),
                btn('Trash', t('Delete'), async () => {
                  if (await confirmBox(t('Delete plugin'), p.name + '. ' + t('Channels using it will go silent.'), t('Delete'))) {
                    removePlugin(p.id);
                    onExtensionsChange && onExtensionsChange();
                    render();
                  }
                }),
              ),
            ))
          : h('p', { class: 'empty' }, t('No plugin installed. A plugin is a JavaScript file that generates the sound of an instrument; see the documentation to write one.')),
        h('div', { class: 'set-actions' },
          h('button', { class: 'b tb', type: 'button', onClick: () => importFile('plugin') }, icon('Upload', 16), t('Install a plugin')),
          h('button', { class: 'b tb primary', type: 'button', onClick: () => openCatalog({ onInstalled: () => { onExtensionsChange && onExtensionsChange(); render(); } }) }, icon('Search', 16), t('Browse the catalog')),
          h('button', { class: 'b tb', type: 'button', onClick: () => openGithubInstall({ onInstalled: () => { onExtensionsChange && onExtensionsChange(); render(); } }) }, icon('GitBranch', 16), t('Install from GitHub')),
          h('button', { class: 'b tb', type: 'button', onClick: () => editor() }, icon('Pencil', 16), t('Write a plugin')),
          h('button', { class: 'b tb', type: 'button', onClick: () => openExternal(DOCS_URL + '#plugins') }, icon('BookOpen', 16), t('How to create plugins and themes')),
        ),
      ),
      h('section', { class: 'set-sec', id: 'set-help' },
        h('h3', null, icon('Info', 16), t('Help')),
        h('div', { class: 'set-actions' },
          h('button', { class: 'b tb', type: 'button', onClick: () => openExternal(DOCS_URL) }, icon('BookOpen', 16), t('Documentation')),
          h('button', { class: 'b tb', type: 'button', onClick: () => openExternal(bugReportUrl()) }, icon('Bug', 16), t('Report a bug')),
        ),
      ),
    );
  }
  render();
  if (section === 'extensions') setTimeout(() => body.querySelector('#set-themes')?.scrollIntoView({ block: 'start' }), 0);
  return m;
}
