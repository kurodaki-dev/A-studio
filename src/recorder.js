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

// Stops and stores the take. Resolves to { id, duration } or null.
export async function stopMic(name) {
  if (!rec) return null;
  const r = rec;
  rec = null;
  r.mr.stop();
  for (const tr of r.stream.getTracks()) tr.stop();
  const blob = await r.done;
  const bytes = await blob.arrayBuffer();
  if (!bytes.byteLength) return null;
  const id = await addSample(name, 'Recordings', bytes);
  return { id };
}
