## Engiware 0.3.2

Adds a user-confirmed graphics retry for virtual machines and slower devices.

- Expanding an image still starts 3D automatically when the normal graphics
  attempt succeeds.
- If that attempt fails, keep the image visible and show **Try 3D anyway?**
  instead of rejecting interactive 3D outright. **Keep Image** cancels;
  **Try 3D anyway** retries WebGL 2 without rejecting major performance caveats.
- The confirmed retry uses reduced quality: a 640 px render cap, up to 10 fps,
  no antialiasing, and a smaller environment map. Software rendering is allowed
  when the browser provides it.
- No model is loaded while waiting for confirmation. Image, Esc, closing, or
  plugin unload cancels pending work and releases graphics resources.
- Slow draws reduce quality and display a warning instead of automatically
  disabling 3D. A genuine graphics error still leaves the image available.

Requires Obsidian **1.8.7 or later**. Update through Community plugins or BRAT.
For manual installation, download the three release files into your vault's
`.obsidian/plugins/engiware/` directory, reload Obsidian, and enable Engiware.

The original MIT-licensed [Demo-Component.engibook](https://raw.githubusercontent.com/GreenPipePartners/obsidian-engiware/0.3.2/examples/Demo-Component.engibook)
is available from the repository. Import it through **Engiware: Import .engibook**.
