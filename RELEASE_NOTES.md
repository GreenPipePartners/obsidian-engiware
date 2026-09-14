## Engiware 0.3.1

Addresses the recommendations and warnings from the initial community review.

- Limit import conflict checks to package destination folders and their parents.
  Preserve case-insensitive collision detection, including an exact destination
  that exists alongside a differently cased alias.
- Make all three Engiware controls discoverable in Obsidian 1.13+ settings search.
  Older supported versions render the same controls from shared definitions.
- Replace the duplicate viewport-height declaration with an explicit CSS feature
  query, and use selector specificity for hidden states.
- Publish the three standard plugin assets: `main.js`, `manifest.json`, and
  `styles.css`, with GitHub artifact attestations.

Requires Obsidian **1.8.7 or later**. Update through Community plugins or BRAT.
For manual installation, download the three release files into your vault's
`.obsidian/plugins/engiware/` directory, reload Obsidian, and enable Engiware.

The original MIT-licensed [Demo-Component.engibook](https://raw.githubusercontent.com/GreenPipePartners/obsidian-engiware/0.3.1/examples/Demo-Component.engibook)
is available from the repository. Import it through **Engiware: Import .engibook**.
