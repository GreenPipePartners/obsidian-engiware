# Engispark pilot format and native runtime

The implementation is now maintained in
<https://github.com/GreenPipePartners/engispark>, with a standalone player at
<https://greenpipepartners.github.io/engispark/>. Engiware 0.6.2 bundles the
0.2.0 runtime from its GitHub Release. Local `src/perspective-*` modules are
compatibility exports; the loader, evaluator, renderer and shared native-view
CSS come from the independent package.

An `.engispark` is a ZIP wrapper around **native Ignition resources** and local
sample setup. There is one source of truth for the UI: the Perspective `view.json`
inside its nested project ZIP. Engiware loads that document directly; it does not
maintain a parallel layout or red/green rule in package metadata.

## Package layout

```text
engispark.json
README.md
ignition/AB_1606-XLE240E-DC-OK_0.2.0.ignition.zip
ignition/DC_OK.tags.json
artwork/1606-XLE240E-panel.svg
artwork/provenance.json
```

The nested project ZIP has `project.json` at its root and the resource pair
`com.inductiveautomation.perspective/views/Engispark/AB_1606-XLE240E/DC_OK/{view,resource}.json`.
Gateway tags are a separate native Tag Browser JSON import.

The manifest declares `format: "engispark"`, `formatVersion: 1`, `id`, semantic
`version`, `title`, `runtimeProfile: "perspective-basic@0.2.0"`, `ignition` paths
(`project`, `tags`, `viewPath`, `minimumVersion`), and `simulation.tags`.
Every payload file has a `files` inventory entry with `path`, `bytes`, and
SHA-256. The manifest does not inventory itself. Samples are provider-qualified
Boolean tags: `{ "path": "[default]Engispark/PS1_DC_OK", "dataType": "Boolean", "value": true }`.

Archives are bounded to 16 MiB compressed, 32 MiB expanded, 128 entries and
16 MiB per member. JSON documents are at most 1 MiB. Portable paths, duplicate
names, inventory completeness and payload checksums are validated before use.

## Native profile: perspective-basic@0.2.0

- Components: `ia.container.flex`, `ia.display.label`, `ia.input.checkbox`, `ia.shapes.svg`.
- SVG Drawing uses the native `elements` tree, nested groups, transforms, paints,
  text and inline styles. The pilot supports paths, basic shapes, text/tspan,
  defs and masks, bounded to 2048 elements and depth 24. Referenced resources,
  scripts and unrecognized attributes are rejected. Version 0.1.0 packages
  continue to work with the expanded interpreter.
- Flex direction, wrapping, alignment, child basis/grow/shrink; inline style
  properties defined in `STYLE_PROPERTIES` in the shared runtime.
- Tag bindings: direct and indirect via `view.*` references, with Boolean values.
- Property bindings: view params/custom/props paths and bracketed array indices, including bidirectional
  chains leading to writable tags.
- Map transforms: scalar input, scalar or color output, exact input matches and
  the native fallback. No package-specific mapping is added by the renderer.
- Unknown tags yield null / `Bad_DoesNotExist`; map fallbacks display unavailable
  status. Unknown tag writes fail. Samples do not create undeclared tags.
- Each active card has an independent local tag store. Reset restores initial
  tag values; reopening constructs a fresh runtime. There are no polling loops.

Components, properties, styles, scripts and binding types outside this profile
are rejected. Expression, query, expression-structure and script transforms,
style-class resources, other containers/components, Perspective sessions,
Gateway security, quality overlays and asynchronous binding timing are not
implemented. This is a native-resource interpreter for a bounded first sample,
not a complete Perspective or Ignition Gateway implementation.

## Runtime direction

The standalone player and Obsidian use the same shared runtime. The intended
broader architecture is a Node.js Gateway-like host, Python 3 for scripts, and
the shared Fluxy service contract. This script-free utility runs in the browser
or Obsidian renderer. Its injectable tag service exposes `readBlocking`
and `writeBlocking` with values carrying `tagPath`, `value`, `quality` and
`timestamp`, leaving a defined boundary for a later Fluxy-backed host.

There is currently no Gateway-like Node service, Fluxy HTTP connection or Python
script execution. The standalone repository includes a static Node server.
Compatibility must grow by interpreting additional native resources,
rather than translating each view into a separate Engispark UI definition.

## Original SVG artwork

The pilot imports the existing `1606-XLE240E-panel.svg` at authoring time using
the native `ia.shapes.svg` schema documented by Inductive Automation at
<https://forum.inductiveautomation.com/t/107192/2>. The source export's 510 paths,
306 transforms and 32 labels are retained. Empty, unreferenced Excalidraw mask
and font containers are omitted. The native viewBox selects the operator face
from the full sheet without redrawing or relocating geometry.

The original green lamp, Excalidraw element `861f0e79` /
`panel-dc-ok-indicator`, becomes the two native SVG path elements named
`dc-ok-lamp-fill` and `dc-ok-lamp-outline`. Their fill/stroke paint properties
have native map transforms reading `view.custom.dcOk`. The single indirect tag
binding and the checkbox write-through remain native Perspective bindings.
The runtime has no knowledge of those lamp names, paths, colors or component ID.
The original SVG is also packaged byte-for-byte with provenance and its hash.

## Extraction and rebuild

**Extract Ignition files** writes the original project ZIP, tags and README to
`<deployment directory>/Exports/<id>_<version>/`. Identical existing files are
reused; different files cause a conflict. Open the project ZIP with Designer's
File → Import, then import tag JSON at the Tag Browser's `[default]` provider root.
The view's `tagPath` input selects another Boolean reference when desired.

```sh
python3 scripts/import_dc_ok_svg.py
python3 scripts/package_engispark.py
TMPDIR=/tmp/opencode npm run verify
```

Source resources are under `examples/1606-xle240e-dc-ok/`. The Python packager
copies `view.json` bytes unchanged, uses deterministic ZIP metadata, and refuses
to replace an existing version with different bytes. Place the resulting
`.engispark` under an Engibook's `schematic/` assets and embed a `package:` block.
Normal Engibook deployment rebases the block's vault path while preserving the
binary package and native resources byte-for-byte.
