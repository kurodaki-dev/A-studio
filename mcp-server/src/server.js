// MCP server: the tools an AI assistant can use to work in A Studio.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const INSTRUCTIONS = `A Studio is a music production app (FL Studio style) on the user's phone.
Conventions: a pattern bar has 16 steps (1/16 notes). Note positions and lengths are in steps.
key is a MIDI number where 60 is C5 (middle C). velocity is 0 to 1.
Drum channels play their sound at key 60. Notes are written to the current pattern.
Start with get_project to see the channels. Use add_channel with list_instruments to add sounds.
Every change can be undone in the app with Undo.`;

const note = z.object({
  step: z.number().min(0).describe('Start, in 1/16 steps from the start of the pattern'),
  length: z.number().min(0.05).optional().describe('Length in steps, default 1'),
  key: z.number().int().min(0).max(131).optional().describe('MIDI key, 60 = C5, default 60'),
  velocity: z.number().min(0).max(1).optional().describe('0 to 1, default 0.78'),
});

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

export function createMcpServer(bridge, version = '1.0.0') {
  const server = new McpServer({ name: 'astudio', version }, { instructions: INSTRUCTIONS });

  const tool = (name, title, description, inputSchema, args = (a) => a) => {
    server.registerTool(name, { title, description, inputSchema }, async (input) => {
      try {
        return text(await bridge.call(name, args(input || {})));
      } catch (e) {
        return { ...text(String(e.message || e)), isError: true };
      }
    });
  };

  server.registerTool('connection_status', { title: 'Connection status', description: 'Tells whether the A Studio app is connected to this server, and the pairing code to enter in the app.', inputSchema: {} }, async () =>
    text({ connected: bridge.connected(), app: bridge.info(), port: bridge.port, pairingCode: bridge.code }));

  tool('get_project', 'Read the project', 'Name, tempo, patterns, channels (id, name, instrument) and the notes of every channel in the current pattern.', {});
  tool('list_instruments', 'List instruments', 'Built in instruments and installed plugin instruments that add_channel accepts.', {});
  tool('get_notes', 'Read notes', 'Notes of one channel in the current pattern.', { channel: z.string().describe('Channel id or name') });
  tool('set_notes', 'Replace notes', 'Replaces all notes of one channel in the current pattern.', { channel: z.string().describe('Channel id or name'), notes: z.array(note).max(4096) });
  tool('add_notes', 'Add notes', 'Adds notes to channels of the current pattern.', { notes: z.array(note.extend({ channel: z.string().describe('Channel id or name') })).max(4096) });
  tool('clear_notes', 'Clear notes', 'Clears the notes of one channel, or of every channel when channel is omitted, in the current pattern.', { channel: z.string().optional() });
  tool('add_channel', 'Add a channel', 'Adds a channel to the channel rack with an instrument from list_instruments.', { instrument: z.string().describe('Instrument id, for example piano, bass, kick, plugin:poly-synth'), name: z.string().max(40).optional() });
  tool('select_pattern', 'Select a pattern', 'Makes a pattern current (by id or name).', { pattern: z.string() });
  tool('set_tempo', 'Set the tempo', 'Sets the tempo in BPM (10 to 522).', { bpm: z.number().min(10).max(522) });
  tool('set_mode', 'Pattern or song mode', 'pattern plays the current pattern, song plays the playlist.', { mode: z.enum(['pattern', 'song']) });
  tool('play', 'Play', 'Starts playback.', {});
  tool('stop', 'Stop', 'Stops playback.', {});
  tool('preview_note', 'Play a note', 'Plays one note right away on a channel or an instrument, to audition a sound.', { channel: z.string().optional(), instrument: z.string().optional(), key: z.number().int().min(0).max(131).optional() });

  return server;
}
