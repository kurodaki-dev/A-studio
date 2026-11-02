import { h, icon, openModal, confirmBox, openMenu } from './dom.js';
import { t } from '../i18n.js';
import { parsePlugin, installPlugin, onPluginErrorEvent } from '../plugins.js';
import { saveFile } from '../platform.js';
import { openExternal, DOCS_URL } from '../links.js';

export const INSTRUMENT_TEMPLATE = `/**
 * @astudio-plugin
 * @id my-synth
 * @name My Synth
 * @version 1.0.0
 * @author Me
 * @category synth
 * @choice wave "Wave" sine|saw|square 1
 * @param cutoff "Cutoff" 100 10000 3000
 * @param release "Release" 0.01 3 0.3
 * @toggle octave "Octave up" 0
 */
class MyVoice {
  constructor({ frequency, velocity, sampleRate, params }) {
    this.sr = sampleRate;
    this.freq = frequency;
    this.phase = 0;
    this.amp = 0.2 * velocity;
    this.env = 0;
    this.off = false;
    this.lp = 0;
  }

  noteOff() {
    this.off = true;
  }

  process(left, right, params) {
    const f = this.freq * (params.octave ? 2 : 1);
    const a = 1 - Math.exp((-2 * Math.PI * params.cutoff) / this.sr);
    for (let i = 0; i < left.length; i++) {
      this.phase = (this.phase + f / this.sr) % 1;
      const p = this.phase;
      let s = params.wave === 0 ? Math.sin(2 * Math.PI * p) : params.wave === 1 ? 2 * p - 1 : p < 0.5 ? 1 : -1;
      this.lp += a * (s - this.lp);
      this.env = this.off ? this.env * Math.exp(-1 / (params.release * this.sr)) : Math.min(1, this.env + 200 / this.sr);
      s = this.lp * this.env * this.amp;
      left[i] = s;
      right[i] = s;
    }
    return !(this.off && this.env < 0.0005);
  }
}

registerVoice(MyVoice);
`;

export const EFFECT_TEMPLATE = `/**
 * @astudio-plugin
 * @id my-effect
 * @name My Effect
 * @version 1.0.0
 * @author Me
 * @type effect
 * @param drive "Drive" 1 20 4
 * @param mix "Mix" 0 1 0.5
 * @toggle bypass "Bypass" 0
 */
class MyEffect {
  constructor({ sampleRate, params }) {
    this.sr = sampleRate;
  }

  // Read inL/inR, write outL/outR (Float32Array, 128 samples).
  process(inL, inR, outL, outR, params) {
    for (let i = 0; i < inL.length; i++) {
      if (params.bypass) {
        outL[i] = inL[i];
        outR[i] = inR[i];
        continue;
      }
      const l = Math.tanh(inL[i] * params.drive) / Math.tanh(params.drive);
      const r = Math.tanh(inR[i] * params.drive) / Math.tanh(params.drive);
      outL[i] = inL[i] * (1 - params.mix) + l * params.mix;
      outR[i] = inR[i] * (1 - params.mix) + r * params.mix;
    }
  }
}

registerEffect(MyEffect);
`;

export const EXTENSION_TEMPLATE = `/**
 * @astudio-plugin
 * @id my-extension
 * @name My Extension
 * @version 1.0.0
 * @author Me
 * @type extension
 * @permissions ui transport
 */

// A button in the top bar.
astudio.ui.addButton({ id: 'play', label: 'Play', icon: 'Play' }, () => astudio.transport.toggle());

// A panel with its own interface (HTML, CSS and JavaScript).
astudio.ui.addPanel({
  id: 'hello',
  title: 'My panel',
  icon: 'Music',
  html: \`
<style>
  body { margin: 0; padding: 16px; font: 14px system-ui, sans-serif; background: #2f383d; color: #d5dcdf; }
  button { font: inherit; padding: 10px 14px; background: #f0993a; border: 0; border-radius: 2px; }
</style>
<p>Hello from my extension.</p>
<button id="faster">Tempo + 10</button>
<script>
  document.getElementById('faster').onclick = async () => {
    const s = await astudio.transport.getState();
    await astudio.transport.setTempo(s.bpm + 10);
  };
</script>\`,
});
`;

export const DRUM_TEMPLATE = `/**
 * @astudio-plugin
 * @id my-drum
 * @name My Drum
 * @version 1.0.0
 * @author Me
 * @category drums
 * @oneshot
 * @param pitch "Pitch" 30 200 55
 * @param decay "Decay" 0.05 2 0.4
 * @param punch "Punch" 0 1 0.6
 * @param noise "Noise" 0 1 0.1
 */
// A kick drum built with the dsp helpers: a sine with a pitch drop and some noise.
class Drum {
  constructor({ velocity, sampleRate, params }) {
    this.sr = sampleRate;
    this.osc = new dsp.Osc(sampleRate);
    this.noise = new dsp.Noise();
    this.t = 0;
    this.vel = velocity;
  }

  process(left, right, params) {
    for (let i = 0; i < left.length; i++) {
      const t = this.t / this.sr;
      const f = params.pitch * (1 + params.punch * 4 * Math.exp(-t * 40));
      const env = Math.exp(-t / params.decay);
      const n = this.noise.white() * params.noise * Math.exp(-t * 60);
      const s = dsp.softClip((this.osc.sine(f) + n) * env * 1.5) * 0.6 * this.vel;
      left[i] = s;
      right[i] = s;
      this.t++;
    }
    return this.t / this.sr < params.decay * 8;
  }
}

registerVoice(Drum);
`;

export const SYNTH_TEMPLATE = `/**
 * @astudio-plugin
 * @id my-dsp-synth
 * @name My DSP Synth
 * @version 1.0.0
 * @author Me
 * @category synth
 * @choice wave "Wave" saw|square|triangle 0
 * @param cutoff "Cutoff" 100 12000 2500
 * @param reso "Resonance" 0.5 12 1
 * @param attack "Attack" 0.001 2 0.01
 * @param release "Release" 0.01 4 0.4
 * @param detune "Detune" 0 30 8
 */
// Two band limited oscillators, a resonant filter and an ADSR, with the dsp helpers.
class Voice {
  constructor({ frequency, velocity, sampleRate, params }) {
    this.f = frequency;
    this.a = new dsp.Osc(sampleRate);
    this.b = new dsp.Osc(sampleRate);
    this.filter = new dsp.Biquad(sampleRate);
    this.cut = new dsp.Smooth(sampleRate, 30, params.cutoff);
    this.env = new dsp.Env(sampleRate, { attack: params.attack, decay: 0.3, sustain: 0.7, release: params.release });
    this.env.gate(true);
    this.amp = 0.25 * velocity;
  }

  noteOff() {
    this.env.gate(false);
  }

  process(left, right, params) {
    const wave = ['saw', 'square', 'triangle'][params.wave];
    const fb = this.f * Math.pow(2, params.detune / 1200);
    this.env.set({ attack: params.attack, release: params.release });
    for (let i = 0; i < left.length; i++) {
      if (i % 16 === 0) this.filter.set('lowpass', this.cut.next(params.cutoff), params.reso);
      const x = (this.a[wave](this.f) + this.b[wave](fb)) * 0.5;
      const s = this.filter.process(x) * this.env.next() * this.amp;
      left[i] = s;
      right[i] = s;
    }
    return !this.env.done;
  }
}

registerVoice(Voice);
`;

export const FILTER_TEMPLATE = `/**
 * @astudio-plugin
 * @id my-filter
 * @name My Filter
 * @version 1.0.0
 * @author Me
 * @type effect
 * @choice type "Type" lowpass|highpass|bandpass 0
 * @param cutoff "Cutoff" 40 18000 1200
 * @param reso "Resonance" 0.5 15 2
 * @param rate "LFO rate" 0 8 0.5
 * @param depth "LFO depth" 0 1 0.5
 */
// A resonant filter swept by an LFO synced to nothing (rate in Hz), stereo.
class Filter {
  constructor({ sampleRate }) {
    this.sr = sampleRate;
    this.l = new dsp.Biquad(sampleRate);
    this.r = new dsp.Biquad(sampleRate);
    this.lfo = new dsp.Osc(sampleRate);
  }

  process(inL, inR, outL, outR, params) {
    const type = ['lowpass', 'highpass', 'bandpass'][params.type];
    for (let i = 0; i < inL.length; i++) {
      const m = this.lfo.sine(params.rate);
      if (i % 16 === 0) {
        const f = params.cutoff * Math.pow(2, m * params.depth * 3);
        this.l.set(type, f, params.reso);
        this.r.set(type, f, params.reso);
      }
      outL[i] = this.l.process(inL[i]);
      outR[i] = this.r.process(inR[i]);
    }
  }
}

registerEffect(Filter);
`;

const TEMPLATES = [
  { label: 'Instrument template', icon: 'Piano', code: () => INSTRUMENT_TEMPLATE },
  { label: 'Synth with dsp helpers', icon: 'AudioLines', code: () => SYNTH_TEMPLATE },
  { label: 'Drum (one shot)', icon: 'Drum', code: () => DRUM_TEMPLATE },
  { label: 'Effect template', icon: 'AudioWaveform', code: () => EFFECT_TEMPLATE },
  { label: 'Filter effect with dsp helpers', icon: 'AudioWaveform', code: () => FILTER_TEMPLATE },
  { label: 'Extension template', icon: 'Puzzle', code: () => EXTENSION_TEMPLATE },
];

// Syntax check with the line of the error: the code is loaded as a script inside a
// function that is never called, so nothing runs.
export function syntaxCheck(code) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob(['void function () {\n' + code + '\n};'], { type: 'text/javascript' }));
    const el = document.createElement('script');
    let err = null;
    const onErr = (e) => {
      if (e.filename !== url) return;
      err = { message: e.message, line: Math.max(1, e.lineno - 1) };
      e.preventDefault();
    };
    window.addEventListener('error', onErr);
    const done = () => {
      window.removeEventListener('error', onErr);
      el.remove();
      URL.revokeObjectURL(url);
      resolve(err);
    };
    el.onload = done;
    el.onerror = done;
    el.src = url;
    document.head.append(el);
  });
}

// Header line for a new control, with an id not used yet.
export function controlLine(kind, code) {
  let n = 1;
  while (new RegExp('@(param|toggle|choice|button)\\s+ctl' + n + '\\b').test(code)) n++;
  const id = 'ctl' + n;
  if (kind === 'toggle') return ' * @toggle ' + id + ' "Switch ' + n + '" 0';
  if (kind === 'choice') return ' * @choice ' + id + ' "Choice ' + n + '" one|two|three 0';
  if (kind === 'button') return ' * @button ' + id + ' "Button ' + n + '"';
  if (kind === 'preset') return ' * @preset "Preset ' + n + '" ' + id + '=0';
  return ' * @param ' + id + ' "Knob ' + n + '" 0 1 0.5';
}

export function insertInHeader(code, line) {
  const end = code.indexOf('*/');
  if (end < 0) return code;
  const at = code.lastIndexOf('\n', end) + 1;
  return code.slice(0, at) + line + '\n' + code.slice(at);
}

// Write, install and try a plugin inside the app.
export function openPluginEditor({ code, onInstalled, onTry, engine }) {
  const area = h('textarea', { class: 'code-editor', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', wrap: 'off', 'aria-label': t('Plugin code') });
  area.value = code || INSTRUMENT_TEMPLATE;
  const gutter = h('pre', { class: 'code-gutter', 'aria-hidden': 'true' });
  const status = h('div', { class: 'editor-status', role: 'status' });
  const keys = h('div', { class: 'test-keys' });
  let errLine = null;
  let installed = null;

  function renderGutter() {
    const n = area.value.split('\n').length;
    const out = [];
    for (let i = 1; i <= n; i++) out.push(i === errLine ? '> ' + i : String(i));
    gutter.textContent = out.join('\n');
    gutter.scrollTop = area.scrollTop;
  }
  function goToLine(line) {
    const lines = area.value.split('\n');
    let pos = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    area.focus();
    area.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
    const lh = parseFloat(getComputedStyle(area).lineHeight) || 18;
    area.scrollTop = Math.max(0, (line - 4) * lh);
  }
  const show = (msg, ok, line = null) => {
    errLine = ok ? null : line;
    status.replaceChildren(msg, line ? h('button', { class: 'b tb small-link', type: 'button', onClick: () => goToLine(line) }, t('Go to line ') + line) : '');
    status.classList.toggle('ok', !!ok);
    status.classList.toggle('err', !ok);
    renderGutter();
  };
  area.addEventListener('scroll', () => { gutter.scrollTop = area.scrollTop; });
  area.addEventListener('input', () => renderGutter());
  area.addEventListener('keydown', (e) => {
    const { selectionStart: a, selectionEnd: b, value } = area;
    if (e.key === 'Tab') {
      // Tab inserts two spaces instead of leaving the field.
      e.preventDefault();
      area.value = value.slice(0, a) + '  ' + value.slice(b);
      area.selectionStart = area.selectionEnd = a + 2;
    } else if (e.key === 'Enter') {
      // Keep the indentation of the line, one more level after an opening brace.
      e.preventDefault();
      const lineStart = value.lastIndexOf('\n', a - 1) + 1;
      const indent = /^\s*/.exec(value.slice(lineStart, a))[0];
      const extra = /[{([]\s*$/.test(value.slice(lineStart, a)) ? '  ' : '';
      const ins = '\n' + indent + extra;
      area.value = value.slice(0, a) + ins + value.slice(b);
      area.selectionStart = area.selectionEnd = a + ins.length;
      renderGutter();
    }
  });

  const check = async () => {
    let p;
    try {
      p = parsePlugin(area.value);
    } catch (e) {
      show(String(e.message || e), false);
      return null;
    }
    if (p.type !== 'extension') {
      const err = await syntaxCheck(area.value);
      if (err) {
        show(t('Code error: ') + err.message, false, err.line);
        return null;
      }
    }
    const kind = p.type === 'effect' ? t('effect') : p.type === 'extension' ? t('extension') : t('instrument');
    const extra = p.type === 'extension' ? t('Permissions: ') + (p.permissions.join(', ') || t('none')) : p.params.length + ' ' + t('controls');
    show(t('Header OK: ') + p.name + ' (' + kind + ', ' + extra + ')', true);
    return p;
  };

  const useTemplate = async (tpl) => {
    const all = TEMPLATES.map((x) => x.code());
    if (area.value.trim() && !all.includes(area.value) && !(await confirmBox(t('Replace the code'), t('The code in the editor will be replaced by the template.'), t('Replace')))) return;
    area.value = tpl;
    check();
  };

  // Test keyboard for instruments: C5 to C6, press and hold.
  function renderKeys(p) {
    if (!p || p.type !== 'instrument' || !engine) {
      keys.replaceChildren();
      return;
    }
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B', 'C'];
    keys.replaceChildren(h('span', { class: 'pcell-label' }, t('Test')), ...names.map((nm, i) => {
      const k = h('button', { class: 'test-key' + (nm.length > 1 ? ' black' : ''), type: 'button', 'aria-label': nm }, nm);
      let voice = null;
      k.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try {
          k.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic event */
        }
        voice = engine.noteOn(engine.previewChannel('plugin:' + p.id), 60 + i, 0.8);
      });
      const up = () => {
        if (voice) engine.noteOff(voice);
        voice = null;
      };
      k.addEventListener('pointerup', up);
      k.addEventListener('pointercancel', up);
      return k;
    }));
  }

  const install = async () => {
    const p = await check();
    if (!p) return null;
    try {
      installed = installPlugin(area.value);
      onInstalled && onInstalled(installed);
      renderKeys(installed);
      return installed;
    } catch (e) {
      show(String(e.message || e), false);
      return null;
    }
  };

  const off = onPluginErrorEvent((p, message, line) => {
    if (installed && p.id === installed.id && area.isConnected) show(t('Runtime error: ') + message, false, line);
  });

  const body = h('div', { class: 'editor' },
    h('div', { class: 'set-actions editor-bar' },
      h('button', { class: 'b tb', type: 'button', onClick: (e) => openMenu(e.currentTarget, TEMPLATES.map((x) => ({ label: t(x.label), icon: x.icon, onClick: () => useTemplate(x.code()) }))) }, icon('FilePlus', 16), t('Templates')),
      h('button', { class: 'b tb', type: 'button', onClick: (e) => openMenu(e.currentTarget, [
        { header: t('Adds a line to the header') },
        ...[['param', 'Knob'], ['toggle', 'Switch'], ['choice', 'Choice list'], ['button', 'Push button'], ['preset', 'Preset']].map(([k, l]) => ({ label: t(l), onClick: () => {
          area.value = insertInHeader(area.value, controlLine(k, area.value));
          check();
        } })),
      ]) }, icon('Plus', 16), t('Add a control')),
      h('button', { class: 'b tb', type: 'button', onClick: () => check() }, icon('Check', 16), t('Check')),
      h('button', { class: 'b tb', type: 'button', onClick: async () => {
        const p = await check();
        if (p) await saveFile(p.id + '.astudio-plugin.js', area.value, 'text/javascript');
      } }, icon('Share2', 16), t('Export file')),
      h('button', { class: 'b tb', type: 'button', onClick: () => openExternal(DOCS_URL + '#dsp') }, icon('BookOpen', 16), t('dsp helpers')),
    ),
    h('div', { class: 'code-wrap' }, gutter, area),
    status,
    keys,
  );
  openModal({
    title: t('Plugin editor'),
    body,
    wide: true,
    onClose: () => off(),
    actions: [
      { label: t('Close') },
      { label: t('Install and try'), primary: true, onClick: () => {
        install().then(async (p) => {
          if (!p) return;
          if (p.type === 'effect') {
            show(t('Installed. Playing a test beat through the effect. Add it to a mixer insert with the FX button.'), true);
            if (engine) await engine.previewEffect(p, {});
          } else if (p.type === 'extension') show(t('Installed. Its buttons, panels and menu items are now in the app.'), true);
          else {
            show(t('Installed. Playing a test chord. Use the keys below to play it.'), true);
            if (onTry) onTry(p);
          }
        });
        return false; // keep the editor open
      } },
    ],
  });
  check();
  renderGutter();
}
