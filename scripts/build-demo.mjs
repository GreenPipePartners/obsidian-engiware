import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BoxGeometry } from 'three';
import { zipSync, strToU8 } from 'fflate';
import { bookFilename, componentIdentity } from '../src/engibook.ts';

// Original, MIT-licensed demonstration data. No external CAD or documents needed.
const identity = componentIdentity('GPP', 'Demo-Component', '1.0.0');
const id = identity.id, root = `Assets/${id}`;
const geometry = new BoxGeometry(0.04, 0.08, 0.03).translate(0, 0.04, 0);
geometry.computeBoundingBox();
const arrays = [geometry.attributes.position.array, geometry.attributes.normal.array, geometry.index.array];
const buffers = arrays.map(array => Buffer.from(array.buffer, array.byteOffset, array.byteLength));
const binary = Buffer.concat(buffers);
const gltf = {
  asset: { version: '2.0', generator: 'Engiware demo generator' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'Demo component', mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
  materials: [{ name: 'Slate', pbrMetallicRoughness: { baseColorFactor: [0.16, 0.27, 0.34, 1], metallicFactor: 0.1, roughnessFactor: 0.6 } }],
  buffers: [{ byteLength: binary.length }],
  bufferViews: buffers.map((buffer, index) => ({ buffer: 0, byteOffset: buffers.slice(0, index).reduce((sum, item) => sum + item.length, 0), byteLength: buffer.length })),
  accessors: [
    { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() },
    { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
  ],
  extras: { units: 'metres', dimensions_mm: [40, 80, 30], up: '+Y', front: '+Z' },
};
const json = Buffer.from(JSON.stringify(gltf));
const paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const header = Buffer.alloc(20);
header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + paddedJson.length + binary.length, 8);
header.writeUInt32LE(paddedJson.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binary.length); binHeader.writeUInt32LE(0x004e4942, 4);
const model = Buffer.concat([header, paddedJson, binHeader, binary]);
geometry.dispose();

const image = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
<rect width="800" height="800" fill="#e4e9ed"/><ellipse cx="415" cy="657" rx="160" ry="25" fill="#ced7dd"/>
<path d="M290 185 490 220 490 635 290 600Z" fill="#294552"/><path d="M490 220 575 165 575 580 490 635Z" fill="#183543"/>
<path d="M290 185 375 130 575 165 490 220Z" fill="#577481"/><text x="400" y="733" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#233743">Demo component · 40 × 80 × 30 mm</text></svg>`;
const panel = `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="110mm" viewBox="0 0 240 440">
<rect width="240" height="440" fill="#fff"/><rect x="40" y="60" width="160" height="320" fill="#294552"/>
<g font-family="sans-serif" font-size="13" fill="#233743" text-anchor="middle"><text x="120" y="30">40 × 80 mm front</text><text x="120" y="414">4 drawing units = 1 mm</text></g></svg>`;
const contact = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200">
<rect width="600" height="200" fill="#fff"/><g fill="none" stroke="#233743" stroke-width="3"><path d="M60 110H240M360 110H540M240 110 340 65"/><circle cx="240" cy="110" r="6"/><circle cx="360" cy="110" r="6"/></g>
<text x="300" y="170" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#233743">Illustrative dry contact</text></svg>`;
const note = `---
type: component
provider_code: ${identity.providerCode}
part_number: ${identity.partNumber}
engibook_version: ${identity.engibookVersion}
catalog_number: Demo-Component
tags: [engineering/components, engiware-demo]
---

# Demo component

An original example package for Engiware. Dimensions: **40 × 80 × 30 mm**.

## Component preview

\`\`\`engiware
model: ${root}/3d_rendered/model.glb
image: ${root}/3d_rendered/preview.svg
title: Demo component
height: 420
\`\`\`

## Scaled front view

![[${root}/2d_scaled_component/front.svg]]

## Schematic

![[${root}/schematic/contact.svg]]

## Reference

[[${root}/manuals/guide.md|Read the demonstration guide]]
`;
const files = {
  [`${id}.md`]: strToU8(note),
  [`${root}/3d_rendered/model.glb`]: new Uint8Array(model),
  [`${root}/3d_rendered/preview.svg`]: strToU8(image),
  [`${root}/2d_scaled_component/front.svg`]: strToU8(panel),
  [`${root}/schematic/contact.svg`]: strToU8(contact),
  [`${root}/manuals/guide.md`]: strToU8('# Demonstration guide\n\nExpand the image to orbit the box-shaped component. Image or Escape releases 3D. The GLB uses metres, +Y up and +Z front. The SVG front view uses 4 drawing units per millimetre.\n\nThe example geometry, drawings and text are original and provided under the repository MIT license.\n'),
  [`${root}/asset-provenance.json`]: strToU8(JSON.stringify({ source: 'Original Engiware demonstration', license: 'MIT', dimensions_mm: [40, 80, 30], drawing_units_per_mm: 4 }, null, 2) + '\n'),
};
const manifest = {
  format: 'engibook', formatVersion: 2, ...identity, title: 'Demo component', entrypoint: `${id}.md`, assetRoot: root,
  files: Object.entries(files).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })),
};
await mkdir('examples', { recursive: true });
await writeFile('examples/preview.svg', image);
const output = `examples/${bookFilename(manifest)}`;
const bytes = zipSync({ 'engibook.json': strToU8(JSON.stringify(manifest, null, 2) + '\n'), ...files }, { level: 6, mtime: new Date(2020, 0, 1) });
const previous = await readFile(output).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
if (previous && !previous.equals(bytes)) throw new Error('Demo contents changed. Increment the Engibook content version before regenerating.');
await writeFile(output, bytes);
console.log(`Generated ${output} and examples/preview.svg`);
