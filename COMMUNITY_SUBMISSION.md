# Obsidian community listing

## Current release

**0.3.1** addresses all five findings from the initial 0.3.0 review:

| Finding | Resolution |
|---|---|
| Extra release attachments | Release workflow uploads the three standard plugin files; the demo is downloaded from the repository. |
| Vault enumeration | Import preflight checks immediate children of destination parents, with regression coverage for unrelated folders and case aliases. |
| Settings search | Shared setting definitions power Obsidian 1.13+ search and the legacy settings renderer. |
| Duplicate CSS height | Dynamic viewport height uses a feature query with a compatible fallback. |
| CSS `!important` | Hidden-state selector has sufficient specificity. |

See the [maintainer dashboard](https://community.obsidian.md/account/plugins/engiware)
for review results tied to each release and commit.

## Initial submission

Engiware **0.3.0** was submitted and published on **September 14, 2026**, owned by
the **Green Pipe Partners LLC** community organization (`greenpipepartners`).

- [Public listing](https://community.obsidian.md/plugins/engiware)
- [Maintainer dashboard](https://community.obsidian.md/account/plugins/engiware)
- [GitHub release](https://github.com/GreenPipePartners/obsidian-engiware/releases/tag/0.3.0)

The initial automated review is **complete**, and **Add to Obsidian** is enabled.
The public scorecard reports **Health: Excellent** and **Review: Satisfactory**.
Checks verified the artifact attestations for `main.js` and `styles.css`, found
no vulnerable dependencies or code obfuscation, and reproduced `main.js`
byte-for-byte from source.

Users can install through **Settings → Community plugins → Browse → Engiware**,
the public listing's **Add to Obsidian** link, BRAT, or the individual release files.

At publication, the website's installation link was enabled while the in-app
catalogue still awaited propagation. Obsidian's
[catalogue mirror workflow](https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/mirror-community-json.yml)
runs hourly (`17 * * * *`); the new entry needs that catalogue sync to appear in
the app's Browse search.

## Listing maintenance

The public plugin repository is:

**https://github.com/GreenPipePartners/obsidian-engiware**

Listings use the [Obsidian Community directory](https://community.obsidian.md),
as described in the [submission guide](https://docs.obsidian.md/plugins/releasing/submit-plugin).

Sign in with the maintainer's Obsidian account and open **Plugins → Engiware** to
inspect reviews, update the listing, and manage ownership. The connected GitHub
account must have public organization membership so the directory can verify
access to the organization's repository.

The repository provides a root README, MIT license, manifest, source, version
compatibility map, reproducible example, tests, and tagged GitHub release assets.
The manifest's version must match a published release tag without a `v` prefix.

The community directory manages reviews and availability in Obsidian's
**Community plugins → Browse**. Future version tags publish installable updates
through the repository's release workflow.
