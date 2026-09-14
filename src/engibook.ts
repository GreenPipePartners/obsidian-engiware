import { unzip } from 'fflate';
import type { UnzipFileInfo, Unzipped } from 'fflate';
import type { TFile, Vault } from 'obsidian';

export const ASSET_DIRECTORIES = ['schematic', 'manuals', '2d_scaled_component', '3d_rendered'] as const;
export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 512;
const MANIFEST = 'engibook.json';

export interface BookFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface BookManifest {
  format: 'engibook';
  formatVersion: 1;
  id: string;
  title: string;
  entrypoint: string;
  assetRoot: string;
  files: BookFile[];
}

export interface BookInspection {
  manifest: BookManifest;
  manifestBytes: Uint8Array;
  expandedBytes: number;
}

export interface BookImport {
  manifest: BookManifest;
  entry: TFile;
  created: number;
  reused: number;
}

export class BookConflictError extends Error {
  readonly paths: string[];
  constructor(paths: string[]) {
    super(`Existing files differ from this package: ${paths.slice(0, 4).join(', ')}${paths.length > 4 ? '…' : ''}. No files were overwritten.`);
    this.name = 'BookConflictError';
    this.paths = paths;
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Engibook import cancelled.', 'AbortError');
}

function safePath(path: string): boolean {
  return path.length > 0 && path.length <= 240 && !/[\\:#?|*<>"]/.test(path)
    && [...path].every(character => character.charCodeAt(0) >= 32)
    && path === path.normalize('NFC') && !path.includes('\u00a0')
    && path.split('/').every(part => part.length > 0 && !part.startsWith('.') && !/[. ]$/.test(part));
}

function pathKey(path: string): string { return path.normalize('NFC').toLowerCase(); }

function unpack(bytes: Uint8Array, filter: (file: UnzipFileInfo) => boolean, signal?: AbortSignal): Promise<Unzipped> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    let terminate: (() => void) | undefined;
    const abort = () => { terminate?.(); reject(new DOMException('Engibook import cancelled.', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      // fflate moves large DEFLATE members into browser workers.
      terminate = unzip(bytes, { filter }, (error, result) => {
        signal?.removeEventListener('abort', abort);
        if (error) reject(new Error(`Cannot read this Engibook ZIP: ${error.message}`));
        else resolve(result);
      });
    } catch (error) {
      signal?.removeEventListener('abort', abort);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function inspectBook(bytes: Uint8Array, signal?: AbortSignal): Promise<BookInspection> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('This Engibook exceeds the 128 MiB archive limit.');
  const members = new Map<string, number>();
  const names = new Set<string>();
  let expandedBytes = 0;
  const manifestFile = await unpack(bytes, file => {
    const directory = file.name.endsWith('/');
    const path = directory ? file.name.slice(0, -1) : file.name;
    if (!safePath(path)) throw new Error(`Invalid Engibook path: ${file.name}`);
    const key = pathKey(path);
    if (names.has(key)) throw new Error(`Duplicate Engibook path: ${path}`);
    names.add(key);
    if (names.size > MAX_FILES) throw new Error('This Engibook contains too many entries.');
    if (directory) return false;
    if (![0, 8].includes(file.compression)) throw new Error('Engibooks support stored or DEFLATE ZIP members.');
    expandedBytes += file.originalSize;
    if (file.originalSize > MAX_ARCHIVE_BYTES || expandedBytes > MAX_EXPANDED_BYTES) throw new Error('This Engibook exceeds the expanded size limit.');
    if (file.name === MANIFEST && file.originalSize > 64 * 1024) throw new Error('Engibook manifest is too large.');
    members.set(file.name, file.originalSize);
    return file.name === MANIFEST;
  }, signal);
  checkAbort(signal);
  const manifestBytes = manifestFile[MANIFEST];
  if (!manifestBytes) throw new Error('The ZIP must contain engibook.json at its root.');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)); }
  catch { throw new Error('The Engibook manifest is not valid UTF-8 JSON.'); }
  if (!value || typeof value !== 'object') throw new Error('Invalid Engibook manifest.');
  const input = value as Record<string, unknown>;
  if (input.format !== 'engibook' || input.formatVersion !== 1) throw new Error('Unsupported Engibook format version.');
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.id)) throw new Error('Invalid Engibook component ID.');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 240) throw new Error('The Engibook needs a component title.');
  if (input.entrypoint !== `${input.id}.md` || input.assetRoot !== `Assets/${input.id}`) throw new Error('Engibook paths must use the component ID and standard Assets directory.');
  const assetRoot = `Assets/${input.id}`;
  if (!Array.isArray(input.files) || !input.files.length || input.files.length >= MAX_FILES) throw new Error('Invalid Engibook file inventory.');
  const files: BookFile[] = [];
  const listed = new Set<string>();
  for (const item of input.files) {
    if (!item || typeof item !== 'object') throw new Error('Invalid Engibook file inventory.');
    const { path, bytes: size, sha256 } = item as Record<string, unknown>;
    if (typeof path !== 'string' || !safePath(path)) throw new Error('Invalid path in Engibook inventory.');
    const allowed = path === input.entrypoint || path === `${assetRoot}/asset-provenance.json`
      || ASSET_DIRECTORIES.some(dir => path.startsWith(`${assetRoot}/${dir}/`));
    if (!allowed) throw new Error(`File is outside the Engibook layout: ${path}`);
    if (listed.has(pathKey(path))) throw new Error(`Duplicate inventory path: ${path}`);
    listed.add(pathKey(path));
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || members.get(path) !== size) throw new Error(`Missing or wrong-sized Engibook member: ${path}`);
    if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Missing SHA-256 for ${path}`);
    files.push({ path, bytes: size, sha256 });
  }
  if (!files.some(file => file.path === input.entrypoint)) throw new Error('The Engibook entry note is missing.');
  if (members.size !== files.length + 1) throw new Error('The ZIP contains files not listed in engibook.json.');
  const paths = new Set(files.map(file => pathKey(file.path)));
  const spelling = new Map<string, string>();
  for (const file of files) {
    for (const parent of parents(file.path)) if (paths.has(pathKey(parent))) throw new Error(`Engibook file/folder collision: ${parent}`);
    for (const path of [file.path, ...parents(file.path)]) {
      const previous = spelling.get(pathKey(path));
      if (previous && previous !== path) throw new Error(`Inconsistent Engibook path casing: ${path}`);
      spelling.set(pathKey(path), path);
    }
  }
  return {
    manifest: { format: 'engibook', formatVersion: 1, id: input.id, title: input.title.trim(), entrypoint: input.entrypoint, assetRoot: input.assetRoot, files },
    manifestBytes,
    expandedBytes,
  };
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function parents(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

export async function importBook(vault: Vault, bytes: Uint8Array, signal?: AbortSignal): Promise<BookImport> {
  const { manifest, manifestBytes } = await inspectBook(bytes, signal);
  const expected = new Map(manifest.files.map(file => [file.path, file]));
  const files = await unpack(bytes, file => expected.has(file.name), signal);
  for (const file of manifest.files) {
    checkAbort(signal);
    if (!files[file.path] || files[file.path].byteLength !== file.bytes || await sha256(files[file.path]) !== file.sha256) throw new Error(`Engibook checksum mismatch: ${file.path}`);
  }
  const receiptPath = `${manifest.assetRoot}/${MANIFEST}`;
  files[receiptPath] = manifestBytes.slice();
  const inventory = [...manifest.files, { path: receiptPath, bytes: manifestBytes.byteLength, sha256: await sha256(manifestBytes) }];
  const folders = new Set(ASSET_DIRECTORIES.map(dir => `${manifest.assetRoot}/${dir}`));
  for (const file of inventory) parents(file.path).forEach(parent => folders.add(parent));

  // Preflight the complete destination before the first write. Existing edits win.
  const occupied = new Map(vault.getAllLoadedFiles().map(file => [pathKey(file.path), file.path]));
  const conflicts = new Set<string>();
  for (const path of [...folders, ...inventory.map(file => file.path)]) {
    const existingPath = occupied.get(pathKey(path));
    if (existingPath && existingPath !== path) conflicts.add(existingPath);
  }
  for (const path of folders) if (vault.getAbstractFileByPath(path) && !vault.getFolderByPath(path)) conflicts.add(path);
  for (const file of inventory) {
    checkAbort(signal);
    const existing = vault.getAbstractFileByPath(file.path);
    if (!existing) continue;
    const existingFile = vault.getFileByPath(file.path);
    if (!existingFile || await sha256(new Uint8Array(await vault.readBinary(existingFile))) !== file.sha256) conflicts.add(file.path);
  }
  if (conflicts.size) throw new BookConflictError([...conflicts]);
  for (const path of [...folders].sort((a, b) => a.split('/').length - b.split('/').length)) {
    checkAbort(signal);
    if (!vault.getFolderByPath(path)) await vault.createFolder(path);
  }
  let created = 0, reused = 0;
  // The entry note is written last, so a new component opens with its assets ready.
  const ordered = inventory.filter(file => file.path !== manifest.entrypoint);
  ordered.push(expected.get(manifest.entrypoint)!);
  for (const file of ordered) {
    checkAbort(signal);
    const existing = vault.getFileByPath(file.path);
    if (existing) {
      // A file could have changed while an earlier async write was in flight.
      if (await sha256(new Uint8Array(await vault.readBinary(existing))) !== file.sha256) throw new BookConflictError([file.path]);
      reused++;
    } else {
      await vault.createBinary(file.path, files[file.path].slice().buffer);
      created++;
    }
  }
  checkAbort(signal);
  return { manifest, entry: vault.getFileByPath(manifest.entrypoint)!, created, reused };
}
