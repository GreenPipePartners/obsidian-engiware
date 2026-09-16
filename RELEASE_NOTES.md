## Engiware 0.6.2 — shared standalone Engispark runtime

- Use `@greenpipepartners/engispark` 0.2.0 from its versioned GitHub Release.
  The package loader, native binding evaluator, SVG/DOM renderer and native-view
  CSS are shared with the standalone browser player.
- The independent source is <https://github.com/GreenPipePartners/engispark>;
  the hosted player is <https://greenpipepartners.github.io/engispark/>.
- Bundle the shared library and its stylesheet into the plugin for offline use.
  Engispark package bytes and native Ignition export resources remain compatible.

This public release also includes the work developed since 0.4.0: interactive
SVG samples and native Ignition extraction, termination guides and ferruled-wire
capacity inspection, literal family identities, and assembly-sized Engibook
archives. The development milestones below describe those additions.

## Engiware 0.6.1 — animate the component's own SVG lamp

- Render native `ia.shapes.svg` Drawing resources and indexed Perspective
  property paths such as `props.elements[32].elements[0].fill.paint`.
- The revised DC OK Engispark reuses the Engibook's existing
  `1606-XLE240E-panel.svg`, cropped to the operator face. One Boolean drives
  the original lamp's fill and outline; all 510 SVG paths, 306 transforms and
  32 labels remain intact.
- Engispark 0.2.0 records the source SVG hash and the original Excalidraw lamp
  element `861f0e79`. The original SVG is included in its artwork inventory.
- `perspective-basic@0.2.0` adds bounded SVG element rendering; 0.1.0 packages
  remain readable. SVG scripts, external resources and unsupported attributes
  are rejected before rendering.

## Engiware 0.6.0 — native Perspective Engispark pilot

- Open `.engispark` packages or embed an `engispark` code block in an Engibook note.
- **Sample view** reads the enclosed Ignition project ZIP's native `view.json`;
  flex layout, labels, checkbox, indirect tag/property bindings and map transforms
  drive the sample directly. The initial profile is `perspective-basic@0.1.0`.
- The 1606-XLE240E sample has one Boolean reference: true → green / DC OK,
  false → red / DC NOT OK. Each sample has its own resettable in-memory tag store.
- **Extract Ignition files** exports the original Designer project ZIP and native
  tag JSON byte-for-byte, plus import instructions. Existing different exports
  are not overwritten.
- Inventory hashes, bounded archives and explicit profile checks run before
  displaying a sample. Closing, unloading or replacing a card releases its state
  and listeners. Engibook packaging validates `package:` references.

This is a local prototype release. The basic profile runs in the Obsidian renderer;
the Node-hosted Gateway/Fluxy service and Python 3 scripting runtime are follow-on work.
See [ENGISPARK.md](ENGISPARK.md) for the supported native subset and package contract.

## Engiware 0.5.3 — explicit wire-gauge limits

- Termination details state **Maximum ferruled wire: … AWG**, alongside the mm² maximum and remaining ferrule conditions.
- `max_ferruled_wire_awg` records the largest permitted conductor. `awg_limit_basis` distinguishes manufacturer ferrule ratings from conservative area-derived limits; unknown and N/A remain explicit.
- `wireEndFromAwg()` constructs an AWG-specific request. Sized checks account for AWG's reversed numbering, reject conflicting AWG/area declarations, and enforce the limit at both ends. Aught sizes use `1/0` through `4/0`.

## Engiware 0.5.2 — ferruled conductor capacity

- Select a termination vector to inspect its single-ferrule maximum area, collar, crimped-envelope and barrel-length conditions, and manufacturer evidence.
- Additive `gpp.wire-capacity@0.1.0` metadata keeps electrical ratings independent of geometric eligibility. Earlier GLBs remain viewable; missing, malformed, provisional and unknown ratings cannot authorize sized wire routing.
- Sized resolution checks both ends and physical-clamp occupancy. Copper conductors require one ferrule per clamp; bare ends and twin ferrules are excluded by this profile. Lug seats, crimp barrels and connectors retain explicit interface types.

## Engiware 0.5.1 — local library vector review

Keeps labels selectable when a small component's outward arrow extends beyond
the viewport. Dense terminal labels are spaced with screen-space leader lines;
physical anchor positions, directions, routing eligibility and model bounds are
unchanged. Reviewed against the library-wide component and panel vector rollout.

## Engiware 0.5.0 — local termination-anchor pilot

Adds **Show terminations** to models carrying the draft
`gpp.termination-anchors@0.1.0` profile. Meshless GLB nodes provide entry points,
outward directions, stable terminal IDs and evidence metadata. The on-demand
overlay uses those frames for targets, arrows and selectable labels. Provisional
points are marked in amber and explicitly excluded from routing lookup. Helpers
start hidden, leave physical model bounds intact and are disposed with the viewer.

The initial review asset is `AB_1492-J4_1.1.0-draft.1.engibook`. This local build
retains the 0.4.2 package-size support below; no public release is implied.

## Engiware 0.4.2

Supports full-panel Engibooks with **1 GiB archive / 2 GiB expanded** limits and
up to **1 GiB per member**. The importer, file picker, package view, and Python
packager use the same limits. Format v1/v2 inventories, SHA-256 validation,
version handling, and the 512-entry limit continue to apply.

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
