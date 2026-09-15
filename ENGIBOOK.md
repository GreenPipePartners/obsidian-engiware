# Engibook resource format — v2

An **`.engibook` is a ZIP archive** containing one component note, its asset files,
and an `engibook.json` inventory. Engiware registers the file extension in
Obsidian and provides **Deploy and open**. The command **Engiware: Import .engibook**
also accepts an external `.engibook` or compatible `.zip` through the file picker.

Format v2 requires **Engiware 0.4.0 or later**. Legacy v1 packages are still readable.

## Identity, filenames, and versions

```text
{provider_code}_{part_number}_{engibook_version}.engibook
AB_1606-XLE240E_1.0.0.engibook
```

- **Provider code:** manufacturer identifier, such as `AB` for Allen-Bradley;
  1–16 uppercase ASCII letters or digits.
- **Part number:** preserve its actual hyphens, such as `1606-XLE240E`. Portable
  ASCII letters, digits, dots, hyphens, and underscores are supported, with an
  alphanumeric first character and no trailing dot.
- **Engibook version:** a semantic content version such as `1.0.0` or `1.2.0`.
  This is independent of the plugin version, schema version, and manufacturer
  hardware revision. Prereleases are supported; build metadata does not increase
  version precedence.

The stable component ID is **`{provider_code}_{part_number}`**, up to 80 characters.
The content version appears in the archive filename, not in deployed note or
asset-folder names. Identity is read from the manifest, so importing never relies
on splitting a filename or guessing which hyphens belong to the part number.

## Obsidian integration

The package is the transport format. Engiware extracts its contents through
Obsidian's public Vault API. The result is a normal Markdown note, PDF documents,
editable Excalidraw drawings, images, and a self-contained GLB. Obsidian can index,
link, sync, and edit those files normally.

A ZIP member is not an Obsidian `TFile`. Keeping everything inside the archive
would require a separate virtual-file layer for native PDF, Excalidraw, backlinks,
and editing. Extraction gives each asset a real vault path and preserves the
image-first, on-demand viewer.

## Deployment directory and layout

**Settings → Engiware → Deployment directory** defaults to **`EngiLib`**.
Use a vault-relative folder such as `Engineering/Components`, or leave it empty
to deploy at the vault root. A changed setting controls subsequent imports;
existing deployments stay at their current locations. Each library location
tracks its own installed versions.

```text
<vault>/
└── EngiLib/
    ├── AB_1606-XLE240E.md
    └── Assets/AB_1606-XLE240E/
        ├── engibook.json
        ├── asset-provenance.json
        ├── schematic/
        ├── manuals/
        ├── 2d_scaled_component/
        └── 3d_rendered/
```

The archive itself may be stored anywhere. Once imported, the note and extracted
assets work independently of the archive. A component can contain PDFs, raster
images, SVGs, and native `.excalidraw.md` drawings. Excalidraw is used to edit
the latter; the included demo uses SVGs.

## Manifest and ZIP layout

The ZIP contains `engibook.json` **at its root**. Payload members use paths
relative to the deployment directory, such as `AB_1606-XLE240E.md` and
`Assets/AB_1606-XLE240E/manuals/guide.md`. The selected library prefix is never
baked into the portable archive.

The root manifest has these fields:

| Field | v2 meaning |
|---|---|
| `format` | `"engibook"` |
| `formatVersion` | `2` |
| `providerCode` | Manufacturer code, e.g. `AB` |
| `partNumber` | Part number, e.g. `1606-XLE240E` |
| `engibookVersion` | Semantic content version, e.g. `1.0.0` |
| `id` | Exactly `<providerCode>_<partNumber>` |
| `title` | Human-readable component title |
| `entrypoint` | `<id>.md` relative to the deployment directory |
| `assetRoot` | `Assets/<id>` |
| `files` | Complete payload inventory: `{path, bytes, sha256}` for each file |

The manifest is excluded from its own inventory. On import, the receipt is stored
at `<deploymentDirectory>/Assets/<id>/engibook.json`. It retains the source
manifest. For a nonempty deployment directory, it also records
`deploymentDirectory` and `deployedFiles` with the actual vault paths, sizes, and
hashes after text-link rebasing.
Payload assets live in the four standard directories; `asset-provenance.json`
can also live directly under the asset root. All four directories are created,
including any that are empty. Portable component notes reference `Assets/<id>/…`.
Deployment rebases those references in UTF-8 Markdown, JSON, SVG, CSS, and text
files; PDF page anchors and wikilink image sizes are preserved. Markdown URL
prefixes encode spaces in the chosen library name. Relative URLs and external
URLs retain their meaning. Binary models, PDFs, and images are copied unchanged.

## Import behavior

- The complete source inventory and SHA-256 hashes are checked before writing.
- A **newer content version replaces its listed destination files, including
  local edits**. Files absent from the new inventory remain in place.
- Identical same-version imports reuse files without rewriting them. Local edits
  conflicting with a same-version reimport are reported; publish a newer version
  to replace them. First-time deployments also report differing pre-existing
  files when there is no installed receipt or authorized pending import.
- Older versions are rejected. A version number cannot be reused for different
  package contents, even when only descriptive metadata changes.
- File/folder and case-insensitive path conflicts are rejected before writes.
- Assets are written before the entry note; the installed-version receipt is
  committed last. A temporary `engibook-import.json` record identifies an
  in-progress version so interrupted upgrades can resume and cannot be downgraded.
  That record is removed through Obsidian's configured trash mechanism on success.
- Deployment is a sequence of file writes, not a whole-folder atomic swap. After
  an interruption, reimport the same package (or a newer one) to finish it. The
  packager rejects components with an unfinished import record.
- Closing the package view or unloading Engiware cancels its pending import work.
- Browsing or importing a package does not initialize the 3D renderer.

Both formats accept stored/DEFLATE ZIP members, up to 128 MiB of archive data, 256 MiB
expanded data, and 512 ZIP entries. Absolute/traversal paths, undeclared files,
case-colliding paths, and unsupported format versions are rejected. Compression
support is bundled with the plugin; import works offline through browser APIs.

The archive is a snapshot. Editing an extracted drawing or note does not rewrite
the `.engibook`; create a new content version to distribute those changes.

Legacy v1 imports retain their unversioned ID and conflict behavior. A v2 package
can upgrade a v1 installation that already uses the same stable ID. Use the
packager's `--source-component` option to standardize an older unprefixed source.

## Create or refresh a package

From this project directory:

```bash
python scripts/package_engibook.py \
  --vault /path/to/your/vault \
  --provider-code AB \
  --part-number 1606-XLE240E \
  --engibook-version 1.0.0 \
  --title 'Allen-Bradley 1606-XLE240E'
```

This reads the component from `EngiLib/` by default and writes
`releases/AB_1606-XLE240E_1.0.0.engibook`. Use `--deployment-directory` to select a
different source library; pass `--deployment-directory ''` for the vault root.

To convert the original unprefixed component at the vault root:

```bash
python scripts/package_engibook.py \
  --vault /path/to/your/vault \
  --deployment-directory '' \
  --source-component 1606-XLE240E \
  --provider-code AB \
  --part-number 1606-XLE240E \
  --engibook-version 1.0.0
```

Packaging writes only the output archive. It leaves the source note, assets, and
installed receipt intact. In the packaged copy, it removes the deployment prefix,
adjusts paths for a standardized ID, and writes the note's `provider_code`,
`part_number`, and `engibook_version` frontmatter. Stable ZIP metadata makes the
result reproducible. An existing output filename with different bytes is rejected;
increment the content version. `--output` selects a destination with the canonical
filename. Python 3.10+ and its standard library are sufficient.

Download: **[GPP_Demo-Component_1.0.0.engibook](examples/GPP_Demo-Component_1.0.0.engibook)**.
