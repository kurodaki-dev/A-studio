// Link between the MCP server and the A Studio app, over a WebSocket on the
// local network. The app connects to this bridge and must send the pairing
// code first; other connections are closed.
import { WebSocketServer } from 'ws';
import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newPairingCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export function createBridge({ port = 8765, host = '0.0.0.0', code, log = () => {}, timeout = 15000 } = {}) {
  const wss = new WebSocketServer({ port, host, maxPayload: 1024 * 1024 });
  let app = null; // { ws, info }
  let next = 0;
  const pending = new Map();

  const rejectAll = (msg) => {
    for (const p of pending.values()) p.reject(new Error(msg));
    pending.clear();
  };

  wss.on('connection', (ws, req) => {
    let paired = false;
    const kick = setTimeout(() => ws.close(4000, 'No pairing message'), 5000);
    ws.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!paired) {
        clearTimeout(kick);
        if (!m || m.type !== 'hello' || String(m.code || '').toUpperCase() !== code) {
          log('Refused a connection from ' + req.socket.remoteAddress + ' (wrong pairing code)');
          ws.send(JSON.stringify({ type: 'refused', reason: 'Wrong pairing code' }));
          ws.close(4001, 'Wrong pairing code');
          return;
        }
        paired = true;
        if (app) app.ws.close(4002, 'Replaced by a new connection');
        app = { ws, info: { name: String(m.app || 'A Studio'), version: String(m.version || '') } };
        ws.send(JSON.stringify({ type: 'welcome' }));
        log('A Studio connected from ' + req.socket.remoteAddress);
        return;
      }
      if ((m.type === 'result' || m.type === 'error') && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.type === 'result') p.resolve(m.result);
        else p.reject(new Error(String(m.message || 'Error in A Studio')));
      }
    });
    ws.on('close', () => {
      clearTimeout(kick);
      if (app && app.ws === ws) {
        app = null;
        rejectAll('A Studio disconnected');
        log('A Studio disconnected');
      }
    });
  });

  return {
    get port() {
      const a = wss.address();
      return a && typeof a === 'object' ? a.port : port;
    },
    code,
    connected: () => !!app,
    info: () => (app ? app.info : null),
    // Ask the app to run a tool. Resolves with its result.
    call(tool, args = {}) {
      if (!app) return Promise.reject(new Error('A Studio is not connected. In the app, open Settings, AI connection (MCP), enter this computer\'s address and the pairing code ' + code + ', then turn on Connect.'));
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('A Studio did not answer in time'));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        app.ws.send(JSON.stringify({ type: 'call', id, tool, args }));
      });
    },
    close: () => new Promise((resolve) => {
      rejectAll('Bridge closed');
      for (const c of wss.clients) c.terminate();
      wss.close(() => resolve());
    }),
    ready: () => new Promise((resolve, reject) => {
      if (wss.address()) return resolve();
      wss.once('listening', resolve);
      wss.once('error', reject);
    }),
  };
}
