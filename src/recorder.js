// Microphone recording into the playlist. The audio stays on the device: it is
// stored as a sample (IndexedDB) and placed as an audio clip.
import { addSample } from './samples.js';

export const micSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

let rec = null;

// Opens the microphone and starts recording. Resolves when recording runs.
export async function startMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const chunks = [];
  const mr = new MediaRecorder(stream);
  mr.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
  const done = new Promise((resolve) => {
    mr.onstop = () => resolve(new Blob(chunks, { type: mr.mimeType || 'audio/webm' }));
  });
  mr.start();
  rec = { mr, stream, done, startedAt: performance.now() };
  return rec;
}

export const micRecording = () => !!rec;

async function stopRaw() {
  if (!rec) return null;
  const r = rec;
  rec = null;
  r.mr.stop();
  for (const tr of r.stream.getTracks()) tr.stop();
  const blob = await r.done;
  return blob.arrayBuffer();
}

// Stops and stores the take. Resolves to { id } or null.
export async function stopMic(name) {
  const bytes = await stopRaw();
  if (!bytes || !bytes.byteLength) return null;
  const id = await addSample(name, 'Recordings', bytes);
  return { id };
}

// Live microphone into an audio node (to hear the voice effects while singing).
// Returns a stop function. Latency depends on the device: use headphones.
export async function startMonitor(ctx, dest) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0 } });
  const src = ctx.createMediaStreamSource(stream);
  src.connect(dest);
  return () => {
    try {
      src.disconnect();
    } catch {
      /* already disconnected */
    }
    for (const tr of stream.getTracks()) tr.stop();
  };
}

// Microphone analyser for the tuner. Returns { analyser, stop }.
export async function openAnalyser(ctx) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  src.connect(analyser);
  return {
    analyser,
    stop() {
      src.disconnect();
      for (const tr of stream.getTracks()) tr.stop();
    },
  };
}

// Recording latency: plays clicks through the speaker, records them with the
// microphone and measures how late they arrive in the recording. Resolves to ms.
export async function measureLatency(ctx) {
  await startMic();
  const t0 = ctx.currentTime;
  const clicks = [0.7, 1.2, 1.7, 2.2];
  for (const c of clicks) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 1500;
    g.gain.setValueAtTime(0.9, t0 + c);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + c + 0.03);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t0 + c);
    o.stop(t0 + c + 0.04);
  }
  await new Promise((r) => setTimeout(r, 2900));
  const bytes = await stopRaw();
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const buf = await new OAC(1, 1, 44100).decodeAudioData(bytes);
  return latencyFromRecording(buf.getChannelData(0), buf.sampleRate, clicks);
}

// Median delay (ms) between the expected click times and the onsets found after them.
export function latencyFromRecording(d, sr, clicks) {
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak < 0.02) throw new Error('No click heard. Turn the volume up and try again.');
  const th = peak * 0.4;
  const delays = [];
  for (const c of clicks) {
    const a = Math.floor(c * sr);
    const b = Math.min(d.length, a + Math.floor(0.45 * sr));
    for (let i = a; i < b; i++) {
      if (Math.abs(d[i]) > th) {
        delays.push(((i - a) / sr) * 1000);
        break;
      }
    }
  }
  if (delays.length < 2) throw new Error('The clicks were not found in the recording.');
  delays.sort((x, y) => x - y);
  return Math.round(delays[Math.floor(delays.length / 2)]);
}
