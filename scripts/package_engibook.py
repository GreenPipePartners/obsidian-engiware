"""Build provider_part_version.engibook without modifying the source library."""

import argparse
import hashlib
import io
import json
import re
import unicodedata
from urllib.parse import quote
import zipfile
from pathlib import Path

DIRECTORIES = ('schematic', 'manuals', '2d_scaled_component', '3d_rendered')
MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
MAX_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024
ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(r'^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$')


def portable_identity_token(value):
    return bool(re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9._-]|\{[A-Za-z0-9]+\})*', value)) and not value.endswith('.')


def identity(provider_code, part_number, engibook_version):
    if not re.fullmatch(r'[A-Z0-9]{1,16}', provider_code):
        raise ValueError('Provider code must contain 1–16 uppercase letters or digits.')
    if not portable_identity_token(part_number):
        raise ValueError('Part number or family pattern must be a portable filename with balanced alphanumeric brace groups.')
    component = f'{provider_code}_{part_number}'
    if len(component) > 80:
        raise ValueError('The component ID must fit within 80 characters.')
    match = VERSION.fullmatch(engibook_version) if len(engibook_version) <= 64 else None
    if not match:
        raise ValueError('Engibook content version must be a semantic version such as 1.0.0.')
    prerelease = match[4].split('.') if match[4] else []
    build = match[5].split('.') if match[5] else []
    if any(not part for part in prerelease + build) or any(part.isdigit() and len(part) > 1 and part.startswith('0') for part in prerelease):
        raise ValueError('Invalid semantic version identifier.')
    return component


def portable_path(path):
    return (0 < len(path) <= 240 and not re.search(r'[\\:#?|*<>"]', path)
            and all(ord(character) >= 32 for character in path)
            and path == unicodedata.normalize('NFC', path) and '\u00a0' not in path
            and all(part and not part.startswith('.') and not part.endswith(('.', ' ')) for part in path.split('/')))


def portable_text(data, path, deployment, source, component):
    if Path(path).suffix.lower() not in {'.md', '.json', '.svg', '.css', '.txt'}:
        return data
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        return data
    for old, new, boundary in [
        (f'Assets/{source}', f'Assets/{component}', r'(?=/)'),
        (f'{source}.md', f'{component}.md', r'(?=[#|\]\s)"\']|$)'),
    ]:
        candidates = [f'{deployment}/{old}', quote(f'{deployment}/{old}', safe='/')] if deployment else []
        candidates.append(old)
        for candidate in dict.fromkeys(candidates):
            text = re.sub(r'(?<![\w./%:-])' + re.escape(candidate) + boundary, lambda _: new, text)
    return text.encode('utf-8')


def note_identity(data, provider_code, part_number, engibook_version):
    text = data.decode('utf-8')
    fields = ''.join(f'{key}: {json.dumps(value, ensure_ascii=False)}\n' for key, value in [
        ('provider_code', provider_code), ('part_number', part_number), ('engibook_version', engibook_version)])
    frontmatter = re.match(r'\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)', text, re.S)
    if frontmatter:
        body = re.sub(r'^(?:provider_code|part_number|engibook_version):[^\r\n]*(?:\r?\n|$)', '', frontmatter[1], flags=re.M)
        text = '---\n' + fields + body + '\n---\n' + text[frontmatter.end():]
    else:
        text = '---\n' + fields + '---\n' + text
    return text.encode('utf-8')


def package(vault, provider_code, part_number, engibook_version, output=None, title=None,
            deployment_directory='EngiLib', source_component=None):
    component = identity(provider_code, part_number, engibook_version)
    title = (title or component).strip()
    if not title or len(title) > 240:
        raise ValueError('The Engibook needs a component title of up to 240 characters.')
    source = source_component or component
    if len(source) > 80 or not portable_identity_token(source):
        raise ValueError('Source component must be a portable component ID.')
    deployment = deployment_directory.strip().replace('\\', '/').rstrip('/')
    if deployment and (len(deployment) > 120 or not portable_path(deployment)):
        raise ValueError('Deployment directory must be a vault-relative folder.')
    if not deployment and re.search(r'[\\/]', deployment_directory):
        raise ValueError('Use an empty deployment directory for the vault root.')
    base = vault / deployment
    entrypoint = f'{component}.md'
    asset_root = f'Assets/{component}'
    note = base / f'{source}.md'
    assets = base / f'Assets/{source}'
    if (assets / 'engibook-import.json').exists():
        raise ValueError('Complete the in-progress component import before packaging it.')
    files = {entrypoint: note_identity(portable_text(note.read_bytes(), entrypoint, deployment, source, component), provider_code, part_number, engibook_version)}
    for directory in DIRECTORIES:
        if not (assets / directory).is_dir():
            raise ValueError(f'Missing asset directory: {assets / directory}')
    for path in sorted(assets.rglob('*')):
        if path.is_symlink():
            raise ValueError(f'Package assets must be files inside the component, not symbolic links: {path}')
        if not path.is_file():
            continue
        relative = path.relative_to(assets)
        if relative.as_posix() == 'engibook.json':
            continue  # Installed receipts are not part of the portable payload.
        if relative.parts[0] not in DIRECTORIES and relative.as_posix() != 'asset-provenance.json':
            raise ValueError(f'Place this asset in a standard directory before packaging: {relative}')
        destination = f'{asset_root}/{relative.as_posix()}'
        files[destination] = portable_text(path.read_bytes(), destination, deployment, source, component)
    spellings = {}
    for path, data in files.items():
        if not portable_path(path) or len(data) > MAX_ARCHIVE_BYTES:
            raise ValueError(f'Invalid or oversized package member: {path}')
        for candidate in [path, *[p.as_posix() for p in Path(path).parents if p.as_posix() != '.']]:
            previous = spellings.setdefault(candidate.lower(), candidate)
            if previous != candidate:
                raise ValueError(f'Case-conflicting package path: {candidate}')
    if len(files) >= 512 or sum(map(len, files.values())) > MAX_EXPANDED_BYTES:
        raise ValueError('This component exceeds the Engibook inventory limits.')
    # Check local references, including the YAML paths used by Engiware previews.
    text = files[entrypoint].decode('utf-8')
    references = set(re.findall(r'\[\[([^]|]+)', text))
    references.update(re.findall(r'^(?:model|image|package):\s*(.+)$', text, re.M))
    for reference in references:
        path = reference.split('#', 1)[0]
        if path.startswith('Assets/') and path not in files:
            raise ValueError(f'Note refers to an asset outside this package: {path}')
    manifest = {
        'format': 'engibook', 'formatVersion': 2, 'id': component,
        'providerCode': provider_code, 'partNumber': part_number, 'engibookVersion': engibook_version,
        'title': title, 'entrypoint': entrypoint, 'assetRoot': asset_root,
        'files': [{'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                  for path, data in sorted(files.items())],
    }
    manifest_bytes = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()
    if len(manifest_bytes) > 64 * 1024:
        raise ValueError('Engibook manifest exceeds 64 KiB.')
    filename = f'{component}_{engibook_version}.engibook'
    output = output or ROOT / 'releases' / filename
    if output.name != filename:
        raise ValueError(f'The package filename must be {filename}')
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for path, data in [('engibook.json', manifest_bytes), *sorted(files.items())]:
            member = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
            member.compress_type = zipfile.ZIP_DEFLATED
            member.external_attr = 0o100644 << 16
            archive.writestr(member, data, compresslevel=6)
    package_bytes = buffer.getvalue()
    if len(package_bytes) > MAX_ARCHIVE_BYTES:
        raise ValueError('Engibook archive exceeds 1 GiB.')
    if output.exists() and output.read_bytes() != package_bytes:
        raise ValueError(f'{output.name} already contains different bytes. Use a newer content version.')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(package_bytes)
    return {'resource': str(output), 'bytes': output.stat().st_size,
            'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
            'files': len(files), 'expanded_bytes': sum(map(len, files.values())), 'manifest': manifest}


def main(output_directory=ROOT / 'releases'):
    parser = argparse.ArgumentParser()
    parser.add_argument('--vault', type=Path, required=True)
    parser.add_argument('--provider-code', required=True)
    parser.add_argument('--part-number', required=True)
    parser.add_argument('--engibook-version', required=True)
    parser.add_argument('--deployment-directory', default='EngiLib')
    parser.add_argument('--source-component', help='Repackage an older component under the standardized ID.')
    parser.add_argument('--title')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    component = identity(args.provider_code, args.part_number, args.engibook_version)
    output = args.output or output_directory / f'{component}_{args.engibook_version}.engibook'
    print(json.dumps(package(args.vault.resolve(), args.provider_code, args.part_number, args.engibook_version,
                             output, args.title, args.deployment_directory, args.source_component), indent=2))


if __name__ == '__main__':
    main()
