import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
const [manifest, pkg, versions, built] = await Promise.all([
  json('manifest.json'), json('package.json'), json('versions.json'), json('dist/manifest.json'),
]);
assert.equal(manifest.id, 'engiware');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.version, pkg.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.deepEqual(built, manifest);
assert.equal(manifest.isDesktopOnly, false);
assert(manifest.description.length <= 250 && manifest.description.endsWith('.'));
if (process.argv[2]) assert.equal(process.argv[2], manifest.version, 'Tag must match manifest.version, without a v prefix');
const bundle = await readFile('dist/main.js', 'utf8');
const imports = [...bundle.matchAll(/require\(["']([^"']+)["']\)/g)].map(match => match[1]);
assert.deepEqual([...new Set(imports)], ['obsidian']);
assert(bundle.includes('Bundled dependency licenses:'));
assert((await readFile('dist/styles.css', 'utf8')).includes('.engiware-preview'));
assert((await readFile('LICENSE', 'utf8')).includes('MIT License'));
console.log(`Release ${manifest.version}: metadata, compatibility, assets and browser-only bundle verified.`);
