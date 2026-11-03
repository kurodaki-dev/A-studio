// Inspector (right panel): settings of the current track (voice, volume, pan,
// humanizer, DiffSinger steps and speaker) and of the selected notes (lyric, phonemes,
// velocity, portamento, vibrato).
import { h, slider, select, textBtn, hint } from './dom.js';
import { store } from '../store.js';
import { normalizeLyric, kanaToRomaji, moraPhonemes } from '../lyrics.js';
import { BUILTIN_VOICES } from '../voices/builtin.js';
import { listVoices, getVoice } from '../voices/library.js';
import { settings } from '../render.js';
import { ui } from './editor.js';
import { t } from '../i18n.js';

export function createInspector({ onLyrics }) {
  const body = h('div', { class: 'ins-body' });
  const el = h('aside', { class: 'inspector' }, body);
  let voices = [];

  async function build() {
    try {
      voices = await listVoices();
    } catch {
      voices = [];
    }
    const track = store.track();
    const singing = [...BUILTIN_VOICES.map((v) => ({ id: v.id, name: v.name + ' (vocoder)' })), ...voices.filter((v) => ['utau', 'diffsinger', 'voicevox'].includes(v.type)).map((v) => ({ id: v.id, name: v.name + ' (' + (v.type === 'utau' ? 'UTAU' : v.type === 'diffsinger' ? 'DiffSinger' : 'VOICEVOX') + ')' }))];
    if (!singing.some((v) => v.id === track.voice)) singing.unshift({ id: track.voice, name: t('Missing voice') });
    const v = track.voice.startsWith('builtin:') ? { type: 'builtin' } : (await getVoice(track.voice).catch(() => null)) || { type: 'missing' };
    const set = (fn) => store.change(() => fn(store.track()));
    const parts = [
      h('h3', null, t('Track')),
      h('label', { class: 'field' }, h('span', null, t('Name')), h('input', { class: 'input', value: track.name, 'aria-label': t('Track name'), onChange: (e) => set((tr) => { tr.name = e.target.value.slice(0, 40) || tr.name; }) })),
      h('label', { class: 'field' }, h('span', null, t('Voice')), select({ label: t('Voice'), value: track.voice, options: singing.map((x) => ({ value: x.id, label: x.name })), onChange: (id) => set((tr) => { tr.voice = id; }) })),
      slider({ label: t('Volume'), min: 0, max: 1.5, step: 0.01, value: track.vol, def: 1, format: (x) => Math.round(x * 100) + '%', onStart: () => store.commit(), onInput: (x) => { store.track().vol = x; } }),
      slider({ label: t('Pan'), min: -1, max: 1, step: 0.01, value: track.pan, def: 0, format: (x) => (Math.abs(x) < 0.01 ? t('Center') : Math.round(Math.abs(x) * 100) + '% ' + (x < 0 ? t('left') : t('right'))), onStart: () => store.commit(), onInput: (x) => { store.track().pan = x; } }),
    ];
    if (v.type === 'utau') {
      parts.push(
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: track.humanize, onChange: (e) => set((tr) => { tr.humanize = e.target.checked; }) }), h('span', null, t('Humanize (natural pitch moves)'))),
        h('p', { class: 'note' }, settings.humanizer === 'builtin' ? t('Uses the built-in rules. Change it in VOICE > Humanizer.') : settings.humanizer === 'ai' ? t('Uses the built-in AI model (local). Change it in VOICE > Humanizer.') : t('Uses the imported humanizer model (local).')),
      );
    }
    if (v.type === 'diffsinger') {
      parts.push(slider({ label: t('Render steps'), min: 1, max: 100, step: 1, value: track.steps, def: 10, format: (x) => String(x), onStart: () => store.commit(), onInput: (x) => { store.track().steps = x; } }));
      if (v.speakers && v.speakers.length > 1) parts.push(h('label', { class: 'field' }, h('span', null, t('Speaker')), select({ label: t('Speaker'), value: track.speaker, options: v.speakers.map((s, i) => ({ value: i, label: s.split('/').pop() })), onChange: (x) => set((tr) => { tr.speaker = Number(x); }) })));
      parts.push(h('p', { class: 'note' }, t('More steps sound smoother but render slower. DiffSinger runs on this device.')));
    }
    if (v.type === 'voicevox') {
      parts.push(h('p', { class: 'note' }, (v.url === 'builtin' ? t('VOICEVOX renders inside the app.') : t('VOICEVOX renders on the engine at ') + (v.url || '') + '.') + ' ' + t('Lyrics are sung in Japanese kana.')));
      parts.push(h('p', { class: 'note' }, t('When you publish a song, credit the voice: "VOICEVOX:') + String(v.name).split(' (')[0] + '".'));
    }
    const sel = track.notes.filter((n) => ui.sel.has(n.id));
    parts.push(h('h3', null, sel.length ? (sel.length === 1 ? t('Note') : sel.length + ' ' + t('notes')) : t('Notes')));
    if (!sel.length) {
      parts.push(h('p', { class: 'note' }, t('Tap a note to edit it. Double tap a note to type its lyric. Type letters (ka, sa, shi...): they become kana automatically.')));
      parts.push(textBtn(t('Lyrics for the notes...'), onLyrics, '', 'Type'));
    } else {
      const n = sel[0];
      const each = (fn) => store.change(() => { for (const x of store.track().notes) if (ui.sel.has(x.id)) fn(x); });
      if (sel.length === 1) {
        const preview = h('span', { class: 'note' });
        const show = (txt) => {
          const k = normalizeLyric(txt);
          preview.textContent = k ? k + '  [' + (k === '-' ? t('hold') : moraPhonemes(k).join(' ') || kanaToRomaji(k)) + ']' : '';
        };
        const lyric = h('input', { class: 'input', value: n.lyric, 'aria-label': t('Lyric'), onInput: (e) => show(e.target.value), onChange: (e) => each((x) => { x.lyric = normalizeLyric(e.target.value) || x.lyric; }) });
        show(n.lyric);
        parts.push(h('label', { class: 'field' }, h('span', null, t('Lyric')), lyric), preview);
        parts.push(h('label', { class: 'field' }, h('span', null, t('Phonemes')), h('input', { class: 'input', value: n.ph || '', placeholder: t('automatic'), 'aria-label': t('Phonemes'), onChange: (e) => each((x) => { if (e.target.value.trim()) x.ph = e.target.value.trim(); else delete x.ph; }) })));
      }
      parts.push(textBtn(t('Lyrics for the notes...'), onLyrics, '', 'Type'));
      parts.push(
        slider({ label: t('Velocity'), min: 0, max: 1, step: 0.01, value: n.vel, def: 0.8, format: (x) => Math.round(x * 100) + '%', onStart: () => store.commit(), onInput: (x) => { for (const y of store.track().notes) if (ui.sel.has(y.id)) y.vel = x; } }),
        slider({ label: t('Portamento'), min: 0, max: 400, step: 5, value: n.porta, def: 80, format: (x) => x + ' ms', onStart: () => store.commit(), onInput: (x) => { for (const y of store.track().notes) if (ui.sel.has(y.id)) y.porta = x; } }),
        h('h4', null, t('Vibrato')),
        slider({ label: t('Depth'), min: 0, max: 150, step: 1, value: n.vib.depth, def: 0, format: (x) => x + ' cents', onStart: () => store.commit(), onInput: (x) => { for (const y of store.track().notes) if (ui.sel.has(y.id)) y.vib.depth = x; } }),
        slider({ label: t('Speed'), min: 1, max: 10, step: 0.1, value: n.vib.rate, def: 5.5, format: (x) => x.toFixed(1) + ' Hz', onStart: () => store.commit(), onInput: (x) => { for (const y of store.track().notes) if (ui.sel.has(y.id)) y.vib.rate = x; } }),
        slider({ label: t('Delay'), min: 0, max: 1, step: 0.01, value: n.vib.delay, def: 0.35, format: (x) => Math.round(x * 100) + '%', onStart: () => store.commit(), onInput: (x) => { for (const y of store.track().notes) if (ui.sel.has(y.id)) y.vib.delay = x; } }),
      );
    }
    body.replaceChildren(...parts);
    // Sliders change values live: tell the rest of the app when the finger lifts.
    body.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('change', () => store.emit()));
  }

  return { el, build, hint };
}
