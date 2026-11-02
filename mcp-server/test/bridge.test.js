import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBridge } from '../src/bridge.js';
import { createMcpServer } from '../src/server.js';

async function setup() {
  const bridge = createBridge({ port: 0, host: '127.0.0.1', code: 'ABC234', timeout: 2000 });
  await bridge.ready();
  const server = createMcpServer(bridge);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  return { bridge, server, client };
}

// A fake A Studio app: pairs, then answers tool calls.
function fakeApp(port, code, handler) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', code, app: 'A Studio', version: 'test' })));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'welcome') resolve(ws);
      if (m.type === 'refused') reject(new Error(m.reason));
      if (m.type === 'call') {
        try {
          ws.send(JSON.stringify({ type: 'result', id: m.id, result: handler(m.tool, m.args) }));
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', id: m.id, message: e.message }));
        }
      }
    });
    ws.on('error', reject);
  });
}

test('tools are listed with their schemas', async () => {
  const { bridge, client } = await setup();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ['connection_status', 'get_project', 'set_notes', 'add_notes', 'add_channel', 'set_tempo', 'play', 'stop']) assert.ok(names.includes(n), n);
  const setNotes = tools.find((t) => t.name === 'set_notes');
  assert.deepEqual(setNotes.inputSchema.required.sort(), ['channel', 'notes']);
  await client.close();
  await bridge.close();
});

test('calls reach the app and results come back', async () => {
  const { bridge, client } = await setup();
  const seen = [];
  const ws = await fakeApp(bridge.port, 'abc234', (tool, args) => {
    seen.push([tool, args]);
    if (tool === 'get_project') return { name: 'Demo', bpm: 128 };
    if (tool === 'add_channel') throw new Error('Unknown instrument');
    return true;
  });
  const status = JSON.parse((await client.callTool({ name: 'connection_status', arguments: {} })).content[0].text);
  assert.equal(status.connected, true);
  const project = await client.callTool({ name: 'get_project', arguments: {} });
  assert.deepEqual(JSON.parse(project.content[0].text), { name: 'Demo', bpm: 128 });
  await client.callTool({ name: 'set_notes', arguments: { channel: 'Kick', notes: [{ step: 0 }, { step: 4, velocity: 0.5 }] } });
  assert.deepEqual(seen[1], ['set_notes', { channel: 'Kick', notes: [{ step: 0 }, { step: 4, velocity: 0.5 }] }]);
  const err = await client.callTool({ name: 'add_channel', arguments: { instrument: 'theremin' } });
  assert.equal(err.isError, true);
  assert.match(err.content[0].text, /Unknown instrument/);
  const bad = await client.callTool({ name: 'set_tempo', arguments: { bpm: 9999 } });
  assert.equal(bad.isError, true, 'schema rejects out of range values');
  ws.close();
  await client.close();
  await bridge.close();
});

test('a wrong pairing code is refused and calls explain how to connect', async () => {
  const { bridge, client } = await setup();
  await assert.rejects(fakeApp(bridge.port, 'WRONG1', () => true), /Wrong pairing code/);
  const r = await client.callTool({ name: 'get_project', arguments: {} });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not connected.*ABC234/s);
  await client.close();
  await bridge.close();
});
