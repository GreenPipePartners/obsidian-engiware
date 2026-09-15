export const DEFAULT_DEPLOYMENT_DIRECTORY = 'EngiLib';

export function normalizeDeploymentDirectory(value: string): string {
  const path = value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!path) {
    if (/[\\/]/.test(value)) throw new Error('Use an empty directory for the vault root, not an absolute path.');
    return '';
  }
  if (path.length > 120 || /[:#?|*<>"]/.test(path) || [...path].some(character => character.charCodeAt(0) < 32) || path !== path.normalize('NFC') || path.includes('\u00a0')
    || path.split('/').some(part => !part || part.startsWith('.') || /[. ]$/.test(part))) {
    throw new Error('Use a vault-relative folder such as EngiLib or Engineering/Components.');
  }
  return path;
}

export function deployedPath(directory: string, path: string): string {
  return directory ? `${directory}/${path}` : path;
}

export function rebaseComponentText(bytes: Uint8Array<ArrayBuffer>, path: string, assetRoot: string, entrypoint: string, directory: string): Uint8Array<ArrayBuffer> {
  if (!directory || !/\.(?:md|json|svg|css|txt)$/i.test(path)) return bytes;
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return bytes; }
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [source, boundary] of [[assetRoot, '(?=/)'], [entrypoint, '(?=[#|\\]\\s)"\']|$)']]) {
    // Markdown URLs encode spaces in the deployment folder. Wikilinks, YAML,
    // and text references use the readable vault path. Relative URLs stay relative.
    text = text.replace(new RegExp(`(\\]\\(\\s*<?)${escape(source)}${boundary}`, 'g'), (_, prefix: string) => `${prefix}${encodeURI(directory)}/${source}`);
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}_./%:-])${escape(source)}${boundary}`, 'gu'), () => `${directory}/${source}`);
  }
  return new TextEncoder().encode(text);
}
