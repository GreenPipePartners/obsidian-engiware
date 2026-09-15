import { unzip } from 'fflate';
import type { UnzipFileInfo, Unzipped } from 'fflate';
import type { App, TFile, Vault } from 'obsidian';
import { DEFAULT_DEPLOYMENT_DIRECTORY, deployedPath, normalizeDeploymentDirectory, rebaseComponentText } from './deployment.ts';

export const ASSET_DIRECTORIES = ['schematic', 'manuals', '2d_scaled_component', '3d_rendered'] as const;
export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 512;
const MANIFEST = 'engibook.json';
const PENDING = 'engibook-import.json';
const MAX_MANIFEST_BYTES = 64 * 1024;

export interface BookFile {
  path: string;
  bytes: number;
  sha256: string;
}

interface ManifestBase {
  format: 'engibook';
  id: string;
  title: string;
  entrypoint: string;
  assetRoot: string;
  files: BookFile[];
}

export interface LegacyBookManifest extends ManifestBase { formatVersion: 1; }
export interface VersionedBookManifest extends ManifestBase {
  formatVersion: 2;
  providerCode: string;
  partNumber: string;
  engibookVersion: string;
}
export type BookManifest = LegacyBookManifest | VersionedBookManifest;

export interface BookInspection {
  manifest: BookManifest;
  manifestBytes: Uint8Array;
  expandedBytes: number;
}

export interface BookImport {
  manifest: BookManifest;
  deploymentDirectory: string;
  entry: TFile;
  created: number;
  updated: number;
  reused: number;
}

export class BookConflictError extends Error {
  readonly paths: string[];
  constructor(paths: string[]) {
    super(`Conflicting files or folders: ${paths.slice(0, 4).join(', ')}${paths.length > 4 ? '…' : ''}. Import stopped.`);
    this.name = 'BookConflictError';
    this.paths = paths;
  }
}

export class BookVersionError extends Error {
  constructor(message: string) { super(message); this.name = 'BookVersionError'; }
}

function versionParts(version: unknown): { core: string[]; prerelease: string[] } {
  const match = typeof version === 'string' && version.length <= 64
    ? /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(version) : null;
  const prerelease = match?.[4]?.split('.') ?? [];
  const build = match?.[5]?.split('.') ?? [];
  if (!match || [...prerelease, ...build].some(part => !part)
    || prerelease.some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    throw new Error('Engibook content version must be a semantic version such as 1.0.0.');
  }
  return { core: match.slice(1, 4), prerelease };
}

export function compareBookVersions(left: string, right: string): number {
  const a = versionParts(left), b = versionParts(right);
  const lexical = (x: string, y: string) => x === y ? 0 : x < y ? -1 : 1;
  const numeric = (x: string, y: string) => x.length - y.length || lexical(x, y);
  for (let i = 0; i < 3; i++) {
    const order = numeric(a.core[i], b.core[i]);
    if (order) return order;
  }
  if (!a.prerelease.length || !b.prerelease.length) return Number(!a.prerelease.length) - Number(!b.prerelease.length);
  for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i], y = b.prerelease[i];
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    const order = xn && yn ? numeric(x, y) : xn !== yn ? (xn ? -1 : 1) : lexical(x, y);
    if (order) return order;
  }
  return a.prerelease.length - b.prerelease.length;
}

export function componentIdentity(providerCode: string, partNumber: string, engibookVersion: string) {
  if (!/^[A-Z0-9]{1,16}$/.test(providerCode)) throw new Error('Provider code must contain 1–16 uppercase letters or digits.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(partNumber) || partNumber.endsWith('.')) throw new Error('Part number must be a portable alphanumeric filename.');
  const id = `${providerCode}_${partNumber}`;
  if (id.length > 80) throw new Error('The provider code and part number must fit within an 80-character component ID.');
  versionParts(engibookVersion);
  return { id, providerCode, partNumber, engibookVersion };
}

export function bookFilename(manifest: BookManifest): string {
  return `${manifest.id}${manifest.formatVersion === 2 ? `_${manifest.engibookVersion}` : ''}.engibook`;
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

function readJson(bytes: Uint8Array, limit = MAX_MANIFEST_BYTES): Record<string, unknown> {
  if (bytes.byteLength > limit) throw new Error('Engibook manifest is too large.');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('The Engibook manifest is not valid UTF-8 JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Engibook manifest.');
  return value as Record<string, unknown>;
}

function parseManifest(bytes: Uint8Array, installed = false): BookManifest {
  // Installed receipts include a second, fully qualified inventory and pretty
  // JSON formatting; valid compact source manifests can expand beyond 192 KiB.
  const input = readJson(bytes, installed ? MAX_MANIFEST_BYTES * 5 : MAX_MANIFEST_BYTES);
  if (input.format !== 'engibook' || (input.formatVersion !== 1 && input.formatVersion !== 2)) throw new Error('Unsupported Engibook format version.');
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(input.id) || input.id.endsWith('.')) throw new Error('Invalid Engibook component ID.');
  let identity;
  if (input.formatVersion === 2) {
    if (typeof input.providerCode !== 'string' || typeof input.partNumber !== 'string' || typeof input.engibookVersion !== 'string') throw new Error('Engibook v2 needs providerCode, partNumber, and engibookVersion.');
    identity = componentIdentity(input.providerCode, input.partNumber, input.engibookVersion);
    if (input.id !== identity.id) throw new Error('The Engibook component ID must be providerCode_partNumber, without the content version.');
  }
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 240) throw new Error('The Engibook needs a component title.');
  if (input.entrypoint !== `${input.id}.md` || input.assetRoot !== `Assets/${input.id}`) throw new Error('Engibook paths must use the component ID and standard Assets directory.');
  const assetRoot = `Assets/${input.id}`;
  if (!Array.isArray(input.files) || !input.files.length || input.files.length >= MAX_FILES) throw new Error('Invalid Engibook file inventory.');
  const files: BookFile[] = [];
  const listed = new Set<string>();
  let expandedBytes = 0;
  for (const item of input.files) {
    if (!item || typeof item !== 'object') throw new Error('Invalid Engibook file inventory.');
    const { path, bytes: size, sha256 } = item as Record<string, unknown>;
    if (typeof path !== 'string' || !safePath(path)) throw new Error('Invalid path in Engibook inventory.');
    const allowed = path === input.entrypoint || path === `${assetRoot}/asset-provenance.json`
      || ASSET_DIRECTORIES.some(dir => path.startsWith(`${assetRoot}/${dir}/`));
    if (!allowed) throw new Error(`File is outside the Engibook layout: ${path}`);
    if (listed.has(pathKey(path))) throw new Error(`Duplicate inventory path: ${path}`);
    listed.add(pathKey(path));
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > MAX_ARCHIVE_BYTES) throw new Error(`Invalid Engibook member size: ${path}`);
    expandedBytes += size;
    if (expandedBytes > MAX_EXPANDED_BYTES) throw new Error('This Engibook exceeds the expanded size limit.');
    if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Missing SHA-256 for ${path}`);
    files.push({ path, bytes: size, sha256 });
  }
  if (!files.some(file => file.path === input.entrypoint)) throw new Error('The Engibook entry note is missing.');
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
  const common = { id: input.id, title: input.title.trim(), entrypoint: input.entrypoint, assetRoot, files };
  return identity
    ? { format: 'engibook', formatVersion: 2, ...common, ...identity }
    : { format: 'engibook', formatVersion: 1, ...common };
}

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
    if (file.name === MANIFEST && file.originalSize > MAX_MANIFEST_BYTES) throw new Error('Engibook manifest is too large.');
    members.set(file.name, file.originalSize);
    return file.name === MANIFEST;
  }, signal);
  checkAbort(signal);
  const manifestBytes = manifestFile[MANIFEST];
  if (!manifestBytes) throw new Error('The ZIP must contain engibook.json at its root.');
  const manifest = parseManifest(manifestBytes);
  for (const file of manifest.files) if (members.get(file.path) !== file.bytes) throw new Error(`Missing or wrong-sized Engibook member: ${file.path}`);
  if (members.size !== manifest.files.length + 1) throw new Error('The ZIP contains files not listed in engibook.json.');
  return { manifest, manifestBytes, expandedBytes };
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function parents(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

function sameManifest(left: BookManifest, right: BookManifest): boolean {
  const canonical = (manifest: BookManifest) => JSON.stringify({
    ...manifest, files: [...manifest.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  });
  return canonical(left) === canonical(right);
}

function pendingManifest(bytes: Uint8Array): VersionedBookManifest {
  const record = readJson(bytes, MAX_MANIFEST_BYTES + 1024);
  if (record.format !== 'engibook-import' || record.formatVersion !== 1) throw new Error('Invalid Engibook import record.');
  const manifest = parseManifest(new TextEncoder().encode(JSON.stringify(record.manifest)));
  if (manifest.formatVersion !== 2) throw new Error('Invalid versioned Engibook import record.');
  return manifest;
}

async function readRecord(vault: Vault, path: string) {
  if (!vault.getAbstractFileByPath(path)) return null;
  const file = vault.getFileByPath(path);
  if (!file) throw new BookConflictError([path]);
  const bytes = new Uint8Array(await vault.readBinary(file));
  return { file, bytes };
}

async function unchangedRecord(vault: Vault, path: string, expected: Uint8Array | undefined): Promise<void> {
  const record = await readRecord(vault, path);
  if (expected ? !record || record.bytes.length !== expected.length || !record.bytes.every((byte, index) => byte === expected[index]) : record) {
    throw new Error(`Engibook installation state changed during import: ${path}. Reopen the package and retry.`);
  }
}

export async function importBook(app: Pick<App, 'vault' | 'fileManager'>, bytes: Uint8Array, signal?: AbortSignal, deploymentDirectory = DEFAULT_DEPLOYMENT_DIRECTORY): Promise<BookImport> {
  const { vault, fileManager } = app;
  const directory = normalizeDeploymentDirectory(deploymentDirectory);
  const deploy = (path: string) => {
    const destination = deployedPath(directory, path);
    if (!safePath(destination)) throw new Error(`Invalid or overlong deployment path: ${destination}`);
    return destination;
  };
  const { manifest, manifestBytes } = await inspectBook(bytes, signal);
  const expected = new Map(manifest.files.map(file => [file.path, file]));
  const payload = await unpack(bytes, file => expected.has(file.name), signal);
  const files: Unzipped = {};
  const inventory: BookFile[] = [];
  let deployedBytes = 0;
  for (const file of manifest.files) {
    checkAbort(signal);
    if (!payload[file.path] || payload[file.path].byteLength !== file.bytes || await sha256(payload[file.path]) !== file.sha256) throw new Error(`Engibook checksum mismatch: ${file.path}`);
    const path = deploy(file.path);
    const content = rebaseComponentText(payload[file.path], file.path, manifest.assetRoot, manifest.entrypoint, directory);
    deployedBytes += content.byteLength;
    if (content.byteLength > MAX_ARCHIVE_BYTES || deployedBytes > MAX_EXPANDED_BYTES) throw new Error('This component exceeds the deployment size limit after adjusting its links.');
    files[path] = content;
    inventory.push({ path, bytes: content.byteLength, sha256: await sha256(content) });
  }
  const entryPath = deploy(manifest.entrypoint);
  const assetRoot = deploy(manifest.assetRoot);
  const receiptPath = `${assetRoot}/${MANIFEST}`;
  const pendingPath = `${assetRoot}/${PENDING}`;
  const receipt = await readRecord(vault, receiptPath);
  const pending = await readRecord(vault, pendingPath);
  const installed = receipt ? parseManifest(receipt.bytes, true) : null;
  const inProgress = pending ? pendingManifest(pending.bytes) : null;
  for (const previous of [installed, inProgress]) {
    if (previous && previous.id !== manifest.id) throw new BookConflictError([receiptPath, pendingPath]);
  }
  let replace = false;
  if (manifest.formatVersion === 2) {
    for (const previous of [installed, inProgress]) {
      if (previous?.formatVersion !== 2) continue;
      const order = compareBookVersions(manifest.engibookVersion, previous.engibookVersion);
      if (order < 0) throw new BookVersionError(`Cannot import ${manifest.engibookVersion}: ${manifest.id} already has version ${previous.engibookVersion} installed or in progress.`);
      if (order === 0 && !sameManifest(manifest, previous)) throw new BookVersionError(`Engibook version ${manifest.engibookVersion} is already used for different package contents. Publish a newer version.`);
    }
    replace = !!installed && (installed.formatVersion === 1 || compareBookVersions(manifest.engibookVersion, installed.engibookVersion) > 0);
    if (inProgress && !installed) replace = true;
  } else if (installed?.formatVersion === 2 || inProgress) {
    throw new BookVersionError('A versioned Engibook is already installed or in progress at this component location. Use a newer versioned package.');
  }
  const receiptBytes = directory
    ? new TextEncoder().encode(JSON.stringify({ ...manifest, deploymentDirectory: directory, deployedFiles: inventory }, null, 2) + '\n')
    : manifestBytes;
  files[receiptPath] = receiptBytes.slice();
  inventory.push({ path: receiptPath, bytes: receiptBytes.byteLength, sha256: await sha256(receiptBytes) });
  const folders = new Set(ASSET_DIRECTORIES.map(dir => `${assetRoot}/${dir}`));
  for (const file of inventory) parents(file.path).forEach(parent => folders.add(parent));

  // Inspect only the immediate children of package destination parents. This
  // catches case aliases without traversing unrelated folders elsewhere in the vault.
  const destinations = new Map<string, Map<string, string>>();
  for (const path of [...folders, ...inventory.map(file => file.path), pendingPath]) {
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    let siblings = destinations.get(parentPath);
    if (!siblings) destinations.set(parentPath, siblings = new Map<string, string>());
    siblings.set(pathKey(path), path);
  }
  const conflicts = new Set<string>();
  for (const [parentPath, siblings] of destinations) {
    checkAbort(signal);
    const parent = parentPath ? vault.getFolderByPath(parentPath) : vault.getRoot();
    for (const child of parent?.children ?? []) {
      const destination = siblings.get(pathKey(child.path));
      if (destination && child.path !== destination) conflicts.add(child.path);
    }
  }
  // A strictly newer package owns its listed destinations, including local edits.
  // First imports and same-version reimports still require matching existing bytes.
  const canReplace = (path: string) => replace || (manifest.formatVersion === 2 && path === receiptPath && !!installed && sameManifest(manifest, installed));
  let changes = 0;
  for (const path of folders) if (vault.getAbstractFileByPath(path) && !vault.getFolderByPath(path)) conflicts.add(path);
  for (const file of inventory) {
    checkAbort(signal);
    const existing = vault.getAbstractFileByPath(file.path);
    if (!existing) { changes++; continue; }
    const existingFile = vault.getFileByPath(file.path);
    if (!existingFile) conflicts.add(file.path);
    else if (await sha256(new Uint8Array(await vault.readBinary(existingFile))) !== file.sha256) {
      changes++;
      if (!canReplace(file.path)) conflicts.add(file.path);
    }
  }
  if (conflicts.size) throw new BookConflictError([...conflicts]);
  checkAbort(signal);
  if (!changes && [...folders].every(path => vault.getFolderByPath(path))) {
    if (pending) {
      await unchangedRecord(vault, receiptPath, receipt?.bytes);
      await unchangedRecord(vault, pendingPath, pending.bytes);
      checkAbort(signal);
      await fileManager.trashFile(pending.file);
    }
    return { manifest, deploymentDirectory: directory, entry: vault.getFileByPath(entryPath)!, created: 0, updated: 0, reused: inventory.length };
  }
  for (const path of [...folders].sort((a, b) => a.split('/').length - b.split('/').length)) {
    checkAbort(signal);
    if (!vault.getFolderByPath(path)) await vault.createFolder(path);
  }
  let pendingBytes: Uint8Array | undefined;
  if (manifest.formatVersion === 2) {
    pendingBytes = new TextEncoder().encode(JSON.stringify({ format: 'engibook-import', formatVersion: 1, manifest }) + '\n');
    await unchangedRecord(vault, receiptPath, receipt?.bytes);
    await unchangedRecord(vault, pendingPath, pending?.bytes);
    checkAbort(signal);
    if (pending) await vault.modifyBinary(pending.file, pendingBytes.slice().buffer);
    else await vault.createBinary(pendingPath, pendingBytes.slice().buffer);
  }
  let created = 0, updated = 0, reused = 0;
  // Assets, then the note, then the installed-version receipt. The pending record
  // permits resuming an interrupted replacement and blocks intervening downgrades.
  const ordered = inventory.filter(file => file.path !== entryPath && file.path !== receiptPath);
  ordered.push(inventory.find(file => file.path === entryPath)!, inventory[inventory.length - 1]);
  for (const file of ordered) {
    checkAbort(signal);
    if (pendingBytes) {
      await unchangedRecord(vault, pendingPath, pendingBytes);
      await unchangedRecord(vault, receiptPath, receipt?.bytes);
      checkAbort(signal);
    }
    const existing = vault.getFileByPath(file.path);
    if (existing) {
      if (await sha256(new Uint8Array(await vault.readBinary(existing))) === file.sha256) reused++;
      else {
        if (!canReplace(file.path)) throw new BookConflictError([file.path]);
        checkAbort(signal);
        await vault.modifyBinary(existing, files[file.path].slice().buffer);
        updated++;
      }
    } else {
      if (vault.getAbstractFileByPath(file.path)) throw new BookConflictError([file.path]);
      checkAbort(signal);
      await vault.createBinary(file.path, files[file.path].slice().buffer);
      created++;
    }
  }
  checkAbort(signal);
  if (pendingBytes) {
    await unchangedRecord(vault, pendingPath, pendingBytes);
    checkAbort(signal);
    const record = vault.getFileByPath(pendingPath);
    if (record) await fileManager.trashFile(record);
  }
  return { manifest, deploymentDirectory: directory, entry: vault.getFileByPath(entryPath)!, created, updated, reused };
}
