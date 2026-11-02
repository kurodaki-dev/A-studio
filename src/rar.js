// RAR sample packs (RAR 4 and RAR 5): read with the official unrar code compiled to
// WebAssembly. Loaded only when a .rar file is imported (about 300 KB).

let defaults = null;
async function loadDefaults() {
  if (!defaults) {
    const [lib, wasm] = await Promise.all([import('node-unrar-js'), import('node-unrar-js/esm/js/unrar.wasm?url')]);
    const res = await fetch(wasm.default);
    if (!res.ok) throw new Error('unrar.wasm: HTTP ' + res.status);
    defaults = { createExtractorFromData: lib.createExtractorFromData, wasmBinary: await res.arrayBuffer() };
  }
  return defaults;
}

// Files of a RAR archive accepted by filter(name), as { path: Uint8Array }.
// deps ({ createExtractorFromData, wasmBinary }) is for the tests (Node).
export async function unrarFiles(bytes, filter = () => true, deps = null) {
  const { createExtractorFromData, wasmBinary } = deps || (await loadDefaults());
  const data = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const ex = await createExtractorFromData({ wasmBinary, data });
  const out = {};
  const { files } = ex.extract({ files: (hd) => !hd.flags.directory && !hd.flags.encrypted && filter(hd.name.replace(/\\/g, '/')) });
  for (const f of files) if (f.extraction) out[f.fileHeader.name.replace(/\\/g, '/')] = f.extraction;
  return out;
}
