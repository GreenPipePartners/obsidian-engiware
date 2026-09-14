import { readFile, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const files = Object.fromEntries(await Promise.all(['main.js', 'manifest.json', 'styles.css'].map(async name =>
  [`engiware/${name}`, new Uint8Array(await readFile(`dist/${name}`))])));
const path = `dist/engiware-${manifest.version}.zip`;
await writeFile(path, zipSync(files, { level: 9, mtime: new Date(2020, 0, 1) }));
console.log(path);
