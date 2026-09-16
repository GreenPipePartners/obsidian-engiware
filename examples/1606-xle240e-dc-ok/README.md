# 1606-XLE240E — DC OK Perspective sample

One Boolean signal controls the **actual DC OK lamp in the existing 2D component
drawing**: **true = green / DC OK**; **false = red / DC NOT OK**. The checkbox writes the same Boolean through native
bidirectional property and tag bindings. There are no script transforms or event scripts.

## Obsidian

Open the `.engispark` with Engiware 0.6.1+, or select **Sample view** in the
1606-XLE240E component note. Toggle **DC OK signal**. **Reset sample** restores true.
Each open sample has independent in-memory tags. Closing and reopening resets it.

Engiware renders the exact `view.json` bytes inside the enclosed native project
ZIP. Layout, labels, colors and bindings are defined by that JSON. The Engispark
manifest supplies the initial simulated tag value and names the entry view.
The original `1606-XLE240E-panel.svg` is imported as a native `ia.shapes.svg`
drawing, cropped to its operator face. Its 510 paths, 306 transforms and 32 text
labels are preserved. Bindings change the existing lamp's fill and outline:
`props.elements[32].elements[0].fill.paint` and
`props.elements[32].elements[1].stroke.paint`. No overlay lamp is added.

## Native Ignition import

1. Select **Extract Ignition files**. Engiware writes the original project ZIP,
   `DC_OK.tags.json`, and this guide under
   `<deployment directory>/Exports/AB_1606-XLE240E-DC-OK_0.2.0/`.
2. In the Ignition Designer (Perspective, 8.1+), use **File → Import** and choose
   `AB_1606-XLE240E-DC-OK_0.2.0.ignition.zip`.
3. In the Tag Browser, select the **[default]** provider root and import
   `DC_OK.tags.json`. This creates one memory Boolean at
   **`[default]Engispark/PS1_DC_OK`**, initially true.
4. Open **`Engispark/AB_1606-XLE240E/DC_OK`** and enter preview mode. Toggle
   **DC OK signal**; the indication changes between green and red.

The view has a single input parameter, **`tagPath`**. Set it to another Boolean
tag path when embedding the view. In Ignition the checkbox writes that selected
tag. The `.engispark` outer ZIP is opened by Engiware; the enclosed `.ignition.zip`
is the native Designer import artifact. Tags use Ignition's separate native tag import.

## Signal meaning

`PS1_DC_OK = true` represents a healthy 13–14 DC OK contact. The physical
1606-XLE240E has a **green** DC OK indicator; the red false-state indication is
the chosen HMI convention. This sample displays the raw Boolean directly.
The component book's 5 s startup / 500 ms alarm logic is a separate example.

## Rebuild

From the Engiware plugin source directory:

```sh
python3 scripts/import_dc_ok_svg.py
python3 scripts/package_engispark.py
```

`import_dc_ok_svg.py` performs the authoring-time SVG import. `view.json` is the
native runtime source of truth. The packager copies its bytes verbatim
into a filesystem-v2 Ignition project export and then into the Engispark package.
The original SVG and its source-element provenance are also included in the
Engispark's `artwork/` inventory.
