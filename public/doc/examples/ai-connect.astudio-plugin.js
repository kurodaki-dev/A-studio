/**
 * @astudio-plugin
 * @id ai-connect
 * @name AI Connect (MCP)
 * @version 1.0.0
 * @author A Studio
 * @type extension
 * @permissions ui transport project-read project-write audio network
 */

// Connects A Studio to an AI assistant through the astudio-mcp bridge
// (see the mcp-server folder of the repository). The bridge runs on your
// computer next to the AI app; this extension carries out the tools the AI
// calls: read the project, write notes, add channels, set the tempo, play.

let socket = null;
let retry = null;

astudio.settings.addSection({
  title: 'AI connection (MCP)',
  description: 'Run astudio-mcp on your computer and add it to your AI app (Claude Desktop, Claude Code, Cursor...). Enter the address and the pairing code it shows, then turn on Connect. The phone and the computer must be on the same network.',
  fields: [
    { id: 'address', type: 'text', label: 'Bridge address', placeholder: 'ws://192.168.1.20:8765' },
    { id: 'code', type: 'text', label: 'Pairing code', placeholder: 'ABC234' },
    { id: 'connect', type: 'toggle', label: 'Connect', value: false },
    { id: 'status', type: 'info', label: 'Status', value: 'Not connected' },
  ],
});

function indicator(state) {
  const label = state === 'on' ? 'AI on' : state === 'wait' ? 'AI...' : 'AI off';
  astudio.ui.addButton({ id: 'ai', label, icon: 'Bot' }, async () => {
    const s = await astudio.settings.get();
    if (s.connect) disconnect(true);
    else {
      await astudio.settings.set('connect', true);
      connect();
    }
  });
}
indicator('off');

const status = (text, state) => {
  astudio.settings.set('status', text);
  indicator(state);
};

// The tools of the bridge, carried out with the astudio API.
const TOOLS = {
  async get_project() {
    const p = await astudio.project.get();
    for (const c of p.channels) c.notes = await astudio.project.getNotes(c.id);
    return p;
  },
  list_instruments: () => astudio.project.instruments(),
  get_notes: (a) => astudio.project.getNotes(a.channel),
  set_notes: (a) => astudio.project.setNotes(a.channel, a.notes || []),
  add_notes: (a) => astudio.project.addNotes(a.notes || []),
  clear_notes: (a) => astudio.project.clearNotes(a.channel),
  add_channel: (a) => astudio.project.addChannel(a.instrument, a.name),
  select_pattern: (a) => astudio.project.selectPattern(a.pattern),
  set_tempo: (a) => astudio.transport.setTempo(a.bpm),
  set_mode: (a) => astudio.transport.setMode(a.mode),
  play: () => astudio.transport.play(),
  stop: () => astudio.transport.stop(),
  preview_note: (a) => astudio.audio.playNote({ channel: a.channel, instrument: a.instrument, key: a.key }),
};

async function handle(m) {
  const run = TOOLS[m.tool];
  try {
    if (!run) throw new Error('Unknown tool ' + m.tool);
    const result = await run(m.args || {});
    socket.send(JSON.stringify({ type: 'result', id: m.id, result: result === undefined ? null : result }));
    astudio.ui.hint('AI: ' + m.tool.replace(/_/g, ' '));
  } catch (err) {
    socket.send(JSON.stringify({ type: 'error', id: m.id, message: String((err && err.message) || err) }));
  }
}

async function connect() {
  clearTimeout(retry);
  const s = await astudio.settings.get();
  if (!s.address || !s.code) {
    status('Enter the bridge address and the pairing code', 'off');
    await astudio.settings.set('connect', false);
    return;
  }
  if (socket) return;
  status('Connecting to ' + s.address + '...', 'wait');
  try {
    socket = await astudio.net.connect(s.address.trim(), async (e) => {
      if (e.type === 'open') socket.send(JSON.stringify({ type: 'hello', code: s.code.trim().toUpperCase(), app: 'A Studio' }));
      else if (e.type === 'message') {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.type === 'welcome') status('Connected. The AI can now work in A Studio.', 'on');
        else if (m.type === 'refused') {
          status('Refused: ' + m.reason, 'off');
          await astudio.settings.set('connect', false);
        } else if (m.type === 'call') handle(m);
      } else if (e.type === 'close') {
        socket = null;
        const now = await astudio.settings.get();
        if (now.connect) {
          status('Disconnected, retrying in 5 seconds', 'wait');
          retry = setTimeout(connect, 5000);
        } else status('Not connected', 'off');
      }
    });
  } catch (err) {
    socket = null;
    status('Could not connect: ' + err.message, 'off');
  }
}

async function disconnect(fromButton) {
  clearTimeout(retry);
  if (fromButton) await astudio.settings.set('connect', false);
  if (socket) await socket.close();
  socket = null;
  status('Not connected', 'off');
}

astudio.on('settings', (e) => {
  if (e.id === 'connect') e.value ? connect() : disconnect(false);
});

// Reconnect on start when Connect was left on.
astudio.settings.get().then((s) => {
  if (s.connect) connect();
});
