import { h, openModal, dropdown, hint } from './dom.js';
import { pluginInstruments, getPlugin } from '../plugins.js';
import { pluginControls } from './pluginControls.js';
import { knob } from './controls.js';
import { store, getChannel, currentPattern } from '../store.js';
import { CATALOG, CATEGORIES } from '../audio/catalog.js';
import { cutoffHz } from '../audio/engine.js';
import { getSampleMeta, getBuffer, loadBuffer } from '../samples.js';
import { WAVES, cleanSynth, SYNTH_PRESETS } from '../audio/osc3.js';
import { sampleView, soundView } from './sampleView.js';
import { openWaveEditor } from './clipEditors.js';
import { equalSlices, detectSlices, sliceNotes } from '../slicer.js';
import { t } from '../i18n.js';

// The tab stays the same from one channel to the next, like in FL Studio.
let lastTab = 'sound';

export function openChannelSettings(id, engine) {
  const c = getChannel(store.project, id);
  if (!c) return;
  store.commit();
  const set = (fn) => {
    fn();
    store.emit();
    // The sound preview follows the settings (envelopes, LFO, 3x Osc, plugin knobs).
    if (typeof soundChanged === 'function') soundChanged();
  };
  const name = h('input', { class: 'input', type: 'text', value: c.name, maxlength: 80, onInput: (e) => set(() => { c.name = e.target.value || t('Channel'); }) });
  const inst = dropdown({
    label: t('Instrument'),
    value: c.instrument,
    options: [
      ...(c.sample ? [{ value: 'sampler', label: t('Sampler: ') + ((getSampleMeta(c.sample) || {}).name || t('Missing sample')), group: 'Sample' }] : []),
      ...pluginInstruments().map((p) => ({ value: 'plugin:' + p.id, label: p.name, group: t('Plugins') })),
      ...CATEGORIES.flatMap((cat) => CATALOG.filter((x) => x.cat === cat.id).map((x) => ({ value: x.id, label: x.name, group: cat.name }))),
    ],
    onChange: (v) => {
      set(() => { c.instrument = v; });
      engine.preview(c, 60);
      // Rebuild the window so the knobs of the new instrument show.
      modal.close();
      openChannelSettings(id, engine);
    },
  });
  const insert = dropdown({
    label: t('Mixer insert'),
    value: c.insert,
    options: store.project.mixer.map((m, i) => ({ value: i, label: i === 0 ? 'Master' : i + '  ' + m.name })),
    onChange: (v) => set(() => { c.insert = v; }),
  });
  const pitchOut = h('output', null);
  const pitch = h('input', { type: 'range', class: 'range', min: -24, max: 24, step: 1, value: c.params.pitch, onInput: (e) => set(() => { c.params.pitch = Number(e.target.value); showPitch(); }) });
  const showPitch = () => { pitchOut.textContent = (c.params.pitch > 0 ? '+' : '') + c.params.pitch + t(' semitones'); };
  // Fine tune in cents (100 cents = one semitone).
  const fineOut = h('output', null);
  const showFine = () => { fineOut.textContent = ((c.params.fine || 0) > 0 ? '+' : '') + (c.params.fine || 0) + ' cents'; };
  const fine = h('input', { type: 'range', class: 'range', min: -100, max: 100, step: 1, value: c.params.fine || 0, 'aria-label': t('Fine tune'), onInput: (e) => set(() => { c.params.fine = Number(e.target.value); showFine(); }), onDblclick: (e) => { e.target.value = 0; set(() => { c.params.fine = 0; showFine(); }); } });
  showPitch();
  showFine();
  // Controls declared by a code plugin in its header.
  function pluginKnobs() {
    const plugin = c.instrument.startsWith('plugin:') ? getPlugin(c.instrument.slice(7)) : null;
    if (!plugin || !plugin.params.length) return null;
    return h('div', null,
      h('div', { class: 'field' }, h('span', null, plugin.name)),
      pluginControls(plugin, c.pluginParams, {
        onChange: (values) => set(() => { c.pluginParams = values; }),
        onButton: (bid) => engine.channelButton(c.id, bid),
      }),
    );
  }
  // 3x Osc: three oscillators and noise.
  function synthSection() {
    if (!c.synth) c.synth = cleanSynth(null);
    const syn = c.synth;
    const waveNames = [t('Sine'), t('Triangle'), t('Saw'), t('Square')];
    const kn = (label, obj, key, min, max, def, fmt) => h('label', { class: 'kl' },
      knob({ value: obj[key], min, max, def, size: 30, label, format: fmt, onInput: (v) => set(() => { obj[key] = key === 'coarse' || key === 'fine' ? Math.round(v) : v; }) }),
      h('span', null, label));
    const presets = dropdown({
      label: t('Presets'),
      value: null,
      options: SYNTH_PRESETS.map((x, i) => ({ value: i, label: t(x.name) })),
      onChange: (i) => {
        const pr = SYNTH_PRESETS[i];
        set(() => {
          c.synth = cleanSynth(JSON.parse(JSON.stringify(pr.synth)));
          Object.assign(c.params, pr.params);
        });
        engine.preview(c, 60, 0.8, 0.6);
        modal.close();
        openChannelSettings(id, engine);
      },
    });
    return h('div', { class: 'form' },
      h('div', { class: 'field' }, h('span', null, '3x Osc'), presets),
      syn.osc.map((o, i) => h('div', { class: 'osc-row' },
        h('span', { class: 'osc-num' }, String(i + 1)),
        dropdown({ label: t('Wave'), value: o.wave, options: WAVES.map((_, w) => ({ value: w, label: waveNames[w] })), onChange: (v) => { set(() => { o.wave = v; }); engine.preview(c, 60, 0.8, 0.4); } }),
        kn(t('Coarse'), o, 'coarse', -36, 36, 0, (v) => (v > 0 ? '+' : '') + Math.round(v) + ' st'),
        kn(t('Fine'), o, 'fine', -100, 100, 0, (v) => (v > 0 ? '+' : '') + Math.round(v) + ' ct'),
        kn(t('Level'), o, 'level', 0, 1, 0.5, (v) => Math.round(v * 100) + '%'),
      )),
      h('div', { class: 'osc-row' }, h('span', { class: 'osc-num' }, 'N'), kn(t('Noise'), syn, 'noise', 0, 1, 0, (v) => Math.round(v * 100) + '%')),
    );
  }

  let wave = null;
  function soundChanged() {
    if (wave && wave.soundChanged) wave.soundChanged();
  }
  function waveSection() {
    if (c.instrument === 'sampler') {
      return c.sample ? sampleView({
        c,
        engine,
        set,
        onEdit: () => openWaveEditor({ sampleId: c.sample, name: (getSampleMeta(c.sample) || {}).name || c.name }, engine, {
          onSave: (sid) => {
            // The edited sound replaces the sample of the channel; cut points start again.
            set(() => {
              c.sample = sid;
              Object.assign(c.params, { start: 0, end: 1, fadeIn: 0, fadeOut: 0 });
              delete c.slices;
            });
            modal.close();
            openChannelSettings(id, engine);
          },
        }),
      }) : null;
    }
    wave = c.instrument !== 'sampler' ? soundView({
        project: store.project,
        c,
        onMakeSample: (sid) => {
          // The rendered note already has its envelope and filter: start the sampler flat.
          set(() => {
            c.instrument = 'sampler';
            c.sample = sid;
            Object.assign(c.params, { pitch: 0, fine: 0, attack: 0, decay: 0, sustain: 1, release: 0, cutoff: 1, reso: 0, fenvAmt: 0, penvAmt: 0, start: 0, end: 1, fadeIn: 0, fadeOut: 0 });
            if (c.lfo) c.lfo.on = false;
          });
          hint(t('The channel now plays the sample of its sound. Cut it in the waveform.'));
          modal.close();
          openChannelSettings(id, engine);
        },
      }) : null;
    return wave;
  }

  // Sampler: reverse, start and end points, loop, slices.
  function samplerSection() {
    const sw = (label, key) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!c.params[key], onChange: (e) => set(() => { c.params[key] = e.target.checked; engine.preview(c, 60, 0.8, 0.6); }) }), h('span', null, label));
    const chop = async (mode) => {
      const buf = getBuffer(c.sample) || (await loadBuffer(c.sample));
      if (!buf) return hint(t('Sample missing on this device'));
      const slices = mode === 'auto' ? detectSlices(buf) : equalSlices(mode);
      set(() => {
        c.slices = slices;
        currentPattern(store.project).notes[c.id] = sliceNotes(slices, buf.duration, store.project.bpm);
      });
      hint(slices.length + t(' slices, played from C5 upward. A pattern was written with them.'));
      modal.close();
      openChannelSettings(id, engine);
    };
    return h('div', { class: 'form' },
      h('div', { class: 'field' }, h('span', null, t('Sample')), h('div', { class: 'set-inline' }, sw(t('Play reversed'), 'reverse'), sw(t('Loop while the note is held'), 'loop'))),
      c.zones && c.zones.length ? h('p', { class: 'set-note' }, t('Multi sample instrument: ') + c.zones.length + t(' samples mapped to keys.')) : null,

      h('div', { class: 'field' }, h('span', null, t('Chop (slicer)')),
        h('div', { class: 'set-inline' },
          [4, 8, 16].map((n) => h('button', { class: 'b tb', type: 'button', onClick: () => chop(n) }, String(n))),
          h('button', { class: 'b tb', type: 'button', onClick: () => chop('auto') }, t('Auto')),
          c.slices && c.slices.length ? h('button', { class: 'b tb', type: 'button', onClick: () => { set(() => { delete c.slices; }); modal.close(); openChannelSettings(id, engine); } }, t('Remove slices')) : null,
        )),
      c.slices && c.slices.length ? h('p', { class: 'set-note' }, c.slices.length + t(' slices: C5 plays the first one, C#5 the second, and so on.')) : null,
    );
  }
  const sec = (v) => (v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s');
  const k = (label, key, max, def, fmt) =>
    h('label', { class: 'kl big' },
      knob({ value: c.params[key], min: 0, max, def, size: 36, label, format: fmt, onInput: (v) => set(() => { c.params[key] = v; }) }),
      h('span', null, label),
    );
  // FL Studio style channel window with tabs: sound, envelopes, LFO, arpeggiator, misc.
  const kk = (label, obj, key, min, max, def, fmt, size = 36) => h('label', { class: 'kl big' },
    knob({ value: obj[key] == null ? def : obj[key], min, max, def, size, label, format: fmt, onInput: (v) => set(() => { obj[key] = v; }) }),
    h('span', null, label));
  const pct = (v) => Math.round(v * 100) + '%';
  const sw = (label, obj, key, after) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!obj[key], onChange: (e) => { set(() => { obj[key] = e.target.checked; }); if (after) after(); } }), h('span', null, label));
  const pick = (label, obj, key, options, def = 0) => h('div', { class: 'pcell' }, h('span', { class: 'pcell-label' }, label),
    dropdown({ label, value: obj[key] == null ? def : obj[key], options: options.map((o, i) => ({ value: i, label: o })), onChange: (v) => set(() => { obj[key] = v; }) }));

  const tabs = {
    // The sound itself comes first, like the sampler page of FL Studio.
    sound: () => h('div', { class: 'form' },
      waveSection(),
      h('label', { class: 'field' }, h('span', null, t('Name')), name),
      h('label', { class: 'field' }, h('span', null, t('Instrument')), inst),
      h('label', { class: 'field' }, h('span', null, t('Mixer insert')), insert),
      h('label', { class: 'field' }, h('span', null, t('Transposition')), h('div', { class: 'rangebox' }, pitch, pitchOut)),
      h('label', { class: 'field' }, h('span', null, t('Fine tune')), h('div', { class: 'rangebox' }, fine, fineOut)),
      c.instrument === 'sampler' ? samplerSection() : null,
      c.instrument === 'osc3' ? synthSection() : null,
      pluginKnobs(),

    ),
    env: () => h('div', { class: 'form' },
      h('div', { class: 'field' }, h('span', null, t('Volume envelope'))),
      h('div', { class: 'knobs' },
        k(t('Attack'), 'attack', 2, 0, sec),
        k(t('Decay'), 'decay', 3, 0, sec),
        k(t('Sustain'), 'sustain', 1, 1, pct),
        k(t('Release'), 'release', 3, 0, sec),
      ),
      h('div', { class: 'field' }, h('span', null, t('Filter'))),
      h('div', { class: 'knobs' },
        k(t('Cutoff'), 'cutoff', 1, 1, (v) => Math.round(cutoffHz(v)) + ' Hz'),
        k(t('Resonance'), 'reso', 1, 0, pct),
        kk(t('Envelope amount'), c.params, 'fenvAmt', -1, 1, 0, (v) => (v > 0 ? '+' : '') + Math.round(v * 7 * 10) / 10 + ' oct'),
        kk(t('Env attack'), c.params, 'fenvA', 0, 2, 0.005, sec),
        kk(t('Env decay'), c.params, 'fenvD', 0.01, 4, 0.3, sec),
        kk(t('Env sustain'), c.params, 'fenvS', 0, 1, 0, pct),
      ),
      h('div', { class: 'field' }, h('span', null, t('Pitch envelope'))),
      h('div', { class: 'knobs' },
        kk(t('Amount'), c.params, 'penvAmt', -24, 24, 0, (v) => (v > 0 ? '+' : '') + Math.round(v) + ' st'),
        kk(t('Decay'), c.params, 'penvDecay', 0.005, 2, 0.1, sec),
      ),
      h('p', { class: 'set-note' }, t('The filter envelope opens the filter of each note (a short decay makes plucks and basses). The pitch envelope bends the start of each note (808 and kick drops).')),
    ),
    lfo: () => {
      if (!c.lfo) c.lfo = { on: false, target: 0, shape: 0, rate: 5, sync: 0, amount: 0.5 };
      return h('div', { class: 'form' },
        sw(t('LFO on'), c.lfo, 'on'),
        h('div', { class: 'set-inline' },
          pick(t('Target'), c.lfo, 'target', [t('Volume (tremolo)'), t('Pitch (vibrato)'), t('Filter (wobble)')]),
          pick(t('Shape'), c.lfo, 'shape', [t('Sine'), t('Triangle'), t('Square'), t('Saw')]),
          pick(t('Tempo sync'), c.lfo, 'sync', [t('Free (Hz)'), '1/16', '1/8', '1/4', '1/2', t('1 bar'), t('2 bars')]),
        ),
        h('div', { class: 'knobs' },
          kk(t('Rate'), c.lfo, 'rate', 0.05, 20, 5, (v) => v.toFixed(2) + ' Hz'),
          kk(t('Amount'), c.lfo, 'amount', 0, 1, 0.5, pct),
        ),
        h('p', { class: 'set-note' }, t('Rate is used when Tempo sync is Free. A filter LFO synced to 1/8 gives the dubstep wobble.')),
      );
    },
    arp: () => {
      if (!c.arp) c.arp = { on: false, dir: 0, range: 1, step: 1, gate: 0.8 };
      return h('div', { class: 'form' },
        sw(t('Arpeggiator on'), c.arp, 'on'),
        h('div', { class: 'set-inline' },
          pick(t('Direction'), c.arp, 'dir', [t('Up'), t('Down'), t('Up and down'), t('Random')]),
          h('div', { class: 'pcell' }, h('span', { class: 'pcell-label' }, t('Range')),
            dropdown({ label: t('Range'), value: c.arp.range || 1, options: [1, 2, 3, 4].map((n) => ({ value: n, label: n + ' oct' })), onChange: (v) => set(() => { c.arp.range = v; }) })),
          pick(t('Time'), c.arp, 'step', ['1/32', '1/16', '1/8', '1/4'], 1),
        ),
        h('div', { class: 'knobs' }, kk(t('Gate'), c.arp, 'gate', 0.05, 1, 0.8, pct)),
        h('p', { class: 'set-note' }, t('Chords and long notes of this channel are played as arpeggios. The notes in the piano roll do not change.')),
      );
    },
    misc: () => {
      // Polyphony box like FL Studio: Max voices, Slide time, Porta and Mono.
      const maxOut = h('output', { class: 'poly-max' });
      const showMax = () => { maxOut.textContent = c.params.mono ? '1' : c.params.maxPoly ? String(c.params.maxPoly) : '∞'; };
      const step = (d) => set(() => {
        const cur = c.params.maxPoly || 0;
        c.params.maxPoly = Math.max(0, Math.min(32, cur + d));
        if (c.params.maxPoly) c.params.mono = false;
        showMax();
        monoBox.querySelector('input').checked = !!c.params.mono;
      });
      showMax();
      const monoBox = sw(t('Mono'), c.params, 'mono', showMax);
      return h('div', { class: 'form' },
        h('div', { class: 'poly-box' },
          h('div', { class: 'poly-title' }, t('Polyphony')),
          h('div', { class: 'poly-row' },
            h('span', { class: 'poly-label' }, 'Max'),
            h('div', { class: 'poly-stepper' },
              h('button', { class: 'b small', type: 'button', 'aria-label': t('Fewer voices'), onClick: () => step(-1) }, '−'),
              maxOut,
              h('button', { class: 'b small', type: 'button', 'aria-label': t('More voices'), onClick: () => step(1) }, '+'),
            ),
            k(t('Slide'), 'glide', 1, 0.1, sec),
          ),
          h('div', { class: 'poly-row' },
            sw(t('Porta'), c.params, 'porta'),
            monoBox,
          ),
        ),
        h('p', { class: 'set-note' }, t('Max: how many notes of this channel sound at once (∞ = no limit). A new note cuts the oldest one. Porta: every note glides from the previous one, in the Slide time. Mono: one note at a time. Mono with Porta gives the classic 808 and lead glides; slide notes from the piano roll glide too.')),
      );
    },
  };
  const TAB_LIST = [['sound', t('Sound')], ['env', t('Envelope')], ['lfo', 'LFO'], ['arp', 'Arp'], ['misc', t('Misc')]];
  const page = h('div', { class: 'ch-page' });
  const tabBar = h('div', { class: 'ch-tabs', role: 'tablist' });
  function showTab(id) {
    lastTab = id;
    tabBar.replaceChildren(...TAB_LIST.map(([tid, label]) => h('button', { class: 'b tb ch-tab' + (tid === id ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(tid === id), onClick: () => showTab(tid) }, label)));
    page.replaceChildren(tabs[id]());
  }
  // Test keyboard: C5 to C6, hold the keys.
  const keys = h('div', { class: 'test-keys' }, h('span', { class: 'pcell-label' }, t('Test')),
    ...['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B', 'C'].map((nm, i) => {
      const b = h('button', { class: 'test-key' + (nm.length > 1 ? ' black' : ''), type: 'button', 'aria-label': nm }, nm);
      let voice = null;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try {
          b.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic event */
        }
        voice = engine.noteOn(c, 60 + i, 0.8);
      });
      const up = () => {
        if (voice) engine.noteOff(voice);
        voice = null;
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      return b;
    }),
    h('button', { class: 'b tb', type: 'button', onClick: () => engine.preview(c, 60, 0.8, 0.6) }, t('Preview')));
  const body = h('div', { class: 'ch-settings' }, tabBar, page, keys);
  showTab(lastTab in tabs ? lastTab : 'sound');
  const modal = openModal({ title: c.name + ': ' + t('Channel settings'), body, wide: true });
}
