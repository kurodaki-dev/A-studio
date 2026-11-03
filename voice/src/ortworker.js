// Web Worker that runs ONNX Runtime: DiffSinger models take seconds per phrase, and on
// the page thread they froze the whole interface. The page talks to it through the
// facade of ortclient.js (same API as onnxruntime-web: InferenceSession.create, run,
// Tensor), so the engines do not know the difference.
import * as ort from 'onnxruntime-web/wasm';

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

const sessions = new Map();
let next = 1;

self.onmessage = async (e) => {
  const { id, op } = e.data;
  try {
    if (op === 'create') {
      const s = await ort.InferenceSession.create(new Uint8Array(e.data.bytes), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      const sid = next++;
      sessions.set(sid, s);
      self.postMessage({ id, ok: true, sid, inputNames: [...s.inputNames], outputNames: [...s.outputNames] });
    } else if (op === 'run') {
      const s = sessions.get(e.data.sid);
      if (!s) throw new Error('ONNX session released');
      const feeds = {};
      for (const [k, t] of Object.entries(e.data.feeds)) feeds[k] = new ort.Tensor(t.type, t.data, t.dims);
      const out = await s.run(feeds);
      const res = {};
      const transfer = [];
      for (const [k, t] of Object.entries(out)) {
        const data = t.data;
        res[k] = { type: t.type, data, dims: [...t.dims] };
        transfer.push(data.buffer);
      }
      self.postMessage({ id, ok: true, out: res }, transfer);
    } else if (op === 'release') {
      const s = sessions.get(e.data.sid);
      if (s && s.release) await s.release();
      sessions.delete(e.data.sid);
      self.postMessage({ id, ok: true });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
