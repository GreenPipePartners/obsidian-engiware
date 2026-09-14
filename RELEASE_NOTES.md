## Engiware 0.3.0

First public release of Engiware for Obsidian.

- Import `.engibook` component packages into a native Markdown note and organized
  `schematic`, `manuals`, `2d_scaled_component`, and `3d_rendered` asset directories.
- Open Engibook files directly in Obsidian to inspect and extract their contents.
- Show lightweight image previews in Reading view and Live Preview. Expand an
  image to load optional, demand-rendered 3D, with image fallback and image-only mode.
- Check package inventories and hashes, preserve local edits, and resume interrupted
  imports without overwriting completed files.
- Include an original, MIT-licensed demonstration package and a Python packaging tool.

Requires Obsidian **1.8.7 or later**. Runtime verification has been performed on
Obsidian 1.13.7 for Linux. Optional 3D uses WebGL 2; image previews work without it.

For manual installation, extract `engiware-0.3.0.zip` into your vault's
`.obsidian/plugins/` directory and enable **Engiware**. BRAT users can add
`https://github.com/GreenPipePartners/obsidian-engiware`.

Import `Demo-Component.engibook` through **Engiware: Import .engibook** to try it.
