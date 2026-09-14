import { build } from 'esbuild';
import { copyFile, mkdir, readFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const licenses = await Promise.all(['three', 'fflate'].map(async name =>
  `${name}:\n${await readFile(`node_modules/${name}/LICENSE`, 'utf8')}`));
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['obsidian'],
  minify: false,
  legalComments: 'inline',
  banner: { js: `/* Engiware ${manifest.version}\nBundled dependency licenses:\n${licenses.join('\n')}\n*/` },
});
await Promise.all(['manifest.json', 'styles.css'].map(file => copyFile(file, 'dist/' + file)));
console.log('Built dist/main.js, dist/manifest.json and dist/styles.css');
