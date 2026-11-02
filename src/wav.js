// PCM WAV encoder, 16 or 24 bit. channels: array of Float32Array of equal length.
export function encodeWav(channels, sampleRate, bits = 16) {
  const nc = channels.length;
  const n = channels[0].length;
  const bps = bits === 24 ? 3 : 2;
  const dataSize = n * nc * bps;
  const buffer = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buffer);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nc * bps, true);
  v.setUint16(32, nc * bps, true);
  v.setUint16(34, bps * 8, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      if (bps === 2) {
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      } else {
        const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        v.setUint8(o, x & 255);
        v.setUint8(o + 1, (x >> 8) & 255);
        v.setUint8(o + 2, (x >> 16) & 255);
      }
      o += bps;
    }
  }
  return buffer;
}
