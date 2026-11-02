import { h, icon, openModal } from './dom.js';
import { t } from '../i18n.js';
import { findFiles, fetchText } from '../github.js';
import { installPlugin } from '../plugins.js';
import { installTheme, applyTheme } from '../themes.js';

// Install one file found on GitHub. Returns a short description.
export async function installFromGithub(file) {
  const text = await fetchText(file.url);
  if (file.kind === 'theme') {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(t('This file is not valid JSON.'));
    }
    const th = installTheme(raw);
    applyTheme(th.id);
    return th.name;
  }
  return installPlugin(text, file.url).name;
}

export function openGithubInstall({ onInstalled } = {}) {
  const input = h('input', { class: 'input', type: 'url', placeholder: 'https://github.com/user/repo', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('GitHub link') });
  const status = h('div', { class: 'editor-status', role: 'status' });
  const list = h('div', { class: 'set-list' });
  const show = (msg, ok) => {
    status.textContent = msg;
    status.classList.toggle('ok', ok === true);
    status.classList.toggle('err', ok === false);
  };

  async function install(file, btn) {
    btn.disabled = true;
    try {
      const name = await installFromGithub(file);
      btn.textContent = t('Installed');
      show(t('Installed: ') + name, true);
      onInstalled && onInstalled();
    } catch (e) {
      btn.disabled = false;
      show(file.name + ': ' + String((e && e.message) || e), false);
    }
  }

  async function search() {
    list.replaceChildren();
    show(t('Searching...'));
    try {
      const files = await findFiles(input.value);
      show(files.length + ' ' + t('file(s) found'), true);
      const buttons = [];
      for (const f of files) {
        const b = h('button', { class: 'b tb', type: 'button', onClick: () => install(f, b) }, icon('Download', 16), t('Install'));
        buttons.push([f, b]);
        list.append(h('div', { class: 'set-item' },
          icon(f.kind === 'theme' ? 'Palette' : 'Puzzle', 16),
          h('span', { class: 'set-item-name static' }, f.name, h('small', null, f.path)),
          b));
      }
      if (files.length > 1) {
        list.append(h('div', { class: 'set-actions' }, h('button', { class: 'b tb primary', type: 'button', onClick: async () => {
          for (const [f, b] of buttons) if (!b.disabled) await install(f, b);
        } }, t('Install all'))));
      }
    } catch (e) {
      show(String((e && e.message) || e), false);
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') search();
  });
  openModal({
    title: t('Install from GitHub'),
    wide: true,
    body: h('div', { class: 'form' },
      h('p', { class: 'set-note' }, t('Paste the link of a public GitHub repository, folder or file. A Studio looks for files ending with .astudio-plugin.js (plugins) or .astudio-theme.json (themes), at the link and in a plugins folder.')),
      h('div', { class: 'gh-row' }, input, h('button', { class: 'b tb primary', type: 'button', onClick: search }, icon('Search', 16), t('Find'))),
      status,
      list,
    ),
  });
  setTimeout(() => input.focus(), 0);
}
