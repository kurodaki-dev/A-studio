#!/usr/bin/env node
// Entry point: MCP over stdio for the AI app, WebSocket bridge for A Studio.
// Everything printed for humans goes to stderr: stdout carries MCP messages.
import { networkInterfaces } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBridge, newPairingCode } from './bridge.js';
import { createMcpServer } from './server.js';

const arg = (name) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const port = Number(arg('port') || process.env.ASTUDIO_PORT || 8765);
const code = String(arg('code') || process.env.ASTUDIO_CODE || newPairingCode()).toUpperCase();
const log = (msg) => process.stderr.write('[astudio-mcp] ' + msg + '\n');

const bridge = createBridge({ port, code, log });
await bridge.ready();
const addresses = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => 'ws://' + a.address + ':' + port);
log('Waiting for A Studio on ' + (addresses.join(', ') || 'ws://<this computer>:' + port));
log('Pairing code: ' + code);

const server = createMcpServer(bridge);
await server.connect(new StdioServerTransport());
