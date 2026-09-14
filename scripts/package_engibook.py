"""Package a native component note and its organized assets as a reproducible ZIP.

python scripts/package_engibook.py --vault /path/to/vault --component Demo-Component
"""

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path

DIRECTORIES = ('schematic', 'manuals', '2d_scaled_component', '3d_rendered')
ROOT = Path(__file__).resolve().parents[1]


def package(vault, component, output, title=None):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', component):
        raise ValueError('Component ID must be a portable alphanumeric filename.')
    entrypoint = f'{component}.md'
    asset_root = f'Assets/{component}'
    note = vault / entrypoint
    assets = vault / asset_root
    files = {entrypoint: note.read_bytes()}
    for directory in DIRECTORIES:
        if not (assets / directory).is_dir():
            raise ValueError(f'Missing asset directory: {assets / directory}')
    for path in sorted(assets.rglob('*')):
        if not path.is_file():
            continue
        relative = path.relative_to(assets)
        if relative.as_posix() == 'engibook.json':
            continue  # The inventory is regenerated; it does not hash itself.
        if relative.parts[0] not in DIRECTORIES and relative.as_posix() != 'asset-provenance.json':
            raise ValueError(f'Place this asset in a standard directory before packaging: {relative}')
        files[path.relative_to(vault).as_posix()] = path.read_bytes()
    # Check local references, including the YAML paths used by Engiware previews.
    text = note.read_text()
    references = set(re.findall(r'\[\[([^]|]+)', text))
    references.update(re.findall(r'^(?:model|image):\s*(.+)$', text, re.M))
    for reference in references:
        path = reference.split('#', 1)[0]
        if path.startswith('Assets/') and path not in files:
            raise ValueError(f'Note refers to an asset outside this package: {path}')
    manifest = {
        'format': 'engibook', 'formatVersion': 1, 'id': component,
        'title': title or component, 'entrypoint': entrypoint, 'assetRoot': asset_root,
        'files': [{'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                  for path, data in sorted(files.items())],
    }
    manifest_bytes = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w') as archive:
        for path, data in [('engibook.json', manifest_bytes), *sorted(files.items())]:
            member = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
            member.compress_type = zipfile.ZIP_DEFLATED
            member.external_attr = 0o100644 << 16
            archive.writestr(member, data, compresslevel=6)
    (assets / 'engibook.json').write_bytes(manifest_bytes)
    return {'resource': str(output), 'bytes': output.stat().st_size,
            'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
            'files': len(files), 'expanded_bytes': sum(map(len, files.values())), 'manifest': manifest}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--vault', type=Path, required=True)
    parser.add_argument('--component', required=True)
    parser.add_argument('--title')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    output = args.output or ROOT / 'releases' / f'{args.component}.engibook'
    print(json.dumps(package(args.vault.resolve(), args.component, output, args.title), indent=2))
