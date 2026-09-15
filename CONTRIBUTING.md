# Contributing

Use Node.js 22.18 or later and Python 3.10 or later. CI uses Node.js 24 and Python
3.12. Set `PYTHON` if the Python executable is not named `python3`.

```sh
npm ci
npm run verify
```

`verify` runs the Obsidian ESLint checks, TypeScript, import/upgrade/deployment,
Python packaging and graphics confirmation tests, the production build, and
release metadata validation. Tests and example assets are self-contained.

The plugin supports Obsidian 1.8.7 and newer. The development types include the
1.13 declarative settings schema; the ESLint peer override aligns its Obsidian
types with the project's version. Settings use a shared definition for modern
search indexing and the legacy `display()` renderer. Keep runtime code browser-compatible
and preserve the image-first behavior: no WebGL context or renderer model load
before the user expands an image. Successful normal graphics should load 3D on
expansion. After that check fails, keep the image visible and wait for explicit
confirmation before the reduced-quality retry or any model read. Closing or
choosing Image must cancel a pending confirmation as well as a model load.
Validate imports before writing. Versioned packages replace their listed files,
including local edits, only when upgrading to a newer content version or resuming
an authorized interrupted deployment. Commit the installed receipt after the
assets and note; use the pending record to prevent downgrades during an upgrade.
Use `FileManager.trashFile()` to remove that temporary record. Inspect only
destination parents for file/folder and case conflicts. Keep deployment paths
scoped to the selected vault-relative library, and rebase internal text links.

To regenerate the versioned demonstration, run `npm run demo`. Increment its
content version before changing the payload; existing versions are immutable.
The v1 demo remains as a compatibility fixture. To package another component,
see [ENGIBOOK.md](ENGIBOOK.md). Source imports use `.ts` where needed by Node's
native TypeScript test runner; the production build bundles them with esbuild.

## Releases

1. Update `manifest.json`, `package.json`, `package-lock.json`, `versions.json`,
   and `RELEASE_NOTES.md` together.
2. Run `npm run verify` and verify the changed behavior in Obsidian.
3. Commit, then push an annotated tag matching the manifest version exactly,
   for example `0.4.0` **without** a `v` prefix.

The release workflow builds and attests the plugin, then publishes the individual
`main.js`, `manifest.json`, and `styles.css` assets that Obsidian and BRAT install.
Demonstration downloads come from `examples/` in the repository. To generate a
local manual-install ZIP, run `npm run package:release` after building; the ZIP
is not an additional GitHub release attachment.
