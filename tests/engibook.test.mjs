import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { ASSET_DIRECTORIES, BookConflictError, importBook, inspectBook, sha256 } from '../src/engibook.ts';

const id = 'Example-PSU';
const root = `Assets/${id}`;
const note = `${id}.md`;

async function fixture(mutate = () => {}) {
  const files = {
    [note]: strToU8(`![[${root}/2d_scaled_component/panel.excalidraw.md]]\n[[${root}/manuals/manual.pdf#page=11]]\n\n\`\`\`engiware\nmodel: ${root}/3d_rendered/model.glb\nimage: ${root}/3d_rendered/image.png\n\`\`\`\n`),
    [`${root}/schematic/logic.excalidraw.md`]: strToU8('native logic reference'),
    [`${root}/manuals/manual.pdf`]: new Uint8Array([37, 80, 68, 70, 0, 255]),
    [`${root}/2d_scaled_component/panel.excalidraw.md`]: strToU8('native scaled component'),
    [`${root}/3d_rendered/model.glb`]: new Uint8Array([103, 108, 84, 70, 255, 0, 31]),
    [`${root}/3d_rendered/image.png`]: new Uint8Array([137, 80, 78, 71, 0, 255]),
  };
  const manifest = {
    format: 'engibook', formatVersion: 1, id, title: 'Example power supply', entrypoint: note, assetRoot: root,
    files: await Promise.all(Object.entries(files).map(async ([path, bytes]) => ({ path, bytes: bytes.length, sha256: await sha256(bytes) }))),
  };
  mutate(files, manifest);
  return { bytes: zipSync({ ...files, 'engibook.json': strToU8(JSON.stringify(manifest)) }), files, manifest };
}

class MemoryVault {
  nodes = new Map();
  content = new Map();
  writes = [];
  beforeWrite = () => {};
  getAllLoadedFiles() { return [...this.nodes.values()]; }
  getAbstractFileByPath(path) { return this.nodes.get(path) ?? null; }
  getFileByPath(path) { const node = this.nodes.get(path); return node?.kind === 'file' ? node : null; }
  getFolderByPath(path) { const node = this.nodes.get(path); return node?.kind === 'folder' ? node : null; }
  async createFolder(path) {
    assert(!this.nodes.has(path), `Folder already exists: ${path}`);
    const folder = { path, kind: 'folder' };
    this.nodes.set(path, folder);
    this.writes.push(path);
    return folder;
  }
  async createBinary(path, bytes) {
    this.beforeWrite(path);
    assert(!this.nodes.has(path), `File already exists: ${path}`);
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    assert(!parent || this.getFolderByPath(parent), `Parent missing: ${parent}`);
    const file = { path, kind: 'file' };
    this.nodes.set(path, file);
    this.content.set(path, new Uint8Array(bytes).slice());
    this.writes.push(path);
    return file;
  }
  async readBinary(file) { return this.content.get(file.path).slice().buffer; }
}

test('extracts a multi-file component byte-for-byte and reimport is idempotent', async () => {
  const { bytes, files } = await fixture();
  const vault = new MemoryVault();
  const result = await importBook(vault, bytes);
  assert.equal(result.entry.path, note);
  assert.equal(result.created, Object.keys(files).length + 1);
  assert.equal(vault.writes.at(-1), note, 'entry note must be written after its assets');
  for (const directory of ASSET_DIRECTORIES) assert(vault.getFolderByPath(`${root}/${directory}`));
  for (const [path, content] of Object.entries(files)) assert.deepEqual(vault.content.get(path), content);
  const before = vault.writes.length;
  const again = await importBook(vault, bytes);
  assert.equal(again.created, 0);
  assert.equal(again.reused, result.created);
  assert.equal(vault.writes.length, before);
});

test('detects edited destinations before writing any missing files', async () => {
  const { bytes } = await fixture();
  const vault = new MemoryVault();
  await importBook(vault, bytes);
  vault.content.set(note, strToU8('My local engineering changes'));
  const missing = `${root}/manuals/manual.pdf`;
  vault.nodes.delete(missing);
  vault.content.delete(missing);
  const before = vault.writes.length;
  await assert.rejects(importBook(vault, bytes), BookConflictError);
  assert.equal(vault.writes.length, before);
  assert.equal(new TextDecoder().decode(vault.content.get(note)), 'My local engineering changes');
  assert(!vault.nodes.has(missing));
});

test('rejects file/folder and case-insensitive destination collisions', async () => {
  const { bytes } = await fixture();
  for (const path of ['Assets', note.toLowerCase()]) {
    const vault = new MemoryVault();
    await vault.createBinary(path, strToU8('existing').buffer);
    const before = vault.writes.length;
    await assert.rejects(importBook(vault, bytes), BookConflictError);
    assert.equal(vault.writes.length, before);
  }
});

test('interrupted writes can resume without overwriting completed files', async () => {
  const { bytes } = await fixture();
  const vault = new MemoryVault();
  let writes = 0;
  vault.beforeWrite = () => { if (++writes === 3) throw new Error('Storage interrupted'); };
  await assert.rejects(importBook(vault, bytes), /Storage interrupted/);
  assert(!vault.getFileByPath(note));
  const partialFiles = vault.content.size;
  vault.beforeWrite = () => {};
  const result = await importBook(vault, bytes);
  assert.equal(result.reused, partialFiles);
  assert(vault.getFileByPath(note));
});

test('cancellation stops extraction and can resume', async () => {
  const { bytes } = await fixture();
  const vault = new MemoryVault();
  const cancelled = AbortSignal.abort();
  await assert.rejects(importBook(vault, bytes, cancelled), { name: 'AbortError' });
  assert.equal(vault.writes.length, 0);
  const task = new AbortController();
  vault.beforeWrite = () => task.abort();
  await assert.rejects(importBook(vault, bytes, task.signal), { name: 'AbortError' });
  assert.equal(vault.content.size, 1);
  vault.beforeWrite = () => {};
  await importBook(vault, bytes);
  assert(vault.getFileByPath(note));
});

test('checks all file hashes before touching the vault', async () => {
  const { bytes } = await fixture(files => { files[`${root}/manuals/manual.pdf`][5] = 7; });
  const vault = new MemoryVault();
  await assert.rejects(importBook(vault, bytes), /checksum mismatch/);
  assert.equal(vault.writes.length, 0);
});

test('rejects traversal, hidden configuration, unknown members, versions and missing notes', async () => {
  for (const path of ['../escape.md', '/absolute.md', '.obsidian/plugins/test/main.js', `${root}/manuals/../../escape.md`, 'extra.txt']) {
    const { bytes } = await fixture(files => { files[path] = strToU8('unexpected'); });
    const vault = new MemoryVault();
    await assert.rejects(importBook(vault, bytes));
    assert.equal(vault.writes.length, 0);
  }
  const version = await fixture((_, manifest) => { manifest.formatVersion = 99; });
  await assert.rejects(inspectBook(version.bytes), /version/);
  const missing = await fixture(files => { delete files[note]; });
  await assert.rejects(inspectBook(missing.bytes), /Missing/);
  await assert.rejects(inspectBook(strToU8('not a zip')));
});

test('rejects duplicate path casing and file/implicit-directory collisions', async () => {
  const duplicate = await fixture(files => { files[`${root}/manuals/MANUAL.pdf`] = strToU8('duplicate'); });
  await assert.rejects(inspectBook(duplicate.bytes), /Duplicate/);
  const collision = await fixture((files, manifest) => {
    const path = `${root}/manuals/manual.pdf/child.txt`;
    files[path] = strToU8('child');
    manifest.files.push({ path, bytes: 5, sha256: '0'.repeat(64) });
  });
  await assert.rejects(inspectBook(collision.bytes), /collision/);
});

test('distributed demo imports with its full binary resources', async () => {
  const bytes = new Uint8Array(await readFile(new URL('../examples/Demo-Component.engibook', import.meta.url)));
  const vault = new MemoryVault();
  const result = await importBook(vault, bytes);
  assert.equal(result.manifest.id, 'Demo-Component');
  assert.equal(result.manifest.files.length, 7);
  const archive = unzipSync(bytes);
  for (const file of result.manifest.files) assert.deepEqual(vault.content.get(file.path), archive[file.path]);
  const model = vault.content.get('Assets/Demo-Component/3d_rendered/model.glb');
  assert.equal(new TextDecoder().decode(model.subarray(0, 4)), 'glTF');
  const header = new DataView(model.buffer, model.byteOffset, model.byteLength);
  assert.equal(header.getUint32(8, true), model.byteLength);
  const gltf = JSON.parse(new TextDecoder().decode(model.subarray(20, 20 + header.getUint32(12, true))));
  assert.deepEqual(gltf.extras.dimensions_mm, [40, 80, 30]);
});
