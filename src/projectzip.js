// Project export with its samples: a ZIP holding project.json and every sample the
// project uses (imported samples, recordings, renders), so it opens complete on
// another device.
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { serialize } from './store.js';
import { getSampleRecord, putSampleWithId } from './samples.js';

export function usedSampleIds(project) {
  const ids = new Set();
  for (const c of project.channels) {
    if (c.sample) ids.add(c.sample);
    for (const z of c.zones || []) ids.add(z.sample);
  }
  for (const c of project.playlist.clips) if (c.type === 'audio') ids.add(c.sampleId);
  return [...ids];
}

export async function exportProjectZip(project) {
  const files = { 'project.json': strToU8(serialize(project)) };
  const index = [];
  for (const id of usedSampleIds(project)) {
    const rec = await getSampleRecord(id);
    if (!rec) continue;
    files['samples/' + id] = new Uint8Array(rec.bytes);
    index.push({ id, name: rec.name, folder: rec.folder });
  }
  files['samples.json'] = strToU8(JSON.stringify(index));
  return zipSync(files, { level: 1 });
}

// Returns { raw (project object), added } after storing the samples.
export async function importProjectZip(bytes) {
  const files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (!files['project.json']) throw new Error('No project.json in this ZIP');
  const raw = JSON.parse(strFromU8(files['project.json']));
  let index = [];
  try {
    index = JSON.parse(strFromU8(files['samples.json'] || strToU8('[]')));
  } catch {
    index = [];
  }
  let added = 0;
  for (const s of index) {
    if (!s || typeof s.id !== 'string' || !/^[\w-]{1,80}$/.test(s.id)) continue;
    const data = files['samples/' + s.id];
    if (!data) continue;
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    if (await putSampleWithId(s.id, String(s.name || 'Sample').slice(0, 80), String(s.folder || 'Imported').slice(0, 120), ab).catch(() => false)) added += 1;
  }
  return { raw, added };
}
