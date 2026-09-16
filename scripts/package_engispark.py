"""Reproducible 1606-XLE240E pilot: native Perspective export nested in Engispark."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ID = 'AB_1606-XLE240E-DC-OK'
VERSION = '0.2.0'
VIEW = 'Engispark/AB_1606-XLE240E/DC_OK'


def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')


def archive(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as target:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            target.writestr(info, data, compresslevel=6)
    return output.getvalue()


def package(source=ROOT / 'examples/1606-xle240e-dc-ok', output=None):
    native_name = f'{ID}_{VERSION}.ignition.zip'
    view = (source / 'view.json').read_bytes()
    tag_export = (source / 'DC_OK.tags.json').read_bytes()
    json.loads(view)
    json.loads(tag_export)
    root = f'com.inductiveautomation.perspective/views/{VIEW}'
    native = archive({
        'project.json': encode({'title': 'Engispark — 1606-XLE240E DC OK',
                                'description': 'Single-Boolean DC OK faceplate sample.',
                                'enabled': True, 'inheritable': False, 'parent': ''}),
        f'{root}/resource.json': encode({'scope': 'G', 'version': 1, 'restricted': False,
                                        'overridable': True, 'files': ['view.json'], 'attributes': {}}),
        f'{root}/view.json': view,
    })
    files = {
        f'ignition/{native_name}': native,
        'ignition/DC_OK.tags.json': tag_export,
        'README.md': (source / 'README.md').read_bytes(),
        'artwork/1606-XLE240E-panel.svg': (source / '1606-XLE240E-panel.svg').read_bytes(),
        'artwork/provenance.json': (source / 'artwork-provenance.json').read_bytes(),
    }
    manifest = {
        'format': 'engispark', 'formatVersion': 1, 'id': ID, 'version': VERSION,
        'title': '1606-XLE240E · live component drawing', 'runtimeProfile': 'perspective-basic@0.2.0',
        'ignition': {'project': f'ignition/{native_name}', 'tags': 'ignition/DC_OK.tags.json',
                     'viewPath': VIEW, 'minimumVersion': '8.1.0'},
        'simulation': {'tags': [{'path': '[default]Engispark/PS1_DC_OK', 'dataType': 'Boolean', 'value': True}]},
        'files': [{'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                  for path, data in sorted(files.items())],
    }
    data = archive({**files, 'engispark.json': encode(manifest)})
    output = output or ROOT / 'examples' / f'{ID}_{VERSION}.engispark'
    if output.exists() and output.read_bytes() != data:
        raise ValueError('This Engispark version already exists with different bytes. Increment its version.')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)
    return {'package': str(output), 'sha256': hashlib.sha256(data).hexdigest(),
            'view_sha256': hashlib.sha256(view).hexdigest(), 'bytes': len(data), 'native_project_bytes': len(native)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'examples/1606-xle240e-dc-ok')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    print(json.dumps(package(args.source, args.output), indent=2))
