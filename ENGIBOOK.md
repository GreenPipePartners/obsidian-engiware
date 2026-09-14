# Engibook resource format — v1

An **`.engibook` is a ZIP archive** containing one component note, its asset files,
and an `engibook.json` inventory. Engiware registers the file extension in
Obsidian and provides **Extract and open**. The command **Engiware: Import .engibook**
also accepts an external `.engibook` or compatible `.zip` through the file picker.

## Obsidian integration

The package is the transport format. Engiware extracts its contents through
Obsidian's public Vault API. The result is a normal Markdown note, PDF documents,
editable Excalidraw drawings, images, and a self-contained GLB. Obsidian can index,
link, sync, and edit those files normally.

A ZIP member is not an Obsidian `TFile`. Keeping everything inside the archive
would require a separate virtual-file layer for native PDF, Excalidraw, backlinks,
and editing. Extraction gives each asset a real vault path and preserves the
image-first, on-demand viewer.

## Extracted layout

```text
<vault>/
├── Demo-Component.md
└── Assets/
    └── Demo-Component/
        ├── engibook.json
        ├── asset-provenance.json
        ├── schematic/
        │   └── contact.svg
        ├── manuals/
        │   └── guide.md
        ├── 2d_scaled_component/
        │   └── front.svg
        └── 3d_rendered/
            ├── model.glb
            └── preview.svg
```

The archive itself may be stored anywhere. Once imported, the note and extracted
assets work independently of the archive. A component can contain PDFs, raster
images, SVGs, and native `.excalidraw.md` drawings. Excalidraw is used to edit
the latter; the included demo uses SVGs.

## Manifest and ZIP layout

The ZIP contains `engibook.json` **at its root**. Other members have their final,
vault-relative paths, such as `Demo-Component.md` and
`Assets/Demo-Component/manuals/guide.md`.

The root manifest has these fields:

| Field | v1 meaning |
|---|---|
| `format` | `"engibook"` |
| `formatVersion` | `1` |
| `id` | Portable component ID, e.g. `Demo-Component` |
| `title` | Human-readable component title |
| `entrypoint` | `<id>.md` at the vault root |
| `assetRoot` | `Assets/<id>` |
| `files` | Complete payload inventory: `{path, bytes, sha256}` for each file |

The manifest is excluded from its own inventory. On import, it is stored as
`Assets/<id>/engibook.json`, so multiple components have separate inventories.
Payload assets live in the four standard directories; `asset-provenance.json`
can also live directly under the asset root. All four directories are created,
including any that are empty. The component note uses explicit vault-relative
asset links, preserving PDF page anchors and image sizes.

## Import behavior

- File sizes and SHA-256 hashes are checked before extraction.
- Identical existing files are reused; importing the same package is idempotent.
- Conflicting existing files are reported before any initial writes. Local edits
  are never silently replaced. Use **Open component** to open an existing note.
- Assets are written before the entry note. An interrupted extraction can be
  repeated to complete the missing files.
- Closing the package view or unloading Engiware cancels its pending import work.
- Browsing or importing a package does not initialize the 3D renderer.

v1 accepts stored/DEFLATE ZIP members, up to 128 MiB of archive data, 256 MiB
expanded data, and 512 ZIP entries. Absolute/traversal paths, undeclared files,
case-colliding paths, and unsupported format versions are rejected. Compression
support is bundled with the plugin; import works offline through browser APIs.

The archive is a snapshot. Editing an extracted drawing or note does not rewrite
the `.engibook`; create a fresh package to distribute those changes.

## Create or refresh a package

From this project directory:

```bash
python scripts/package_engibook.py \
  --vault /path/to/your/vault \
  --component Demo-Component \
  --title 'Demo component'
```

This writes `releases/Demo-Component.engibook` and refreshes the component's local
inventory. It preserves the note and asset bytes, checks referenced assets,
and uses stable ZIP metadata for reproducible packages. Use `--output` to select
another destination. Python's standard library is the only build requirement.

Download: **[Demo-Component.engibook](examples/Demo-Component.engibook)**.
