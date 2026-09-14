# Contributing

Use Node.js 22.18 or later. CI uses Node.js 24.

```sh
npm ci
npm run verify
```

`verify` runs the Obsidian ESLint checks, TypeScript, package-import tests, the
production build, and release metadata validation. Tests and example assets are
self-contained in this repository.

The plugin supports Obsidian 1.8.7 and newer. The development types include the
1.13 declarative settings schema; the ESLint peer override aligns its Obsidian
types with the project's version. Settings use a shared definition for modern
search indexing and the legacy `display()` renderer. Keep runtime code browser-compatible
and preserve the image-first behavior: no WebGL context or renderer model load
before the user expands an image. Validate imports before writing and preserve
existing user edits. Inspect package destination parents for conflicts, rather
than enumerating the whole vault.

To regenerate the original demonstration package, run `npm run demo`. To package
another component, see [ENGIBOOK.md](ENGIBOOK.md).

## Releases

1. Update `manifest.json`, `package.json`, `package-lock.json`, `versions.json`,
   and `RELEASE_NOTES.md` together.
2. Run `npm run verify` and verify the changed behavior in Obsidian.
3. Commit, then push an annotated tag matching the manifest version exactly,
   for example `0.3.1` **without** a `v` prefix.

The release workflow builds and attests the plugin, then publishes the individual
`main.js`, `manifest.json`, and `styles.css` assets that Obsidian and BRAT install.
Demonstration downloads come from `examples/` in the repository. To generate a
local manual-install ZIP, run `npm run package:release` after building; the ZIP
is not an additional GitHub release attachment.
