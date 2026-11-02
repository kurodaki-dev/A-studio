# astudio-mcp

MCP server that lets an AI assistant work in **A Studio** on your phone: read the project, write notes, add channels, change the tempo, play and stop.

```
AI app (Claude Desktop, Claude Code, Cursor...)  --MCP (stdio)-->  astudio-mcp  --WebSocket (local network)-->  A Studio + AI Connect plugin
```

## 1. Install the bridge on your computer

Requires Node.js 20 or newer.

```bash
git clone https://github.com/kurodaki-dev/A-studio.git
cd A-studio/mcp-server
npm install
```

## 2. Add it to your AI app

Pick a pairing code (6 letters or digits) so it stays the same between launches. Replace the path with yours.

**Claude Desktop**: Settings, Developer, Edit Config, then in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "astudio": {
      "command": "node",
      "args": ["/path/to/A-studio/mcp-server/src/index.js", "--code", "ABC234"]
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add astudio -- node /path/to/A-studio/mcp-server/src/index.js --code ABC234
```

**Other MCP apps** (Cursor, VS Code, ...): add a stdio server with the command `node /path/to/A-studio/mcp-server/src/index.js --code ABC234`.

Options: `--port 8765` (default) and `--code`. Environment variables `ASTUDIO_PORT` and `ASTUDIO_CODE` work too. Without `--code`, a new code is generated at each launch and printed in the server log.

## 3. Connect the app

1. In A Studio, install the **AI Connect (MCP)** plugin: Menu, Plugins and themes, Browse the catalog.
2. Open Menu, Settings: a new **AI connection (MCP)** section is there.
3. Enter the bridge address, `ws://` + your computer's local IP + `:8765` (for example `ws://192.168.1.20:8765`; the server log prints it), and the pairing code.
4. Turn on **Connect**. The status shows Connected and the top bar shows **AI on**.

The phone and the computer must be on the same network. If it does not connect, allow incoming connections on port 8765 in your computer's firewall.

## Tools

| Tool | What it does |
|---|---|
| `connection_status` | Whether the app is connected, and the pairing code |
| `get_project` | Name, tempo, patterns, channels and their notes in the current pattern |
| `list_instruments` | Instruments accepted by `add_channel` (built in and plugins) |
| `get_notes`, `set_notes`, `add_notes`, `clear_notes` | Read and write notes of the current pattern |
| `add_channel` | Add a channel with an instrument |
| `select_pattern` | Make a pattern current |
| `set_tempo`, `set_mode`, `play`, `stop` | Playback |
| `preview_note` | Play one note to audition a sound |

Notes use steps (16 per bar) for position and length, MIDI keys (60 is C5) and velocity from 0 to 1. Every change can be undone in the app.

## Security and privacy

- The bridge only accepts the app after it sends the pairing code.
- The app only does what the AI Connect plugin's permissions allow, and only while Connect is on.
- What the AI reads from your project (names, notes, tempo) goes to the AI service you use, under that service's terms.
