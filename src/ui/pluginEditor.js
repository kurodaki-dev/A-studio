import { h, icon, openModal, confirmBox } from './dom.js';
import { t } from '../i18n.js';
import { parsePlugin, installPlugin } from '../plugins.js';
import { saveFile } from '../platform.js';

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

// Write, install and try a plugin inside the app.
export function openPluginEditor({ code, onInstalled, onTry }) {
  const area = h('textarea', { class: 'code-editor', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', wrap: 'off', 'aria-label': t('Plugin code') });
  area.value = code || INSTRUMENT_TEMPLATE;
  const status = h('div', { class: 'editor-status', role: 'status' });
  const show = (msg, ok) => {
    status.textContent = msg;
    status.classList.toggle('ok', !!ok);
    status.classList.toggle('err', !ok);
  };
  // Tab key inserts two spaces instead of leaving the field.
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b, value } = area;
      area.value = value.slice(0, a) + '  ' + value.slice(b);
      area.selectionStart = area.selectionEnd = a + 2;
    }
  });
  const check = () => {
    try {
      const p = parsePlugin(area.value);
      const kind = p.type === 'effect' ? t('effect') : p.type === 'extension' ? t('extension') : t('instrument');
      const extra = p.type === 'extension' ? t('Permissions: ') + (p.permissions.join(', ') || t('none')) : p.params.length + ' ' + t('controls');
      show(t('Header OK: ') + p.name + ' (' + kind + ', ' + extra + ')', true);
      return p;
    } catch (e) {
      show(String(e.message || e), false);
      return null;
    }
  };
  const useTemplate = async (tpl) => {
    if (area.value.trim() && ![INSTRUMENT_TEMPLATE, EFFECT_TEMPLATE, EXTENSION_TEMPLATE].includes(area.value) && !(await confirmBox(t('Replace the code'), t('The code in the editor will be replaced by the template.'), t('Replace')))) return;
    area.value = tpl;
    check();
  };
  const body = h('div', { class: 'editor' },
    h('div', { class: 'set-actions editor-bar' },
      h('button', { class: 'b tb', type: 'button', onClick: () => useTemplate(INSTRUMENT_TEMPLATE) }, icon('Piano', 16), t('Instrument template')),
      h('button', { class: 'b tb', type: 'button', onClick: () => useTemplate(EFFECT_TEMPLATE) }, icon('AudioWaveform', 16), t('Effect template')),
      h('button', { class: 'b tb', type: 'button', onClick: () => useTemplate(EXTENSION_TEMPLATE) }, icon('Puzzle', 16), t('Extension template')),
      h('button', { class: 'b tb', type: 'button', onClick: () => check() }, icon('Check', 16), t('Check')),
      h('button', { class: 'b tb', type: 'button', onClick: async () => {
        const p = check();
        if (p) await saveFile(p.id + '.astudio-plugin.js', area.value, 'text/javascript');
      } }, icon('Share2', 16), t('Export file')),
    ),
    area,
    status,
  );
  openModal({
    title: t('Plugin editor'),
    body,
    wide: true,
    actions: [
      { label: t('Close') },
      { label: t('Install and try'), primary: true, onClick: () => {
        try {
          const p = installPlugin(area.value);
          show(p.type === 'effect' ? t('Installed. Add it to a mixer insert with the FX button.') : p.type === 'extension' ? t('Installed. Its buttons, panels and menu items are now in the app.') : t('Installed. Playing a test chord.'), true);
          onInstalled && onInstalled(p);
          if (p.type === 'instrument' && onTry) onTry(p);
        } catch (e) {
          show(String(e.message || e), false);
        }
        return false; // keep the editor open
      } },
    ],
  });
  check();
}
