# Obsidian community listing

## Current release

**0.4.0** introduces underscore-separated versioned package names, format v2,
newer-version replacement, resumable deployments, and a searchable **Deployment
directory** setting with **`EngiLib`** as its default. See the
[format guide](ENGIBOOK.md) and [release notes](RELEASE_NOTES.md).

## Previous release: 0.3.2

**0.3.2** adds an explicit, reduced-quality WebGL retry when the normal graphics
attempt fails. Expanding still starts 3D automatically on supported graphics.
Devices that fail that check keep the image and can choose **Try 3D anyway**.
See [release notes](RELEASE_NOTES.md) for the interaction and rendering limits.

The automated review for
[release 0.3.2](https://github.com/GreenPipePartners/obsidian-engiware/releases/tag/0.3.2)
is **complete with zero warnings and zero recommendations**. The public
scorecard shows **Health: Excellent** and **Review: Passed**. Obsidian verified
the release attestations and reproduced `main.js` byte-for-byte from commit
`20772b5`.

All 18 tests pass. Native checks on Obsidian 1.13.7 for Linux verified automatic
3D on supported graphics, confirmation before model reads, the reduced-quality
retry, cancellation, and resource cleanup. Context failures and slow-frame
timing were simulated; rendering used the real local WebGL implementation.

## Previous release: 0.3.1

The automated review for **0.3.1** is **complete with zero warnings and zero
recommendations**. The public scorecard shows **Health: Excellent** and
**Review: Passed**. Obsidian verified the release attestations and reproduced
`main.js` byte-for-byte. The review is attached to commit `7893699`.

[Release 0.3.1](https://github.com/GreenPipePartners/obsidian-engiware/releases/tag/0.3.1)
is also visible in the native Community plugins browser, verified on Obsidian
1.13.7 for Linux on September 14, 2026.

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
runs hourly (`17 * * * *`). The entry reached the app catalogue at 22:26 UTC on
September 14, 2026. GitHub's raw-file cache and Obsidian's fallback proxy can
retain older lists temporarily; reopening Obsidian refreshes the app's own
catalogue cache once the upstream list is available.

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
