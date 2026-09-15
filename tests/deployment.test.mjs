import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeploymentDirectory, rebaseComponentText } from '../src/deployment.ts';
import { settings } from '../src/config.ts';

test('deployment settings default to EngiLib and retain an explicitly chosen directory', () => {
  assert.equal(settings({}).deploymentDirectory, 'EngiLib');
  assert.equal(settings({ deploymentDirectory: 'engilib' }).deploymentDirectory, 'engilib');
  assert.equal(settings({ deploymentDirectory: '' }).deploymentDirectory, '');
  assert.equal(settings({ deploymentDirectory: 'Engineering\\Components\\' }).deploymentDirectory, 'Engineering/Components');
  assert.equal(settings({ deploymentDirectory: '../outside' }).deploymentDirectory, 'EngiLib');
});

test('deployment folders reject absolute paths, traversal, hidden configuration, and nonportable names', () => {
  for (const path of ['/', '\\', '/library', 'C:\\library', '../outside', 'library/../outside', '.obsidian', 'library/.obsidian', 'library//components', 'library/name.', 'library/part?name', 'library/\u0001']) {
    assert.throws(() => normalizeDeploymentDirectory(path), undefined, path);
  }
  assert.equal(normalizeDeploymentDirectory('  Engineering/Components/  '), 'Engineering/Components');
});

test('asset references follow the deployment directory while relative and external URLs retain their meaning', () => {
  const root = 'Assets/AB_1606-XLE240E';
  const note = 'AB_1606-XLE240E.md';
  const source = `![[${root}/manuals/manual.pdf#page=11|600]]\nmodel: ${root}/3d_rendered/model.glb\nimage: ${root}/3d_rendered/image.png\n[Manual](${root}/manuals/manual.pdf#page=11)\n[[${note}#Specifications|Component]]\n[Component](${note})\n[[./${root}/manuals/manual.pdf]]\nhttps://example.com/${root}/manuals/manual.pdf\nOther/${root}/manuals/manual.pdf`;
  const bytes = new TextEncoder().encode(source);
  const output = new TextDecoder().decode(rebaseComponentText(bytes, note, root, note, 'Engineering Parts'));
  assert(output.includes(`![[Engineering Parts/${root}/manuals/manual.pdf#page=11|600]]`));
  assert(output.includes(`model: Engineering Parts/${root}/3d_rendered/model.glb`));
  assert(output.includes(`[Manual](Engineering%20Parts/${root}/manuals/manual.pdf#page=11)`));
  assert(output.includes(`[[Engineering Parts/${note}#Specifications|Component]]`));
  assert(output.includes(`[Component](Engineering%20Parts/${note})`));
  assert(output.includes(`[[./${root}/manuals/manual.pdf]]`));
  assert(output.includes(`https://example.com/${root}/manuals/manual.pdf`));
  assert(output.includes(`Other/${root}/manuals/manual.pdf`));
  assert.equal(rebaseComponentText(bytes, note, root, note, ''), bytes);
  assert.equal(rebaseComponentText(bytes, 'model.glb', root, note, 'EngiLib'), bytes);
});
