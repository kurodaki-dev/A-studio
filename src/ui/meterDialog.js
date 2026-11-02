import { h, openModal, hint } from './dom.js';
import { store } from '../store.js';
import { ui } from '../ui-state.js';
import { renderChannels } from '../audio/engine.js';
import { measureLoudness, LOUDNESS_TARGETS } from '../loudness.js';
import { currentTheme } from '../themes.js';
import { t } from '../i18n.js';

// Live spectrum of the master (or an insert) and loudness of the rendered song.
export function openMeterDialog(engine, insert = 0) {
  engine.init();
  const cv = h('canvas', { class: 'spectrum', width: 720, height: 220, 'aria-label': t('Spectrum') });
  const result = h('div', { class: 'loud-result' }, t('Press Measure to render the song and measure its loudness.'));
  const bins = new Float32Array(engine.G.inserts[insert].an.frequencyBinCount);
  const wave = new Float32Array(engine.G.inserts[insert].an.fftSize);
  // View: spectrum (frequencies) or oscilloscope (the wave itself, like Wave Candy).
  let view = 'spectrum';
  const sr = engine.ctx.sampleRate;
  let alive = true;
  const g = cv.getContext('2d');
  function draw() {
    if (!alive) return;
    const th = currentTheme();
    const W = cv.width;
    const H = cv.height;
    g.fillStyle = th.colors.input;
    g.fillRect(0, 0, W, H);
    if (view === 'scope') {
      g.fillStyle = th.colors.dim;
      g.fillRect(0, H / 2, W, 1);
      const ins = engine.G && engine.G.inserts[insert];
      if (ins) {
        ins.an.getFloatTimeDomainData(wave);
        // Start on a rising zero crossing so the wave stands still.
        let s0 = 0;
        for (let i = 1; i < wave.length / 2; i++) if (wave[i - 1] < 0 && wave[i] >= 0) { s0 = i; break; }
        const n = wave.length / 2;
        g.strokeStyle = th.editor.note;
        g.lineWidth = 2;
        g.beginPath();
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * W;
          const y = H / 2 - Math.max(-1, Math.min(1, wave[s0 + i])) * H * 0.45;
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.stroke();
      }
      requestAnimationFrame(draw);
      return;
    }
    g.fillStyle = th.colors.dim;
    g.font = '11px system-ui, sans-serif';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = (Math.log10(f / 20) / Math.log10(20000 / 20)) * W;
      g.fillRect(x, 0, 1, H);
      g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x + 3, H - 4);
    }
    if (engine.spectrum(insert, bins)) {
      g.fillStyle = th.editor.note;
      const n = 96;
      for (let i = 0; i < n; i++) {
        const f0 = 20 * Math.pow(1000, i / n);
        const f1 = 20 * Math.pow(1000, (i + 1) / n);
        const a = Math.max(1, Math.floor((f0 / sr) * 2 * bins.length));
        const b = Math.max(a + 1, Math.floor((f1 / sr) * 2 * bins.length));
        let m = -140;
        for (let k = a; k < b && k < bins.length; k++) m = Math.max(m, bins[k]);
        const v = Math.max(0, Math.min(1, (m + 100) / 90));
        g.fillRect((i / n) * W + 1, H - v * H, W / n - 2, v * H);
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
  async function measure(btn) {
    btn.disabled = true;
    const mode = ui.songMode ? 'song' : 'pattern';
    result.textContent = t('Rendering...');
    try {
      const { channels, sampleRate } = await renderChannels(store.project, mode);
      const r = measureLoudness(channels, sampleRate);
      const lufs = Number.isFinite(r.lufs) ? r.lufs.toFixed(1) : '-inf';
      result.replaceChildren(
        h('div', { class: 'loud-big' }, lufs + ' LUFS'),
        h('div', null, t('Peak: ') + (Number.isFinite(r.peakDb) ? r.peakDb.toFixed(1) : '-inf') + ' dBFS' + (r.peakDb > -0.1 ? ' ' + t('(clipping risk: lower the master or use a limiter)') : '')),
        h('ul', null, LOUDNESS_TARGETS.map((x) => {
          const d = Number.isFinite(r.lufs) ? r.lufs - x.lufs : null;
          return h('li', null, t(x.name) + ': ' + x.lufs + ' LUFS' + (d == null ? '' : ' (' + (Math.abs(d) < 1 ? t('on target') : d > 0 ? '+' + d.toFixed(1) + ' LU, ' + t('turned down there') : d.toFixed(1) + ' LU, ' + t('quieter than the others')) + ')'));
        })),
      );
      hint(lufs + ' LUFS');
    } catch (e) {
      result.textContent = String((e && e.message) || e);
    }
    btn.disabled = false;
  }
  const viewBtn = h('button', { class: 'b tb', type: 'button', onClick: (e) => {
    view = view === 'spectrum' ? 'scope' : 'spectrum';
    e.currentTarget.textContent = view === 'spectrum' ? t('Oscilloscope') : t('Spectrum');
  } }, t('Oscilloscope'));
  const mBtn = h('button', { class: 'b tb primary', type: 'button', onClick: (e) => measure(e.currentTarget) }, t('Measure loudness'));
  openModal({
    title: insert === 0 ? t('Master: spectrum and loudness') : t('Spectrum'),
    wide: true,
    body: h('div', { class: 'meter-dlg' }, cv, h('div', { class: 'set-inline' }, viewBtn, mBtn, h('span', { class: 'set-note' }, ui.songMode ? t('Measures the whole song (SONG mode).') : t('Measures the current pattern (PAT mode).'))), result),
    onClose: () => { alive = false; },
  });
}
