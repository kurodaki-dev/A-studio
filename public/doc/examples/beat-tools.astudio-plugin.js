/**
 * @astudio-plugin
 * @id beat-tools
 * @name Beat Tools
 * @version 1.0.0
 * @author A Studio
 * @type extension
 * @permissions ui transport project-read project-write
 */

// 1. A Play / Stop button in the top bar that follows the playback state.
function playButton(playing) {
  astudio.ui.addButton({ id: 'play', label: playing ? 'Stop' : 'Play', icon: playing ? 'Square' : 'Play' }, () => astudio.transport.toggle());
}
playButton(false);
let wasPlaying = false;
astudio.on('state', (s) => {
  if (s.playing !== wasPlaying) {
    wasPlaying = s.playing;
    playButton(s.playing);
  }
});

// 2. An entry in the menu.
astudio.ui.addMenuItem({ id: 'clear', label: 'Clear the pattern', icon: 'Eraser' }, async () => {
  await astudio.project.clearNotes();
  astudio.ui.hint('Pattern cleared');
});

// 3. A panel with its own interface. Its HTML has its own script, which
//    uses the same astudio API.
astudio.ui.addPanel({
  id: 'generator',
  title: 'Beat generator',
  icon: 'Drum',
  html: `
<style>
  body { margin: 0; padding: 16px; font: 14px system-ui, sans-serif; background: #2f383d; color: #d5dcdf; }
  h1 { font-size: 16px; margin: 0 0 12px; color: #f0993a; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; align-items: center; }
  button { font: inherit; padding: 10px 14px; background: #384349; color: inherit; border: 1px solid #161b1e; border-radius: 2px; }
  button.on { background: #f0993a; color: #1b1206; }
  button.go { background: #8fcf6a; color: #10200a; font-weight: 700; }
  input[type=range] { width: 200px; accent-color: #f0993a; }
  #tempo { font: 600 22px ui-monospace, monospace; color: #b9e08a; background: #12181b; padding: 6px 12px; border: 1px solid #161b1e; }
</style>
<h1>Beat generator</h1>
<div class="row" id="styles"></div>
<div class="row"><label>Density <input id="density" type="range" min="0" max="1" step="0.05" value="0.5"></label></div>
<div class="row"><button class="go" id="go">Generate</button><button id="play">Play / Stop</button></div>
<h1>Tap tempo</h1>
<div class="row"><button id="tap">Tap</button><span id="tempo">--</span></div>
<script>
  const STYLES = {
    'Four on the floor': { kick: [0, 4, 8, 12], clap: [4, 12], hat: [2, 6, 10, 14], snare: [] },
    'Trap': { kick: [0, 7, 10], clap: [8], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], snare: [15] },
    'Breakbeat': { kick: [0, 10], clap: [], hat: [0, 2, 4, 6, 8, 10, 12, 14], snare: [4, 12, 15] },
  };
  let style = 'Four on the floor';
  const box = document.getElementById('styles');
  for (const name of Object.keys(STYLES)) {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => { style = name; [...box.children].forEach((x) => x.classList.toggle('on', x === b)); };
    if (name === style) b.classList.add('on');
    box.append(b);
  }
  document.getElementById('go').onclick = async () => {
    const density = Number(document.getElementById('density').value);
    const project = await astudio.project.get();
    const byInstrument = (id) => project.channels.find((c) => c.instrument === id);
    const notes = [];
    for (const [inst, steps] of Object.entries(STYLES[style])) {
      const ch = byInstrument(inst);
      if (!ch) continue;
      await astudio.project.clearNotes(ch.id);
      for (const step of steps) notes.push({ channel: ch.id, step, velocity: 0.6 + Math.random() * 0.3 });
      // extra random hits, more with a higher density
      for (let s = 0; s < 16; s++) if (!steps.includes(s) && Math.random() < density * 0.15) notes.push({ channel: ch.id, step: s, velocity: 0.45 });
    }
    const n = await astudio.project.addNotes(notes);
    astudio.ui.hint(style + ': ' + n + ' notes');
  };
  document.getElementById('play').onclick = () => astudio.transport.toggle();
  let taps = [];
  document.getElementById('tap').onclick = async () => {
    const now = performance.now();
    taps = taps.filter((x) => now - x < 2500).concat(now);
    if (taps.length >= 3) {
      const gaps = taps.slice(1).map((x, i) => x - taps[i]);
      const bpm = Math.round(60000 / (gaps.reduce((a, b) => a + b) / gaps.length));
      document.getElementById('tempo').textContent = await astudio.transport.setTempo(bpm);
    }
  };
</script>`,
});
