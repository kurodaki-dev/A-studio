import { openFxDialog } from './fxDialog.js';
import { h, promptText, openMenu } from './dom.js';
import { knob, fader, led } from './controls.js';
import { store } from '../store.js';
import { faderGain } from '../audio/engine.js';
import { t } from '../i18n.js';

const dbText = (v) => {
  const gn = faderGain(v);
  if (gn <= 0) return '-inf dB';
  const db = 20 * Math.log10(gn);
  return (db > 0 ? '+' : '') + db.toFixed(1) + ' dB';
};

export function createMixer(engine, onShowPlugins) {
  const strips = h('div', { class: 'mixer-strips' });
  const el = h('div', { class: 'panel mixer' },
    h('div', { class: 'ptools' }, h('div', { class: 'grp' }, h('span', { class: 'ptitle' }, 'Mixer'), h('span', { class: 'rack-info' }, t('Drag vertically to adjust, double tap to reset')))),
    h('div', { class: 'mixer-scroll' }, strips),
  );
  let items = [];
  let sig = '';

  function build() {
    const mx = store.project.mixer;
    items = mx.map((m, i) => {
      const name = h('button', { class: 'strip-name', type: 'button', title: t('Rename'), onClick: async () => {
        if (i === 0) return;
        const v = await promptText(t('Rename insert'), m.name);
        if (v) store.change(() => { m.name = v; });
      } }, m.name);
      const meter = h('canvas', { class: 'meter', width: 8, height: 120 });
      const fd = fader({ value: m.vol, label: 'Volume ' + m.name, format: dbText, onStart: () => store.commit(), onInput: (v) => { m.vol = v; store.emit(); } });
      const pan = knob({
        value: m.pan, min: -1, max: 1, def: 0, size: 24, label: t('Pan ') + m.name,
        format: (v) => (Math.abs(v) < 0.01 ? t('Center') : Math.round(Math.abs(v) * 100) + '% ' + (v < 0 ? t('left') : t('right'))),
        onStart: () => store.commit(), onInput: (v) => { m.pan = v; store.emit(); },
      });
      const rev = i === 0 ? null : knob({ value: m.reverb, size: 22, label: t('Reverb ') + m.name, onStart: () => store.commit(), onInput: (v) => { m.reverb = v; store.emit(); } });
      const del = i === 0 ? null : knob({ value: m.delay, size: 22, label: t('Delay ') + m.name, onStart: () => store.commit(), onInput: (v) => { m.delay = v; store.emit(); } });
      const eqFmt = (v) => (Math.abs(v) < 0.05 ? '0 dB' : (v > 0 ? '+' : '') + v.toFixed(1) + ' dB');
      const eq = [t('Low'), t('Mid'), t('High')].map((lab, k) => knob({
        value: (m.eq || [0, 0, 0])[k], min: -18, max: 18, def: 0, size: 20, label: lab + ' ' + m.name, format: eqFmt,
        onStart: () => store.commit(),
        onInput: (v) => { if (!m.eq) m.eq = [0, 0, 0]; m.eq[k] = v; store.emit(); },
      }));
      const mute = led(!m.mute, t('Insert enabled'), () => store.change(() => { m.mute = !m.mute; }));
      const solo = i === 0 ? null : h('button', { class: 'b tb solo', type: 'button', title: 'Solo', onClick: () => store.change(() => { m.solo = !m.solo; }) }, 'S');
      const route = i === 0 ? null : h('button', { class: 'b tb route-btn', type: 'button', title: t('Send this insert to the master or to a bus'), onClick: (e) => {
        openMenu(e.currentTarget, [
          { header: t('Output of ') + m.name },
          { label: 'Master', checked: !m.route, onClick: () => store.change(() => { m.route = 0; }) },
          ...store.project.mixer.map((x, j) => (j > i ? { label: j + '  ' + x.name, checked: m.route === j, onClick: () => store.change(() => { m.route = j; }) } : null)).filter(Boolean),
        ]);
      } });
      const fxBtn = h('button', { class: 'b tb fxbtn', type: 'button', title: t('Effects'), onClick: () => openFxDialog(i, engine, onShowPlugins) }, 'FX');
      const strip = h('div', { class: 'strip' + (i === 0 ? ' master' : '') },
        h('div', { class: 'strip-num' }, i === 0 ? 'M' : String(i)),
        name,
        h('div', { class: 'strip-fx' },
          rev ? h('label', { class: 'kl' }, rev, h('span', null, t('Rev'))) : null,
          del ? h('label', { class: 'kl' }, del, h('span', null, t('Delay'))) : null,
        ),
        h('div', { class: 'strip-eq', title: t('Equalizer') },
          eq.map((kn, k) => h('label', { class: 'kl' }, kn, h('span', null, ['L', 'M', 'H'][k]))),
        ),
        h('label', { class: 'kl' }, pan, h('span', null, 'Pan')),
        h('div', { class: 'strip-fader' }, meter, fd),
        h('div', { class: 'strip-btns' }, mute, solo),
        route,
        fxBtn,
      );
      return { m, i, strip, meter, fd, pan, rev, del, eq, mute, solo, route, fxBtn, peak: 0 };
    });
    strips.replaceChildren(...items.map((x) => x.strip));
    patch();
  }

  function patch() {
    for (const it of items) {
      const m = it.m;
      it.fd.update(m.vol);
      it.pan.update(m.pan);
      if (it.rev) it.rev.update(m.reverb);
      if (it.del) it.del.update(m.delay);
      it.eq.forEach((kn, k) => kn.update((m.eq || [0, 0, 0])[k]));
      if (it.route) {
        it.route.textContent = '→ ' + (m.route ? String(m.route) : 'M');
        it.route.classList.toggle('on', !!m.route);
      }
      it.mute.update(!m.mute);
      if (it.solo) it.solo.classList.toggle('on', m.solo);
      const n = (m.fx || []).filter((f) => f.on !== false).length;
      it.fxBtn.textContent = n ? 'FX ' + n : 'FX';
      it.fxBtn.classList.toggle('on', n > 0);
    }
  }

  function drawMeters() {
    for (const it of items) {
      const lv = engine.level(it.i);
      it.peak = Math.max(lv, it.peak * 0.9);
      const g = it.meter.getContext('2d');
      const H = it.meter.height;
      g.fillStyle = '#14191b';
      g.fillRect(0, 0, 8, H);
      const db = it.peak > 0 ? 20 * Math.log10(it.peak) : -100;
      const frac = Math.max(0, Math.min(1, (db + 48) / 54));
      const hh = Math.round(frac * H);
      g.fillStyle = db > -1 ? '#e0605a' : db > -9 ? '#e4c14f' : '#8fcf6a';
      g.fillRect(0, H - hh, 8, hh);
    }
  }

  return {
    el,
    update() {
      const s = store.gen + '|' + store.project.mixer.map((m) => m.name).join('|');
      if (s !== sig) {
        sig = s;
        build();
      } else patch();
    },
    frame() {
      if (engine.ctx) drawMeters();
    },
  };
}
