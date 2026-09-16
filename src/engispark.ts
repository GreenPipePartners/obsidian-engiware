// The portable loader is shared with the standalone Engispark player.
export { inspectSpark, MAX_SPARK_BYTES } from '@greenpipepartners/engispark';
export type { SparkManifest, SparkPackage } from '@greenpipepartners/engispark';

export function sparkBlock(value: unknown): string {
  if (!value || typeof value !== 'object' || !('package' in value) || typeof value.package !== 'string'
    || !value.package.trim().toLowerCase().endsWith('.engispark')) throw new Error('Add a package: path to an .engispark file.');
  return value.package.trim();
}
