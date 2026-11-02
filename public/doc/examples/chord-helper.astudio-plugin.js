/**
 * @astudio-plugin
 * @id chord-helper
 * @name Chord Helper
 * @version 1.0.0
 * @author A Studio
 * @type extension
 * @permissions ui project-read project-write audio storage
 */

// Shortcut (keyboard): Alt+C opens the panel.
astudio.ui.addShortcut({ id: 'open', key: 'alt+c', label: 'Chord Helper' }, () => astudio.ui.openPanel('chords'));

astudio.ui.addPanel({
  id: 'chords',
  title: 'Chords',
  icon: 'Piano',
  html: `
<style>
  body { margin: 0; padding: 14px; font: 14px system-ui, sans-serif; background: #2f383d; color: #d5dcdf; }
  h1 { font-size: 15px; margin: 14px 0 8px; color: #f0993a; }
  h1:first-child { margin-top: 0; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
  button, select { font: inherit; padding: 9px 12px; background: #384349; color: inherit; border: 1px solid #161b1e; border-radius: 2px; }
  button.on { background: #f0993a; color: #1b1206; }
  button.go { background: #8fcf6a; color: #10200a; font-weight: 700; }
  .chord { min-width: 64px; }
  #prog { font: 13px ui-monospace, monospace; background: #12181b; padding: 8px; min-height: 20px; border: 1px solid #161b1e; }
</style>
<h1>Channel</h1>
<div class="row"><select id="channel"></select></div>
<h1>Key</h1>
<div class="row"><select id="root"></select><select id="scale"><option value="major">Major</option><option value="minor">Minor</option></select></div>
<h1>Tap chords to build a progression</h1>
<div class="row" id="degrees"></div>
<div id="prog"></div>
<div class="row" style="margin-top:8px">
  <button id="undo">Remove last</button>
  <button id="arp">Block chords</button>
  <button class="go" id="write">Write to the pattern</button>
</div>
<h1>Saved progressions</h1>
<div class="row"><button id="save">Save</button><span id="saved"></span></div>
<script>
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  const ROMAN = { major: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'], minor: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'] };
  const $ = (id) => document.getElementById(id);
  let prog = [];
  let arp = false;
  for (let i = 0; i < 12; i++) $('root').append(new Option(NAMES[i], i));

  // Chord on a scale degree: three notes stacked in thirds, around C5.
  function chord(degree) {
    const scale = SCALES[$('scale').value];
    const root = 60 + Number($('root').value);
    return [0, 2, 4].map((i) => root + scale[(degree + i) % 7] + 12 * Math.floor((degree + i) / 7));
  }
  function showProg() {
    $('prog').textContent = prog.length ? prog.map((d) => ROMAN[$('scale').value][d]).join('  ') : 'Empty';
  }
  function buildDegrees() {
    $('degrees').replaceChildren(...ROMAN[$('scale').value].map((name, d) => {
      const b = document.createElement('button');
      b.className = 'chord';
      b.textContent = name;
      b.onclick = () => {
        prog.push(d);
        showProg();
        const ch = $('channel').value;
        for (const key of chord(d)) astudio.audio.playNote({ channel: ch, key, length: 0.6, velocity: 0.7 });
      };
      return b;
    }));
    showProg();
  }
  $('scale').onchange = buildDegrees;
  $('undo').onclick = () => { prog.pop(); showProg(); };
  $('arp').onclick = () => { arp = !arp; $('arp').textContent = arp ? 'Arpeggio' : 'Block chords'; $('arp').classList.toggle('on', arp); };

  // One chord per bar (16 steps).
  $('write').onclick = async () => {
    if (!prog.length) return astudio.ui.hint('Add chords first');
    const notes = [];
    prog.forEach((d, bar) => {
      chord(d).forEach((key, i) => {
        if (arp) for (let s = 0; s < 16; s += 2) notes.push({ step: bar * 16 + s, length: 2, key: chord(d)[(s / 2) % 3], velocity: 0.7 });
        else notes.push({ step: bar * 16, length: 15, key, velocity: 0.72 - i * 0.04 });
      });
    });
    const unique = arp ? notes.filter((n, i) => notes.findIndex((m) => m.step === n.step) === i) : notes;
    const n = await astudio.project.setNotes($('channel').value, unique);
    astudio.ui.hint('Chord Helper: ' + n + ' notes written');
  };

  async function showSaved() {
    const list = (await astudio.storage.get('progressions')) || [];
    $('saved').replaceChildren(...list.map((p, i) => {
      const b = document.createElement('button');
      b.textContent = p.name;
      b.onclick = () => { $('root').value = p.root; $('scale').value = p.scale; buildDegrees(); prog = p.prog.slice(); showProg(); };
      return b;
    }));
  }
  $('save').onclick = async () => {
    if (!prog.length) return;
    const list = (await astudio.storage.get('progressions')) || [];
    list.push({ name: NAMES[$('root').value] + ' ' + $('scale').value + ' ' + (list.length + 1), root: $('root').value, scale: $('scale').value, prog });
    await astudio.storage.set('progressions', list.slice(-12));
    showSaved();
  };

  async function loadChannels() {
    const p = await astudio.project.get();
    const keep = $('channel').value;
    $('channel').replaceChildren(...p.channels.map((c) => new Option(c.name, c.id)));
    const piano = p.channels.find((c) => c.instrument === 'piano');
    $('channel').value = p.channels.some((c) => c.id === keep) ? keep : piano ? piano.id : (p.channels[0] || {}).id;
  }
  astudio.on('project', loadChannels);
  loadChannels();
  buildDegrees();
  showSaved();
</script>`,
});
