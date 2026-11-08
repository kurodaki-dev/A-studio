import { h, btn, icon, openModal, alertBox, confirmBox, dropdown, hint } from './dom.js';
import { t, lang, LANGS, setLang } from '../i18n.js';
import { allThemes, currentTheme, applyTheme, installTheme, removeTheme, themeFile } from '../themes.js';
import { allPlugins, installPlugin, removePlugin } from '../plugins.js';
import { openPluginEditor } from './pluginEditor.js';
import { openGithubInstall } from './githubInstall.js';
import { openCatalog } from './catalog.js';
import { fetchText } from '../github.js';
import { pickFile, saveFile } from '../platform.js';
import { checkForUpdate, updatesSupported, autoCheckEnabled, setAutoCheck, orientationPref, applyOrientation } from '../update.js';
import { openExternal, DOCS_URL, bugReportUrl } from '../links.js';
import { APP_VERSION } from '../version.js';
import { measureLatency } from '../recorder.js';
import { audioBufferMode } from '../audio/engine.js';
import { midiSupported, midiEnabled, setMidiEnabled, midiInputs, onMidiChange } from '../midiin.js';

const safeGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage full or blocked */
  }
};

// Settings window. section: 'general' | 'extensions' scrolls to that part.
// Re-render the open Settings window (an extension changed one of its settings).
let openRender = null;
export function refreshOpenSettings() {
  if (openRender) openRender();
}

// One block per extension that declared settings with astudio.settings.addSection.
function extensionSections(extHost) {
  if (!extHost) return [];
  return extHost.settingsSections().map((sec) =>
    h('section', { class: 'set-sec ext-set', id: 'set-ext-' + sec.id },
      h('h3', null, icon('Puzzle', 16), sec.title, h('small', { class: 'ext-set-from' }, sec.plugin)),
      sec.description ? h('p', { class: 'set-note' }, sec.description) : null,
      sec.fields.map((f) => {
        const change = (v) => extHost.changeSetting(sec.id, f.id, v);
        if (f.type === 'toggle') {
          return h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, h('span', null, f.label)),
            h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!f.value, onChange: (e) => change(e.target.checked) }), h('span', null, f.value ? t('On') : t('Off'))));
        }
        if (f.type === 'button') {
          return h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, h('span', null, f.label)),
            h('button', { class: 'b tb', type: 'button', onClick: () => change(null) }, f.label));
        }
        if (f.type === 'info') {
          return h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, h('span', null, f.label)), h('span', { class: 'ext-set-info' }, String(f.value || '')));
        }
        const input = h('input', { class: 'input', type: f.type === 'password' ? 'password' : 'text', value: String(f.value || ''), placeholder: f.placeholder, autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': f.label, onChange: (e) => change(e.target.value) });
        return h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, h('span', null, f.label)), h('div', { class: 'set-control ext-set-input' }, input));
      }),
    ),
  );
}

export function openSettings({ section = 'general', onExtensionsChange, engine, extHost } = {}) {
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
        onExtensionsChange && onExtensionsChange();
      }
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
      engine,
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
        updatesSupported() ? row(t('Screen orientation'), dropdown({ label: t('Screen orientation'), value: orientationPref(), options: [{ value: 'landscape', label: t('Landscape') }, { value: 'auto', label: t('Automatic (portrait allowed)') }], onChange: (v) => applyOrientation(v) })) : null,
        row(t('Audio quality'), dropdown({ label: t('Audio quality'), value: audioBufferMode(), options: [{ value: 'stable', label: t('Stable (no crackles)') }, { value: 'fast', label: t('Low latency') }], onChange: (v) => { safeSet('astudio:audiobuf', v); hint(t('Restart the app to apply.')); } }), t('Stable avoids crackles and stutters when playback starts on tablets. Low latency answers faster when you play live, but can crackle on slow devices.')),
        row(t('Recording latency'), h('div', { class: 'set-inline' },
          h('input', { class: 'input latency-input', type: 'number', min: 0, max: 500, step: 1, value: Number(safeGet('astudio:latency') || 0), 'aria-label': t('Recording latency'), onChange: (e) => {
            const v = Math.max(0, Math.min(500, Math.round(Number(e.target.value) || 0)));
            safeSet('astudio:latency', String(v));
          } }),
          h('span', null, 'ms'),
          h('button', { class: 'b tb', type: 'button', onClick: async (e) => {
            if (!engine) return;
            const b = e.currentTarget;
            b.disabled = true;
            hint(t('Measuring: keep the phone quiet, speaker on, no headphones...'));
            try {
              engine.init();
              const ms = await measureLatency(engine.ctx);
              safeSet('astudio:latency', String(Math.max(0, Math.min(500, ms))));
              hint(t('Recording latency: ') + ms + ' ms');
              render();
            } catch (err) {
              alertBox(t('Recording latency'), String((err && err.message) || err));
            }
            b.disabled = false;
          } }, t('Measure')),
        ), t('Takes are moved earlier by this time so they sit on the beat. Measure plays clicks and records them: use the speaker, not headphones.')),
        row(t('Metronome volume'), h('input', { type: 'range', class: 'range', min: 0, max: 1, step: 0.05, value: engine ? engine.metroVol : 0.5, 'aria-label': t('Metronome volume'), onInput: (e) => {
          if (!engine) return;
          engine.metroVol = Number(e.target.value);
          try {
            localStorage.setItem('astudio:metrovol', String(engine.metroVol));
          } catch {
            /* ignore */
          }
        } })),
        row(t('MIDI keyboard'), midiSupported()
          ? h('div', { class: 'set-inline' },
              h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: midiEnabled(), onChange: (e) => { setMidiEnabled(e.target.checked); render(); } }), h('span', null, midiEnabled() ? t('On') : t('Off'))),
              h('span', { class: 'ext-set-info' }, midiInputs().length ? midiInputs().map((i) => i.name).join(', ') : t('No MIDI device connected')),
            )
          : h('span', { class: 'ext-set-info' }, t('Not supported on this device')),
          t('Connect a USB MIDI keyboard: it plays the channel open in the piano roll and records when recording is armed.')),
      ),
      ...extensionSections(extHost),
      h('section', { class: 'set-sec', id: 'set-themes' },
        h('h3', null, icon('Palette', 16), t('Themes')),
        h('div', { class: 'set-list' }, themes.map((th) =>
          h('div', { class: 'set-item' + (currentTheme().id === th.id ? ' on' : '') },
            h('span', { class: 'swatches' }, ['bg', 'panel', 'accent', 'green'].map((k) => h('i', { style: { background: th.colors[k] } }))),
            h('button', { class: 'set-item-name', type: 'button', onClick: () => { applyTheme(th.id); render(); } }, th.name, th.builtIn ? h('small', null, t('built in')) : th.author ? h('small', null, th.author) : null),
            // Export: the theme file, to share it or as a start for a new theme.
            btn('Download', t('Export'), () => {
              const id = th.builtIn ? 'my-' + th.id : th.id;
              const name = th.builtIn ? th.name + ' ' + t('copy') : th.name;
              saveFile(id + '.astudio-theme.json', themeFile(th, id, name), 'application/json').catch((e) => alertBox(t('Export'), String((e && e.message) || e)));
            }),
            th.builtIn ? null : btn('Trash', t('Delete'), async () => {
              if (await confirmBox(t('Delete theme'), th.name, t('Delete'))) {
                removeTheme(th.id);
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
  onMidiChange(() => { if (body.isConnected) render(); });
  openRender = () => {
    if (!body.isConnected) {
      openRender = null;
      return;
    }
    const y = body.parentElement ? body.parentElement.scrollTop : 0;
    render();
    if (body.parentElement) body.parentElement.scrollTop = y;
  };
  if (section === 'extensions') setTimeout(() => body.querySelector('#set-themes')?.scrollIntoView({ block: 'start' }), 0);
  return m;
}
