// Automation clips: a curve of points [tick in clip, value 0..1] that drives one
// mixer or channel parameter while the song plays.
import { faderGain, cutoffHz } from './audio/levels.js';
import { t } from './i18n.js';
import { AUTO_TARGET } from './store.js';
import { getPlugin } from './plugins.js';

// Value of the curve at a tick inside the clip (linear between points).
export function autoValue(points, tick) {
  if (!points || !points.length) return 0.5;
  if (tick <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i];
    if (tick <= t1) {
      const [t0, v0] = points[i - 1];
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (tick - t0)) / (t1 - t0);
    }
  }
  return points[points.length - 1][1];
}

const MIXER_PARAMS = [['vol', 'Volume'], ['pan', 'Pan'], ['reverb', 'Reverb send'], ['delay', 'Delay send'], ['eq0', 'EQ low'], ['eq1', 'EQ mid'], ['eq2', 'EQ high']];
const CHANNEL_PARAMS = [['vol', 'Volume'], ['pan', 'Pan'], ['cutoff', 'Filter cutoff'], ['reso', 'Filter resonance']];

// Every parameter that can be automated, for the target picker.
export function autoTargets(project) {
  const out = [];
  for (const c of project.channels) for (const [k, l] of CHANNEL_PARAMS) out.push({ id: 'channel:' + c.id + ':' + k, label: c.name + ': ' + t(l), group: t('Channels') });
  project.mixer.forEach((m, i) => {
    for (const [k, l] of MIXER_PARAMS) if (i > 0 || (k !== 'reverb' && k !== 'delay')) out.push({ id: 'mixer:' + i + ':' + k, label: (i === 0 ? 'Master' : m.name) + ': ' + t(l), group: t('Mixer') });
  });
  project.mixer.forEach((m, i) => {
    (m.fx || []).forEach((f, k) => {
      const p = f && getPlugin(f.plugin);
      if (!p) return;
      for (const prm of p.params) if (prm.kind === 'knob') out.push({ id: 'fx:' + i + ':' + k + ':' + prm.id, label: (i === 0 ? 'Master' : m.name) + ': ' + (p.builtin ? t(p.name) : p.name) + ': ' + prm.name, group: t('Effects') });
    });
  });
  return out;
}

export function autoLabel(project, target) {
  const x = autoTargets(project).find((a) => a.id === target);
  return x ? x.label : target;
}

function parse(target) {
  const m = AUTO_TARGET.exec(target || '');
  if (!m) return null;
  if (m[6] != null) return { kind: 'fx', index: Number(m[6]), slot: Number(m[7]), param: m[8] };
  return m[2] != null ? { kind: 'mixer', index: Number(m[2]), param: m[3] } : { kind: 'channel', id: m[4], param: m[5] };
}

// Effect parameter driven by a clip: { slot, plugin, def } or null.
export function fxTarget(project, target) {
  const p = parse(target);
  if (!p || p.kind !== 'fx') return null;
  const m = project.mixer[p.index];
  const slot = m && m.fx && m.fx[p.slot];
  const plugin = slot && getPlugin(slot.plugin);
  const def = plugin && plugin.params.find((x) => x.id === p.param && x.kind === 'knob');
  return def ? { index: p.index, slotIndex: p.slot, slot, plugin, def } : null;
}

// Current value of the target in the project, as 0..1.
export function targetValue(project, target) {
  const p = parse(target);
  if (!p) return 0.5;
  if (p.kind === 'fx') {
    const fx = fxTarget(project, target);
    if (!fx) return 0.5;
    const v = fx.slot.params && Number.isFinite(fx.slot.params[fx.def.id]) ? fx.slot.params[fx.def.id] : fx.def.def;
    return (v - fx.def.min) / (fx.def.max - fx.def.min || 1);
  }
  if (p.kind === 'mixer') {
    const m = project.mixer[p.index];
    if (!m) return 0.5;
    if (p.param === 'pan') return (m.pan + 1) / 2;
    if (p.param.startsWith('eq')) return ((m.eq || [0, 0, 0])[Number(p.param[2])] + 18) / 36;
    return m[p.param];
  }
  const c = project.channels.find((x) => x.id === p.id);
  if (!c) return 0.5;
  if (p.param === 'pan') return (c.pan + 1) / 2;
  if (p.param === 'vol') return c.vol;
  return c.params[p.param];
}

// Readable value for the editor.
export function formatTarget(target, v, project) {
  const p = parse(target);
  if (!p) return v.toFixed(2);
  if (p.kind === 'fx') {
    const fx = project && fxTarget(project, target);
    if (!fx) return Math.round(v * 100) + '%';
    const x = fx.def.min + v * (fx.def.max - fx.def.min);
    return (Math.abs(x) >= 100 ? Math.round(x) : x.toFixed(2)) + ' ' + fx.def.name;
  }
  if (p.param === 'pan') return Math.abs(v - 0.5) < 0.01 ? t('Center') : Math.round(Math.abs(v * 2 - 1) * 100) + '% ' + (v < 0.5 ? t('left') : t('right'));
  if (p.param.startsWith('eq')) return (v * 36 - 18).toFixed(1) + ' dB';
  if (p.param === 'cutoff') return Math.round(cutoffHz(v)) + ' Hz';
  if (p.kind === 'mixer' && p.param === 'vol') {
    const g = faderGain(v);
    return g <= 0 ? '-inf dB' : (20 * Math.log10(g)).toFixed(1) + ' dB';
  }
  return Math.round(v * 100) + '%';
}

// The AudioParam a target drives in a graph, and how a 0..1 value maps to it.
export function targetParam(G, target) {
  const p = parse(target);
  if (!p || p.kind === 'fx') return null;
  if (p.kind === 'mixer') {
    const ins = G.inserts[p.index];
    if (!ins) return null;
    if (p.param === 'vol') return { param: ins.vol.gain, map: faderGain };
    if (p.param === 'pan') return { param: ins.pan.pan, map: (v) => v * 2 - 1 };
    if (p.param === 'reverb') return ins.sr ? { param: ins.sr.gain, map: (v) => v } : null;
    if (p.param === 'delay') return ins.sd ? { param: ins.sd.gain, map: (v) => v } : null;
    return { param: ins.eq[Number(p.param[2])].gain, map: (v) => v * 36 - 18 };
  }
  const ch = G.channels.get(p.id);
  if (!ch) return null;
  if (p.param === 'vol') return { param: ch.in.gain, map: (v) => v };
  if (p.param === 'pan') return { param: ch.pan.pan, map: (v) => v * 2 - 1 };
  if (p.param === 'cutoff') return { param: ch.filt.frequency, map: cutoffHz };
  return { param: ch.filt.Q, map: (v) => 0.7 + v * 14 };
}
