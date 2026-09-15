## Engiware 0.4.0

Adds standardized, versioned Engibooks and a configurable component library.

- Name packages **`providerCode_partNumber_engibookVersion.engibook`**, for
  example **`AB_1606-XLE240E_1.0.0.engibook`**. Preserve hyphens inside part numbers.
- Deploy all content versions to the stable **`providerCode_partNumber`** note
  and asset ID. Content versions use semantic-version ordering.
- Add **Deployment directory** in Engiware settings, defaulting to **`EngiLib`**.
  Support nested library folders and a blank setting for the vault root, with
  asset links adjusted for the chosen directory.
- A **newer content version replaces packaged destination files, including
  local edits**. Files absent from the new inventory remain in place.
- Reject downgrades and different package contents reusing a version number.
  Resume interrupted deployments using a temporary import record; commit the
  installed version after the assets and entry note.
- Add format v2 metadata, a versioned demonstration, and a read-only-to-vault
  Python packager. Legacy format v1 imports remain supported.

Requires Obsidian **1.8.7 or later**. Update through Community plugins or BRAT.
For manual installation, download the three release files into your vault's
`.obsidian/plugins/engiware/` directory, reload Obsidian, and enable Engiware.

The original MIT-licensed [GPP_Demo-Component_1.0.0.engibook](https://raw.githubusercontent.com/GreenPipePartners/obsidian-engiware/0.4.0/examples/GPP_Demo-Component_1.0.0.engibook)
is available from the repository. Import it through **Engiware: Import .engibook**.
