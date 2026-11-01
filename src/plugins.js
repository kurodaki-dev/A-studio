// Instrument plugins. A plugin is a JSON file that describes a synth
// (oscillators, envelope, filter, LFO). No code from a plugin is ever run:
// every value is checked and clamped before use. Format: see /doc.
const KEY = 'astudio:plugins';
const WAVES = ['sine', 'square', 'sawtooth', 'triangle', 'noise'];
const FILTERS = ['lowpass', 'highpass', 'bandpass'];
const CATS = ['drums', 'keys', 'bass', 'synth', 'strings', 'winds', 'mallets'];

const clamp = (v, a, b, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d);
const str = (v, max, d) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d);

// Returns a clean plugin object or throws an Error with a readable message.
export function validatePlugin(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a JSON object');
  if (raw.type !== 'astudio-plugin') throw new Error('"type" must be "astudio-plugin"');
  if (raw.kind !== 'instrument') throw new Error('"kind" must be "instrument"');
  const id = str(raw.id, 40, '').toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error('"id" must use a to z, 0 to 9 and "-" only');
  const name = str(raw.name, 40, '');
  if (!name) throw new Error('"name" is required');
  const oscs = Array.isArray(raw.oscillators) ? raw.oscillators.slice(0, 8) : [];
  if (!oscs.length) throw new Error('At least one oscillator is required');
  const env = raw.envelope || {};
  const f = raw.filter || null;
  const lfo = raw.lfo || null;
  return {
    type: 'astudio-plugin',
    kind: 'instrument',
    id,
    name,
    version: str(raw.version, 20, '1.0.0'),
    author: str(raw.author, 60, ''),
    category: CATS.includes(raw.category) ? raw.category : 'synth',
    gain: clamp(raw.gain, 0, 1, 0.2),
    oneShot: !!raw.oneShot,
    length: clamp(raw.length, 0.05, 20, 2),
    oscillators: oscs.map((o) => ({
      wave: WAVES.includes(o && o.wave) ? o.wave : 'sine',
      octave: Math.round(clamp(o && o.octave, -3, 3, 0)),
      detune: clamp(o && o.detune, -1200, 1200, 0),
      gain: clamp(o && o.gain, 0, 1, 0.5),
    })),
    envelope: {
      attack: clamp(env.attack, 0, 10, 0.005),
      decay: clamp(env.decay, 0.001, 10, 0.2),
      sustain: clamp(env.sustain, 0, 1, 0.7),
      release: clamp(env.release, 0.005, 10, 0.2),
    },
    filter: f
      ? {
          type: FILTERS.includes(f.type) ? f.type : 'lowpass',
          cutoff: clamp(f.cutoff, 20, 20000, 4000),
          q: clamp(f.q, 0.1, 30, 0.7),
          envAmount: clamp(f.envAmount, -20000, 20000, 0),
          envDecay: clamp(f.envDecay, 0.001, 10, 0.2),
        }
      : null,
    lfo: lfo
      ? {
          target: lfo.target === 'filter' ? 'filter' : 'pitch',
          rate: clamp(lfo.rate, 0.01, 30, 5),
          depth: clamp(lfo.depth, 0, 2400, 0),
        }
      : null,
  };
}

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.map((p) => { try { return validatePlugin(p); } catch { return null; } }).filter(Boolean) : [];
  } catch {
    return [];
  }
}

let cache = read();

export const pluginInstruments = () => cache;
export const getPlugin = (id) => cache.find((p) => p.id === id) || null;

export function installPlugin(raw) {
  const p = validatePlugin(raw);
  const list = cache.filter((x) => x.id !== p.id);
  list.push(p);
  localStorage.setItem(KEY, JSON.stringify(list));
  cache = list;
  instruments.delete(p.id);
  return p;
}

export function removePlugin(id) {
  cache = cache.filter((x) => x.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
  instruments.delete(id);
}

function noiseBuffer(ctx) {
  if (ctx.__pnoise) return ctx.__pnoise;
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  ctx.__pnoise = b;
  return b;
}

// Build a playable instrument (same interface as audio/instruments.js).
function build(p) {
  return {
    oneShot: p.oneShot,
    release: p.envelope.release,
    play(ctx, out, t, freq, vel) {
      const e = p.envelope;
      const g = ctx.createGain();
      g.connect(out);
      const peak = p.gain * (0.35 + vel * 0.65);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + e.attack + 0.001);
      g.gain.setTargetAtTime(peak * e.sustain, t + e.attack + 0.001, e.decay / 3);
      let dest = g;
      let filt = null;
      if (p.filter) {
        filt = ctx.createBiquadFilter();
        filt.type = p.filter.type;
        filt.Q.value = p.filter.q;
        const base = p.filter.cutoff;
        const top = Math.max(20, Math.min(20000, base + p.filter.envAmount * vel));
        filt.frequency.setValueAtTime(top, t);
        filt.frequency.setTargetAtTime(base, t + 0.001, p.filter.envDecay / 3);
        filt.connect(g);
        dest = filt;
      }
      const sources = [];
      const pitched = [];
      for (const o of p.oscillators) {
        const og = ctx.createGain();
        og.gain.value = o.gain;
        og.connect(dest);
        let s;
        if (o.wave === 'noise') {
          s = ctx.createBufferSource();
          s.buffer = noiseBuffer(ctx);
          s.loop = true;
        } else {
          s = ctx.createOscillator();
          s.type = o.wave;
          s.frequency.setValueAtTime(freq * Math.pow(2, o.octave), t);
          s.detune.setValueAtTime(o.detune, t);
          pitched.push(s);
        }
        s.connect(og);
        s.start(t);
        sources.push(s);
      }
      if (p.lfo && p.lfo.depth > 0) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = p.lfo.rate;
        const lg = ctx.createGain();
        lg.gain.value = p.lfo.depth;
        lfo.connect(lg);
        if (p.lfo.target === 'filter' && filt) lg.connect(filt.frequency);
        else for (const s of pitched) lg.connect(s.detune);
        lfo.start(t);
        sources.push(lfo);
      }
      return { sources, length: p.oneShot ? p.length : undefined };
    },
  };
}

const instruments = new Map();
export function pluginInstrument(id) {
  if (instruments.has(id)) return instruments.get(id);
  const p = getPlugin(id);
  if (!p) return null;
  const inst = build(p);
  instruments.set(id, inst);
  return inst;
}
