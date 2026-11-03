// Browser of A Voice Studio (left panel): voices, projects, plugins and themes, each in
// its own tab. Tap a voice to give it to the current track.
import { h, icon, iconBtn, textBtn, hint, openMenu, confirmBox, alertBox, promptText, pickFiles, openModal } from './dom.js';
import { store } from '../store.js';
import { BUILTIN_VOICES } from '../voices/builtin.js';
import { listVoices, removeVoice, importArchive, addVoicevoxEngine, voiceImage, kv, forgetBanks, downloadCommunityVocoder, COMMUNITY_VOCODER } from '../voices/library.js';
import { DEFAULT_ENGINE } from '../voices/voicevox.js';
import { allPlugins, installPlugin, removePlugin } from '../plugins.js';
import { allThemes, currentTheme, chooseTheme, installTheme, removeTheme } from '../themes.js';
import { clearCache } from '../render.js';
import { t, tErr } from '../i18n.js';

const TYPE_LABEL = {
  builtin: 'Vocoder', utau: 'UTAU', diffsinger: 'DiffSinger', voicevox: 'VOICEVOX', vocoder: 'Vocoder model', humanizer: 'Humanizer model',
};
const TYPE_ICON = { builtin: 'AudioWaveform', utau: 'Mic', diffsinger: 'Sparkles', voicevox: 'Server', vocoder: 'Package', humanizer: 'Bot' };

export function createBrowser({ onProjects, onRunPlugin, onEditPlugin }) {
  let tab = 'voices';
  let vocoderInstalled = false;
  let filter = '';
  const body = h('div', { class: 'br-body' });
  const search = h('input', { class: 'input br-search', placeholder: t('Search'), 'aria-label': t('Search'), onInput: (e) => { filter = e.target.value.toLowerCase(); build(); } });
  const tabsEl = h('div', { class: 'br-tabs', role: 'tablist' });
  const TABS = [['voices', 'Mic', t('Voices')], ['projects', 'FolderOpen', t('Projects')], ['plugins', 'Puzzle', t('Plugins')], ['themes', 'Palette', t('Themes')]];
  for (const [id, ic, label] of TABS) {
    tabsEl.append(h('button', { class: 'br-tab', type: 'button', role: 'tab', 'data-tab': id, title: label, 'aria-label': label, onClick: () => { tab = id; build(); } }, icon(ic, 16), h('span', null, label)));
  }
  const el = h('aside', { class: 'browser' }, tabsEl, search, body);

  async function importVoice() {
    const files = await pickFiles('.zip,.oudep,.onnx,application/zip', true);
    if (!files.length) return;
    const status = h('p', null, t('Reading the archive...'));
    const m = openModal({ title: t('Import a voice'), body: status, actions: [] });
    const added = [];
    try {
      for (const f of files) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const got = await importArchive(f.name, bytes, (done, total, name) => { status.textContent = name + ': ' + done + ' / ' + total; });
        added.push(...got);
      }
      m.close();
      forgetBanks();
      clearCache();
      hint(added.map((v) => v.name + ' (' + TYPE_LABEL[v.type] + ')').join(', ') + ' ' + t('added'));
      const ds = added.find((v) => v.type === 'diffsinger' && !v.bundledVocoder);
      if (ds && !(await listVoices()).some((v) => v.type === 'vocoder')) offerVocoder();
    } catch (e) {
      m.close();
      alertBox(t('Import failed'), tErr((e && e.message) || e));
    }
    build();
  }

  // DiffSinger voices without their own vocoder: download the community one in one tap.
  function offerVocoder() {
    openModal({
      title: t('Vocoder needed'),
      body: h('div', null,
        h('p', null, t('This DiffSinger voice has no vocoder inside. A Voice Studio can download the DiffSinger community vocoder (PC-NSF-HiFiGAN by OpenVPI, the one most voices use), once for every voice.')),
        h('p', { class: 'note' }, Math.round(COMMUNITY_VOCODER.size / 1048576) + ' ' + t('MB, licence CC BY-NC-SA 4.0 (non commercial use). You can also import another vocoder (.oudep).'))),
      actions: [{ label: t('Later') }, { label: t('Download the vocoder'), primary: true, onClick: () => { getVocoder(); } }],
    });
  }

  async function getVocoder() {
    const bar = h('div', { class: 'progress-fill' });
    const label = h('p', null, t('Downloading...'));
    const m = openModal({ title: t('Vocoder'), body: h('div', null, label, h('div', { class: 'progress' }, bar)), actions: [] });
    try {
      await downloadCommunityVocoder((got, total) => {
        const pct = Math.min(100, Math.round((got / total) * 100));
        bar.style.width = pct + '%';
        label.textContent = t('Downloading...') + ' ' + pct + '%';
      });
      m.close();
      clearCache();
      hint(t('Vocoder installed: DiffSinger voices can sing'));
      store.emit();
    } catch (e) {
      m.close();
      alertBox(t('Vocoder'), tErr((e && e.message) || e) + '\n\n' + t('Check the internet connection and try again.'));
    }
    build();
  }

  async function addEngine() {
    const url = await promptText(t('VOICEVOX engine address'), (await kv.get('vvurl').catch(() => null)) || DEFAULT_ENGINE);
    if (!url) return;
    try {
      const added = await addVoicevoxEngine(url);
      await kv.set('vvurl', url);
      hint(added.length + ' ' + t('VOICEVOX voices added'));
    } catch (e) {
      alertBox('VOICEVOX', tErr((e && e.message) || e) + '\n\n' + t('Start the VOICEVOX engine on a computer of the same network, use its address (for example http://192.168.1.20:50021) and allow other apps in its settings (CORS: all).'));
    }
    build();
  }

  function voiceCard(v, img) {
    const track = store.track();
    const active = track.voice === v.id;
    const singing = v.type !== 'vocoder' && v.type !== 'humanizer';
    const card = h('div', { class: 'vcard' + (active ? ' on' : ''), 'data-id': v.id, role: 'button', tabindex: 0, title: singing ? t('Tap: sing the current track with this voice') : '',
      onClick: () => {
        if (!singing) return hint(t('This item is used by the voices, it does not sing by itself.'));
        store.change(() => { store.track().voice = v.id; });
        hint(store.track().name + ': ' + v.name);
      },
      onContextmenu: (e) => { e.preventDefault(); menu(e, v); },
    },
    img ? h('img', { class: 'vimg', src: img, alt: '' }) : h('div', { class: 'vimg ph' }, icon(TYPE_ICON[v.type] || 'Mic', 18)),
    h('div', { class: 'vtext' }, h('div', { class: 'vname' }, v.name), h('div', { class: 'vtype' }, t(TYPE_LABEL[v.type] || v.type) + (v.aliases ? ' · ' + v.aliases + ' alias' : '') + (v.type === 'diffsinger' && !v.bundledVocoder && !vocoderInstalled ? ' · ' + t('needs a vocoder') : ''))),
    v.type !== 'builtin' ? iconBtn('Menu', t('More'), (e) => { e.stopPropagation(); menu(e.currentTarget, v); }, 'small') : null);
    return card;
  }

  function menu(anchor, v) {
    openMenu(anchor.getBoundingClientRect ? anchor : { x: anchor.clientX, y: anchor.clientY }, [
      { header: v.name },
      v.type !== 'vocoder' && v.type !== 'humanizer' ? { label: t('Use for the current track'), icon: 'Check', onClick: () => store.change(() => { store.track().voice = v.id; }) } : null,
      { label: t('Remove from the library'), icon: 'Trash2', onClick: async () => {
        if (!(await confirmBox(t('Remove'), v.name + ': ' + t('remove this item from the library?'), t('Remove')))) return;
        await removeVoice(v.id);
        clearCache();
        build();
      } },
    ]);
  }

  async function build() {
    tabsEl.querySelectorAll('.br-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const match = (s) => !filter || String(s).toLowerCase().includes(filter);
    if (tab === 'voices') {
      let stored = [];
      try {
        stored = await listVoices();
      } catch {
        stored = [];
      }
      vocoderInstalled = stored.some((v) => v.type === 'vocoder');
      const groups = [
        [t('Built-in (vocoder)'), BUILTIN_VOICES.map((v) => ({ id: v.id, name: v.name, type: 'builtin' }))],
        ['DiffSinger', stored.filter((v) => v.type === 'diffsinger')],
        ['UTAU / OpenUTAU', stored.filter((v) => v.type === 'utau')],
        ['VOICEVOX', stored.filter((v) => v.type === 'voicevox')],
        [t('Vocoders and humanizers'), stored.filter((v) => v.type === 'vocoder' || v.type === 'humanizer')],
      ];
      const out = [h('div', { class: 'br-actions' },
        textBtn(t('Import a voice'), importVoice, 'primary', 'Upload'),
        textBtn('VOICEVOX', addEngine, '', 'Server'))];
      if (stored.some((v) => v.type === 'diffsinger' && !v.bundledVocoder) && !stored.some((v) => v.type === 'vocoder')) {
        out.push(h('div', { class: 'warn-card' }, h('span', null, t('Your DiffSinger voice needs a vocoder to sing.')), textBtn(t('Download the vocoder'), getVocoder, 'primary', 'Download')));
      }
      for (const [label, list] of groups) {
        const shown = list.filter((v) => match(v.name));
        if (!shown.length) continue;
        out.push(h('div', { class: 'br-group' }, label));
        for (const v of shown) {
          const card = voiceCard(v, null);
          out.push(card);
          voiceImage(v).then((url) => {
            if (!url) return;
            const old = card.querySelector('.vimg');
            if (old) old.replaceWith(h('img', { class: 'vimg', src: url, alt: '' }));
          });
        }
      }
      out.push(h('p', { class: 'br-note' }, t('Import UTAU / OpenUTAU banks (.zip with oto.ini), DiffSinger banks (.zip with dsconfig.yaml), DiffSinger vocoders (.oudep) or a humanizer model (.onnx). VOICEVOX voices come from a VOICEVOX engine (address of a computer running it).')));
      body.replaceChildren(...out);
    } else if (tab === 'projects') {
      body.replaceChildren(await onProjects(match));
    } else if (tab === 'plugins') {
      const list = allPlugins().filter((p) => match(p.name));
      body.replaceChildren(
        h('div', { class: 'br-actions' },
          textBtn(t('New plugin'), () => onEditPlugin(null), 'primary', 'Plus'),
          textBtn(t('Install'), async () => {
            const [f] = await pickFiles('.js,text/javascript');
            if (!f) return;
            try {
              const p = await installPlugin(await f.text());
              hint(p.name + ' ' + t('installed'));
            } catch (e) {
              alertBox(t('Plugin'), tErr((e && e.message) || e));
            }
            build();
          }, '', 'Upload')),
        ...list.map((p) => h('div', { class: 'pcard' },
          h('div', { class: 'vtext' }, h('div', { class: 'vname' }, p.name), h('div', { class: 'vtype' }, p.description || (p.builtin ? t('Built-in') : ''))),
          iconBtn('Play', t('Run on the selection (or the whole track)'), () => onRunPlugin(p), 'small'),
          p.builtin ? null : iconBtn('Pencil', t('Edit'), () => onEditPlugin(p), 'small'),
          p.builtin ? null : iconBtn('Trash2', t('Remove'), async () => { await removePlugin(p.id); build(); }, 'small'))),
        h('p', { class: 'br-note' }, t('Plugins change notes and lyrics (vibrato, legato, timing...). They run apart from the page and stop after 5 seconds.')),
      );
    } else {
      const cur = currentTheme();
      body.replaceChildren(
        h('div', { class: 'br-actions' }, textBtn(t('Import a theme'), async () => {
          const [f] = await pickFiles('.json,application/json');
          if (!f) return;
          try {
            const th = await installTheme(JSON.parse(await f.text()));
            await chooseTheme(th.id);
          } catch (e) {
            alertBox(t('Theme'), tErr((e && e.message) || e));
          }
          build();
        }, '', 'Upload')),
        ...allThemes().filter((th) => match(th.name)).map((th) => h('div', { class: 'tcard' + (th.id === cur.id ? ' on' : ''), role: 'button', tabindex: 0, onClick: async () => { await chooseTheme(th.id); build(); store.emit(); } },
          h('div', { class: 'tswatch' }, ['bg', 'panel', 'accent', 'accent2', 'note'].map((k) => h('span', { style: { background: th.colors[k] } }))),
          h('div', { class: 'vname' }, th.name),
          th.custom ? iconBtn('Trash2', t('Remove'), async (e) => { e.stopPropagation(); await removeTheme(th.id); build(); store.emit(); }, 'small') : null)),
        h('p', { class: 'br-note' }, t('A theme is a JSON file: { "name": "My theme", "dark": true, "colors": { "bg": "#101010", "accent": "#ff7ca8", ... } }.')),
      );
    }
  }

  // The card of the voice of the current track is highlighted (after any change).
  function markActive() {
    const id = store.track().voice;
    el.querySelectorAll('.vcard').forEach((c) => c.classList.toggle('on', c.dataset.id === id));
  }

  return { el, build, markActive, offerVocoder, importVoice, addEngine, show(id) { tab = id; build(); } };
}
