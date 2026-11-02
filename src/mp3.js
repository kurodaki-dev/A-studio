// MP3 encoding with LAME (lamejs, LGPL). Loaded on demand as a separate file.
export async function encodeMp3(channels, sampleRate, kbps = 192, onProgress) {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const enc = new Mp3Encoder(2, sampleRate, kbps);
  const toInt = (f) => {
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  };
  const L = toInt(channels[0]);
  const R = toInt(channels[1] || channels[0]);
  const parts = [];
  const block = 1152 * 20;
  for (let i = 0; i < L.length; i += block) {
    const buf = enc.encodeBuffer(L.subarray(i, i + block), R.subarray(i, i + block));
    if (buf.length) parts.push(new Uint8Array(buf));
    if (onProgress && i % (block * 20) === 0) {
      onProgress(i / L.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end));
  const size = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
