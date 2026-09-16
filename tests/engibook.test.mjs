import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { ASSET_DIRECTORIES, BookConflictError, BookVersionError, bookFilename, compareBookVersions, componentIdentity, importBook as importWithApp, inspectBook, sha256 } from '../src/engibook.ts';

// The format/upgrade cases isolate vault-root behavior; deployment cases below
// exercise the default library and custom directory explicitly.
const importToDirectory = (vault, bytes, signal, directory) => importWithApp({ vault, fileManager: { trashFile: file => vault.delete(file) } }, bytes, signal, directory);
const importBook = (vault, bytes, signal) => importToDirectory(vault, bytes, signal, '');

const id = 'Example-PSU';
const root = `Assets/${id}`;
const note = `${id}.md`;

async function fixture(mutate = () => {}, identity) {
  const id = identity?.id ?? 'Example-PSU';
  const root = `Assets/${id}`;
  const note = `${id}.md`;
  const files = {
    [note]: strToU8(`![[${root}/2d_scaled_component/panel.excalidraw.md]]\n[[${root}/manuals/manual.pdf#page=11]]\n\n\`\`\`engiware\nmodel: ${root}/3d_rendered/model.glb\nimage: ${root}/3d_rendered/image.png\n\`\`\`\n`),
    [`${root}/schematic/logic.excalidraw.md`]: strToU8('native logic reference'),
    [`${root}/manuals/manual.pdf`]: new Uint8Array([37, 80, 68, 70, 0, 255]),
    [`${root}/2d_scaled_component/panel.excalidraw.md`]: strToU8('native scaled component'),
    [`${root}/3d_rendered/model.glb`]: new Uint8Array([103, 108, 84, 70, 255, 0, 31]),
    [`${root}/3d_rendered/image.png`]: new Uint8Array([137, 80, 78, 71, 0, 255]),
  };
  const manifest = {
    format: 'engibook', formatVersion: identity ? 2 : 1, id, ...identity, title: 'Example power supply', entrypoint: note, assetRoot: root,
    files: await Promise.all(Object.entries(files).map(async ([path, bytes]) => ({ path, bytes: bytes.length, sha256: await sha256(bytes) }))),
  };
  await mutate(files, manifest);
  return { bytes: zipSync({ ...files, 'engibook.json': strToU8(JSON.stringify(manifest)) }), files, manifest };
}

class MemoryVault {
  nodes = new Map();
  content = new Map();
  writes = [];
  deletes = [];
  listedFolders = [];
  beforeWrite = () => {};
  folder(path) {
    const vault = this;
    return {
      path, kind: 'folder',
      get children() {
        vault.listedFolders.push(path);
        return [...vault.nodes.values()].filter(node =>
          (node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '') === path);
      },
    };
  }
  getRoot() { return this.folder(''); }
  getAbstractFileByPath(path) { return this.nodes.get(path) ?? null; }
  getFileByPath(path) { const node = this.nodes.get(path); return node?.kind === 'file' ? node : null; }
  getFolderByPath(path) { const node = this.nodes.get(path); return node?.kind === 'folder' ? node : null; }
  async createFolder(path) {
    assert(!this.nodes.has(path), `Folder already exists: ${path}`);
    const folder = this.folder(path);
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
  async modifyBinary(file, bytes) {
    assert.equal(this.nodes.get(file.path), file);
    this.beforeWrite(file.path);
    this.content.set(file.path, new Uint8Array(bytes).slice());
    this.writes.push(file.path);
  }
  async delete(file) {
    this.nodes.delete(file.path);
    this.content.delete(file.path);
    this.deletes.push(file.path);
  }
}

test('extracts a multi-file component byte-for-byte and reimport is idempotent', async () => {
  const { bytes, files } = await fixture();
  const vault = new MemoryVault();
  const result = await importBook(vault, bytes);
  assert.equal(result.entry.path, note);
  assert.equal(result.created, Object.keys(files).length + 1);
  assert.equal(vault.writes.at(-2), note, 'entry note must be written after its assets');
  assert.equal(vault.writes.at(-1), `${root}/engibook.json`, 'installed receipt is committed last');
  for (const directory of ASSET_DIRECTORIES) assert(vault.getFolderByPath(`${root}/${directory}`));
  for (const [path, content] of Object.entries(files)) assert.deepEqual(vault.content.get(path), content);
  const before = vault.writes.length;
  const again = await importBook(vault, bytes);
  assert.equal(again.created, 0);
  assert.equal(again.reused, result.created);
  assert.equal(vault.writes.length, before);
});

const versionedId = 'AB_1606-XLE240E';
const versionedRoot = `Assets/${versionedId}`;
const versionedNote = `${versionedId}.md`;
const receiptPath = `${versionedRoot}/engibook.json`;
const pendingPath = `${versionedRoot}/engibook-import.json`;
const record = (vault, path = receiptPath) => JSON.parse(new TextDecoder().decode(vault.content.get(path)));

async function versionedFixture(version, edit = () => {}) {
  return fixture(async (files, manifest) => {
    edit(files, manifest);
    manifest.files = await Promise.all(Object.entries(files).map(async ([path, bytes]) => ({ path, bytes: bytes.length, sha256: await sha256(bytes) })));
  }, componentIdentity('AB', '1606-XLE240E', version));
}

test('versioned packages use underscore field boundaries and stable extraction paths', async () => {
  const book = await versionedFixture('1.0.0');
  const inspected = await inspectBook(book.bytes);
  assert.equal(bookFilename(inspected.manifest), 'AB_1606-XLE240E_1.0.0.engibook');
  assert.equal(inspected.manifest.entrypoint, versionedNote);
  assert.equal(inspected.manifest.assetRoot, versionedRoot);
  const vault = new MemoryVault();
  const first = await importBook(vault, book.bytes);
  assert.equal(first.updated, 0);
  assert.equal(first.created, book.manifest.files.length + 1);
  assert.equal(record(vault).engibookVersion, '1.0.0');
  assert(!vault.getAbstractFileByPath(pendingPath));
  assert.equal(vault.writes.at(-2), versionedNote);
  assert.equal(vault.writes.at(-1), receiptPath);
  const before = vault.writes.length;
  const again = await importBook(vault, book.bytes);
  assert.equal(again.created, 0);
  assert.equal(again.updated, 0);
  assert.equal(again.reused, first.created);
  assert.equal(vault.writes.length, before, 'same-version reimport should not rewrite even the receipt');
});

test('family brace identities preserve deployment links, membership properties, and upgrade ownership', async () => {
  const identity = componentIdentity('AB', '5069-L3{xx}ER{M}', '1.0.0');
  const root = `Assets/${identity.id}`;
  const make = version => fixture(async (files, manifest) => {
    files[manifest.entrypoint] = strToU8(`---\npart_number_pattern: "5069-L3{xx}ER{M}"\nassociated_part_numbers:\n  - 5069-L320ER\n  - 5069-L320ERM\n---\n\n[[${root}/manuals/manual.pdf]]\n\n\x60\x60\x60engiware\nmodel: ${root}/3d_rendered/model.glb\nimage: ${root}/3d_rendered/image.png\n\x60\x60\x60\nVersion ${version}\n`);
    manifest.files = await Promise.all(Object.entries(files).map(async ([path, bytes]) => ({ path, bytes: bytes.length, sha256: await sha256(bytes) })));
  }, componentIdentity('AB', '5069-L3{xx}ER{M}', version));
  const first = await make('1.0.0');
  assert.equal(bookFilename((await inspectBook(first.bytes)).manifest), 'AB_5069-L3{xx}ER{M}_1.0.0.engibook');
  const vault = new MemoryVault();
  await importToDirectory(vault, first.bytes, undefined, 'Engineering/Components');
  const notePath = `Engineering/Components/${identity.id}.md`;
  const note = new TextDecoder().decode(vault.content.get(notePath));
  assert(note.includes(`[[Engineering/Components/${root}/manuals/manual.pdf]]`));
  assert(note.includes(`model: Engineering/Components/${root}/3d_rendered/model.glb`));
  assert(note.includes('associated_part_numbers:\n  - 5069-L320ER\n  - 5069-L320ERM'));
  const again = await importToDirectory(vault, first.bytes, undefined, 'Engineering/Components');
  assert.equal(again.updated, 0);
  assert.equal(again.created, 0);
  const next = await importToDirectory(vault, (await make('1.0.1')).bytes, undefined, 'Engineering/Components');
  assert.equal(next.updated, 2, 'only the note and family receipt should update');
  for (const part of ['5069-L3{xx', '5069-L3xx}', '5069-L3{}', '5069-L3{{xx}}', '5069-L3{../x}', '5069-L3{*}', '5069-L3{xx}.'])
    assert.throws(() => componentIdentity('AB', part, '1.0.0'), /portable/);
});

test('a newer version replaces packaged local edits and keeps files absent from the new inventory', async () => {
  const old = await versionedFixture('1.0.0');
  const next = await versionedFixture('1.1.0', files => {
    files[versionedNote] = strToU8('Updated component note');
    files[`${versionedRoot}/3d_rendered/new.txt`] = strToU8('new payload');
    delete files[`${versionedRoot}/manuals/manual.pdf`];
  });
  const vault = new MemoryVault();
  await importBook(vault, old.bytes);
  vault.content.set(versionedNote, strToU8('Locally edited note'));
  const model = `${versionedRoot}/3d_rendered/model.glb`;
  vault.content.set(model, strToU8('Locally edited model'));
  await vault.createBinary(`${versionedRoot}/manuals/personal.md`, strToU8('My additional reference').buffer);
  const imported = await importBook(vault, next.bytes);
  assert.equal(imported.created, 1);
  assert.equal(imported.updated, 3, 'note, locally edited model, and receipt are replaced');
  for (const [path, bytes] of Object.entries(next.files)) assert.deepEqual(vault.content.get(path), bytes);
  assert.equal(record(vault).engibookVersion, '1.1.0');
  assert.deepEqual(vault.content.get(`${versionedRoot}/manuals/manual.pdf`), old.files[`${versionedRoot}/manuals/manual.pdf`]);
  assert.equal(new TextDecoder().decode(vault.content.get(`${versionedRoot}/manuals/personal.md`)), 'My additional reference');
});

test('downgrades and same-version package changes are rejected before writes', async () => {
  const current = await versionedFixture('1.10.0');
  const vault = new MemoryVault();
  await importBook(vault, current.bytes);
  const before = vault.writes.length;
  for (const candidate of [await versionedFixture('1.9.0'), await versionedFixture('1.10.0', files => { files[versionedNote] = strToU8('Different published bytes'); })]) {
    await assert.rejects(importBook(vault, candidate.bytes), BookVersionError);
    assert.equal(vault.writes.length, before);
  }
  vault.content.set(versionedNote, strToU8('Local edit after installation'));
  await assert.rejects(importBook(vault, current.bytes), BookConflictError);
  assert.equal(vault.writes.length, before);
});

test('semantic versions order numeric components and prereleases rather than filenames', () => {
  const versions = ['1.0.0-alpha', '1.0.0-alpha.2', '1.0.0-alpha.10', '1.0.0-beta', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.2.0', '1.10.0', '2.0.0'];
  for (let i = 1; i < versions.length; i++) assert(compareBookVersions(versions[i - 1], versions[i]) < 0);
  assert.equal(compareBookVersions('1.0.0+build.1', '1.0.0+build.2'), 0);
  for (const version of ['1', 'v1.0.0', '01.0.0', '1.0.0-01', '1.0.0-alpha..1', '1.0.0+']) {
    assert.throws(() => componentIdentity('AB', '1606-XLE240E', version), /semantic version/);
  }
});

test('versioned identity fields must match the stable payload location', async () => {
  for (const mutate of [
    (_, manifest) => { delete manifest.providerCode; },
    (_, manifest) => { manifest.providerCode = 'ab'; },
    (_, manifest) => { manifest.partNumber = 'another-part'; },
    (_, manifest) => { manifest.engibookVersion = 'latest'; },
    (_, manifest) => { manifest.id += '_1.0.0'; },
  ]) {
    const book = await fixture(mutate, componentIdentity('AB', '1606-XLE240E', '1.0.0'));
    await assert.rejects(inspectBook(book.bytes));
  }
});

test('an interrupted upgrade retains its old installed version and resumes the new package', async () => {
  const old = await versionedFixture('1.0.0');
  const next = await versionedFixture('2.0.0', files => {
    files[versionedNote] = strToU8('Version 2 note');
    files[`${versionedRoot}/schematic/logic.excalidraw.md`] = strToU8('Version 2 drawing');
  });
  const vault = new MemoryVault();
  await importBook(vault, old.bytes);
  vault.beforeWrite = path => { if (path === versionedNote) throw new Error('Storage interrupted'); };
  await assert.rejects(importBook(vault, next.bytes), /Storage interrupted/);
  assert.equal(record(vault).engibookVersion, '1.0.0');
  assert.equal(record(vault, pendingPath).manifest.engibookVersion, '2.0.0');
  const before = vault.writes.length;
  await assert.rejects(importBook(vault, (await versionedFixture('1.5.0')).bytes), BookVersionError);
  assert.equal(vault.writes.length, before);
  vault.beforeWrite = () => {};
  await importBook(vault, next.bytes);
  assert.equal(record(vault).engibookVersion, '2.0.0');
  for (const [path, bytes] of Object.entries(next.files)) assert.deepEqual(vault.content.get(path), bytes);
  assert(!vault.getAbstractFileByPath(pendingPath));
});

test('cancellation after an upgrade write leaves a resumable import record', async () => {
  const old = await versionedFixture('1.0.0');
  const next = await versionedFixture('1.0.1', files => { files[versionedNote] = strToU8('Revised note'); });
  const vault = new MemoryVault();
  await importBook(vault, old.bytes);
  const controller = new AbortController();
  vault.beforeWrite = path => { if (path === versionedNote) controller.abort(); };
  await assert.rejects(importBook(vault, next.bytes, controller.signal), { name: 'AbortError' });
  assert.equal(record(vault).engibookVersion, '1.0.0');
  assert(vault.getFileByPath(pendingPath));
  vault.beforeWrite = () => {};
  await importBook(vault, next.bytes);
  assert.equal(record(vault).engibookVersion, '1.0.1');
  assert(!vault.getFileByPath(pendingPath));
});

test('a first versioned extraction can resume after interruption before any payload', async () => {
  const book = await versionedFixture('1.0.0');
  const vault = new MemoryVault();
  const controller = new AbortController();
  vault.beforeWrite = path => { if (path === pendingPath) controller.abort(); };
  await assert.rejects(importBook(vault, book.bytes, controller.signal), { name: 'AbortError' });
  assert(!vault.getFileByPath(receiptPath));
  assert(vault.getFileByPath(pendingPath));
  vault.beforeWrite = () => {};
  await importBook(vault, book.bytes);
  assert.equal(record(vault).engibookVersion, '1.0.0');
});

test('upgrades still reject bad hashes and file/folder or case conflicts before writing', async () => {
  const old = await versionedFixture('1.0.0');
  const next = await versionedFixture('1.0.1');
  const corrupted = unzipSync(next.bytes);
  corrupted[versionedNote][0] ^= 1;
  for (const conflict of ['checksum', 'folder', 'case']) {
    const vault = new MemoryVault();
    await importBook(vault, old.bytes);
    if (conflict === 'folder') {
      vault.nodes.delete(versionedNote);
      vault.content.delete(versionedNote);
      await vault.createFolder(versionedNote);
    } else if (conflict === 'case') {
      await vault.createBinary(`${versionedRoot}/manuals/MANUAL.pdf`, strToU8('Alias').buffer);
    }
    const before = vault.writes.length;
    await assert.rejects(importBook(vault, conflict === 'checksum' ? zipSync(corrupted) : next.bytes));
    assert.equal(vault.writes.length, before);
    assert.equal(record(vault).engibookVersion, '1.0.0');
  }
});

test('installation metadata changed during an upgrade stops subsequent writes', async () => {
  const old = await versionedFixture('1.0.0');
  const next = await versionedFixture('1.0.1', files => { files[versionedNote] = strToU8('Revised note'); });
  const vault = new MemoryVault();
  await importBook(vault, old.bytes);
  const newerReceipt = (await versionedFixture('2.0.0')).manifest;
  vault.beforeWrite = path => { if (path === versionedNote) vault.content.set(receiptPath, strToU8(JSON.stringify(newerReceipt))); };
  await assert.rejects(importBook(vault, next.bytes), /installation state changed/);
  assert.equal(record(vault).engibookVersion, '2.0.0', 'a concurrent newer receipt must not be overwritten');
});

test('a legacy package at the stable ID can be upgraded but cannot downgrade a versioned install', async () => {
  const next = await versionedFixture('1.0.0');
  const legacyFiles = unzipSync(next.bytes);
  const legacyManifest = { ...next.manifest, formatVersion: 1 };
  for (const name of ['providerCode', 'partNumber', 'engibookVersion']) delete legacyManifest[name];
  legacyFiles['engibook.json'] = strToU8(JSON.stringify(legacyManifest));
  const legacy = zipSync(legacyFiles);
  const vault = new MemoryVault();
  await importBook(vault, legacy);
  vault.content.set(versionedNote, strToU8('Local legacy edit'));
  await importBook(vault, next.bytes);
  assert.deepEqual(vault.content.get(versionedNote), next.files[versionedNote]);
  await assert.rejects(importBook(vault, legacy), BookVersionError);
});

test('default deployment creates EngiLib paths, rebases links, and records deployed checksums', async () => {
  const book = await versionedFixture('1.0.0');
  const vault = new MemoryVault();
  const imported = await importToDirectory(vault, book.bytes);
  assert.equal(imported.deploymentDirectory, 'EngiLib');
  assert.equal(imported.entry.path, `EngiLib/${versionedNote}`);
  assert(!vault.getAbstractFileByPath(versionedNote));
  const text = new TextDecoder().decode(vault.content.get(imported.entry.path));
  assert(text.includes(`model: EngiLib/${versionedRoot}/3d_rendered/model.glb`));
  assert(text.includes(`[[EngiLib/${versionedRoot}/manuals/manual.pdf#page=11]]`));
  const installed = record(vault, `EngiLib/${receiptPath}`);
  assert.equal(installed.deploymentDirectory, 'EngiLib');
  for (const file of installed.deployedFiles) assert.equal(await sha256(vault.content.get(file.path)), file.sha256);
  const before = vault.writes.length;
  const again = await importToDirectory(vault, book.bytes);
  assert.equal(again.updated, 0);
  assert.equal(vault.writes.length, before);
});

test('custom deployment folders isolate component versions and upgrades replace their rebased note', async () => {
  const old = await versionedFixture('1.0.0');
  const next = await versionedFixture('1.1.0', files => { files[versionedNote] = strToU8(`Updated\n[[${versionedRoot}/manuals/manual.pdf]]`); });
  const vault = new MemoryVault();
  await importToDirectory(vault, old.bytes, undefined, 'Engineering/Components');
  await importToDirectory(vault, next.bytes);
  assert.equal(record(vault, `Engineering/Components/${receiptPath}`).engibookVersion, '1.0.0');
  vault.content.set(`Engineering/Components/${versionedNote}`, strToU8('Local edit'));
  const result = await importToDirectory(vault, next.bytes, undefined, 'Engineering/Components');
  assert.equal(result.entry.path, `Engineering/Components/${versionedNote}`);
  assert.equal(new TextDecoder().decode(vault.content.get(result.entry.path)), `Updated\n[[Engineering/Components/${versionedRoot}/manuals/manual.pdf]]`);
  assert.equal(record(vault, `Engineering/Components/${receiptPath}`).engibookVersion, '1.1.0');
});

test('large compact manifests remain reimportable after adding full deployment paths to the receipt', async () => {
  const identity = componentIdentity('A', 'B', '1.0.0');
  const book = await fixture(async (files, manifest) => {
    for (let i = 0; i < 450; i++) files[`Assets/A_B/3d_rendered/${i}`] = Uint8Array.of(i % 256);
    manifest.files = await Promise.all(Object.entries(files).map(async ([path, data]) => ({ path, bytes: data.length, sha256: await sha256(data) })));
  }, identity);
  const directory = 'L'.repeat(120);
  const vault = new MemoryVault();
  await importToDirectory(vault, book.bytes, undefined, directory);
  assert(vault.content.get(`${directory}/Assets/A_B/engibook.json`).length > 192 * 1024);
  const before = vault.writes.length;
  const again = await importToDirectory(vault, book.bytes, undefined, directory);
  assert.equal(again.updated, 0);
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

test('checks destination siblings without traversing unrelated folders', async () => {
  const { bytes } = await fixture();
  const vault = new MemoryVault();
  for (const path of ['Personal', 'Personal/Private', 'Assets', 'Assets/Other-Component']) await vault.createFolder(path);
  await vault.createBinary('Personal/Private/diary.md', strToU8('unrelated content').buffer);
  await vault.createBinary('Assets/Other-Component/model.glb', strToU8('unrelated model').buffer);
  for (const path of ['Personal', 'Personal/Private', 'Assets/Other-Component']) {
    Object.defineProperty(vault.nodes.get(path), 'children', { get() { throw new Error(`Traversed unrelated folder: ${path}`); } });
  }
  await importBook(vault, bytes);
  vault.listedFolders = [];
  const again = await importBook(vault, bytes);
  assert.equal(again.created, 0);
  assert.deepEqual(new Set(vault.listedFolders), new Set(['', 'Assets', root, ...ASSET_DIRECTORIES.map(dir => `${root}/${dir}`)]));
  assert.equal(new TextDecoder().decode(vault.content.get('Personal/Private/diary.md')), 'unrelated content');
});

test('rejects case aliases at ancestors and alongside an exact destination', async () => {
  const { bytes } = await fixture();
  for (const parts of [['assets'], ['Assets', 'Assets/example-psu'], ['Assets', root, `${root}/MANUALS`]]) {
    const vault = new MemoryVault();
    for (const path of parts) await vault.createFolder(path);
    const before = vault.writes.length;
    await assert.rejects(importBook(vault, bytes), BookConflictError);
    assert.equal(vault.writes.length, before);
  }
  for (const aliasFirst of [true, false]) {
    const vault = new MemoryVault();
    await importBook(vault, bytes);
    const exactPath = `${root}/manuals/manual.pdf`;
    const exact = vault.nodes.get(exactPath);
    await vault.createBinary(`${root}/manuals/MANUAL.pdf`, strToU8('local duplicate').buffer);
    if (aliasFirst) {
      vault.nodes.delete(exactPath);
      vault.nodes.set(exactPath, exact);
    }
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

test('the versioned demonstration deploys to the default component library', async () => {
  const bytes = new Uint8Array(await readFile(new URL('../examples/GPP_Demo-Component_1.0.0.engibook', import.meta.url)));
  const vault = new MemoryVault();
  const result = await importToDirectory(vault, bytes);
  assert.equal(result.entry.path, 'EngiLib/GPP_Demo-Component.md');
  assert.equal(result.manifest.engibookVersion, '1.0.0');
  const receipt = record(vault, 'EngiLib/Assets/GPP_Demo-Component/engibook.json');
  for (const file of receipt.deployedFiles) assert.equal(await sha256(vault.content.get(file.path)), file.sha256);
  const note = new TextDecoder().decode(vault.content.get(result.entry.path));
  assert(note.includes('model: EngiLib/Assets/GPP_Demo-Component/3d_rendered/model.glb'));
});
