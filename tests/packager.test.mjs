import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { inspectBook } from '../src/engibook.ts';

const script = fileURLToPath(new URL('../scripts/package_engibook.py', import.meta.url));
const python = process.env.PYTHON ?? 'python3';
const id = 'AB_1606-XLE240E';

async function sourceLibrary(directory, source = id) {
  const temp = await mkdtemp(join(tmpdir(), 'engiware-package-'));
  const root = join(temp, directory, 'Assets', source);
  for (const child of ['schematic', 'manuals', '2d_scaled_component', '3d_rendered']) await mkdir(join(root, child), { recursive: true });
  const prefix = [directory, 'Assets', source].filter(Boolean).join('/');
  const note = `---\ntype: component\n---\n\n# Power supply\n\n[[${prefix}/manuals/guide.md]]\n\n\x60\x60\x60engiware\nmodel: ${prefix}/3d_rendered/model.glb\nimage: ${prefix}/3d_rendered/preview.svg\n\x60\x60\x60\n`;
  const notePath = join(temp, directory, `${source}.md`);
  await writeFile(notePath, note);
  await writeFile(join(root, 'manuals/guide.md'), 'Local guide');
  await writeFile(join(root, '3d_rendered/model.glb'), Uint8Array.of(103, 108, 84, 70, 0, 255));
  await writeFile(join(root, '3d_rendered/preview.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(root, 'engibook.json'), '{"installed":"receipt must stay unchanged"}');
  return { temp, root, note, notePath };
}

function build(f, directory = 'EngiLib', source = id, version = '1.0.0', name = `${id}_${version}.engibook`) {
  const output = join(f.temp, 'packages', name);
  const result = spawnSync(python, [script, '--vault', f.temp, '--provider-code', 'AB', '--part-number', '1606-XLE240E', '--engibook-version', version,
    '--deployment-directory', directory, '--source-component', source, '--output', output], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return { ...result, output };
}

test('Python packaging removes the deployment prefix and builds a reproducible portable v2 archive', async () => {
  const f = await sourceLibrary('EngiLib');
  try {
    const first = build(f);
    assert.equal(first.status, 0, first.stderr);
    const bytes = await readFile(first.output);
    const { manifest } = await inspectBook(bytes);
    assert.equal(manifest.id, id);
    assert.equal(manifest.engibookVersion, '1.0.0');
    assert.equal(manifest.formatVersion, 2);
    const payload = unzipSync(bytes);
    const note = new TextDecoder().decode(payload[`${id}.md`]);
    assert(note.includes(`[[Assets/${id}/manuals/guide.md]]`));
    assert(note.includes('provider_code: "AB"'));
    assert(note.includes('engibook_version: "1.0.0"'));
    assert(!note.includes('EngiLib/'));
    assert.deepEqual(payload[`Assets/${id}/3d_rendered/model.glb`], Uint8Array.of(103, 108, 84, 70, 0, 255));
    assert.equal(await readFile(f.notePath, 'utf8'), f.note, 'packaging must not change the source note');
    assert.equal(await readFile(join(f.root, 'engibook.json'), 'utf8'), '{"installed":"receipt must stay unchanged"}');
    const again = build(f);
    assert.equal(again.status, 0, again.stderr);
    assert.deepEqual(await readFile(again.output), bytes);
  } finally { await rm(f.temp, { recursive: true, force: true }); }
});

test('a legacy source is repackaged under the provider_part identity with all asset links adjusted', async () => {
  const f = await sourceLibrary('', '1606-XLE240E');
  try {
    const result = build(f, '', '1606-XLE240E');
    assert.equal(result.status, 0, result.stderr);
    const payload = unzipSync(await readFile(result.output));
    const text = new TextDecoder().decode(payload[`${id}.md`]);
    assert(text.includes(`model: Assets/${id}/3d_rendered/model.glb`));
    assert(text.includes(`[[Assets/${id}/manuals/guide.md]]`));
    assert.equal(await readFile(f.notePath, 'utf8'), f.note);
  } finally { await rm(f.temp, { recursive: true, force: true }); }
});

test('packaging enforces versioned filenames and refuses different bytes under an existing version', async () => {
  const f = await sourceLibrary('EngiLib');
  try {
    assert.notEqual(build(f, 'EngiLib', id, '1.0.0', 'wrong.engibook').status, 0);
    const first = build(f);
    assert.equal(first.status, 0, first.stderr);
    const original = await readFile(first.output);
    await writeFile(f.notePath, f.note + '\nAn edit requiring a new content version.\n');
    const reusedVersion = build(f);
    assert.notEqual(reusedVersion.status, 0);
    assert(reusedVersion.stderr.includes('Use a newer content version'));
    assert.deepEqual(await readFile(first.output), original);
    const next = build(f, 'EngiLib', id, '1.0.1');
    assert.equal(next.status, 0, next.stderr);
    assert.equal((await inspectBook(await readFile(next.output))).manifest.engibookVersion, '1.0.1');
  } finally { await rm(f.temp, { recursive: true, force: true }); }
});
