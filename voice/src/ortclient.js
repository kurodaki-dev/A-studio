// Page side of ortworker.js: an object shaped like onnxruntime-web ({ Tensor,
// InferenceSession, env }) whose sessions live in a Web Worker.
let worker = null;
let seq = 1;
const pending = new Map();

function call(msg, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL('./ortworker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      const err = new Error('ONNX worker: ' + (e.message || 'failed to start'));
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker = null;
    };
  }
  const id = seq++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer);
  });
}

export class Tensor {
  constructor(type, data, dims) {
    this.type = type;
    this.data = data;
    this.dims = dims ? [...dims] : [data.length];
  }
}

class Session {
  constructor(sid, inputNames, outputNames) {
    this.sid = sid;
    this.inputNames = inputNames;
    this.outputNames = outputNames;
  }
  async run(feeds) {
    const f = {};
    for (const [k, t] of Object.entries(feeds)) f[k] = { type: t.type, data: t.data, dims: t.dims };
    const r = await call({ op: 'run', sid: this.sid, feeds: f });
    const out = {};
    for (const [k, t] of Object.entries(r.out)) out[k] = new Tensor(t.type, t.data, t.dims);
    return out;
  }
  async release() {
    await call({ op: 'release', sid: this.sid });
  }
}

export const ortClient = {
  Tensor,
  env: { wasm: {} },
  InferenceSession: {
    // bytes: Uint8Array. Its buffer is handed to the worker (no copy), so the caller
    // must not use it afterwards.
    async create(bytes) {
      const buf = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
      const r = await call({ op: 'create', bytes: buf }, [buf]);
      return new Session(r.sid, r.inputNames, r.outputNames);
    },
  },
};
