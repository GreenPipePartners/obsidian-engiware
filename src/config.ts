export interface ComponentPreview {
  model: string;
  image: string;
  title: string;
  height: number;
}

export interface EngiwareSettings {
  imageOnly: boolean;
  maxDimension: number;
  maxFps: number;
}

export const DEFAULT_SETTINGS: EngiwareSettings = {
  imageOnly: false,
  maxDimension: 960,
  maxFps: 20,
};

function path(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Add a vault-relative ${name} path.`);
  return value.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '');
}

export function componentPreview(value: unknown): ComponentPreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Use an Engiware YAML block with image and model paths.');
  const input = value as Record<string, unknown>;
  const model = path(input.model, 'model');
  const image = path(input.image, 'image');
  if (!model.toLowerCase().endsWith('.glb')) throw new Error('The model must be a self-contained .glb file.');
  return {
    model,
    image,
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : model.split('/').pop()!.replace(/\.glb$/i, ''),
    height: typeof input.height === 'number' && Number.isFinite(input.height) ? Math.min(800, Math.max(180, input.height)) : 420,
  };
}

export function settings(value: unknown): EngiwareSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    imageOnly: input.imageOnly === true,
    maxDimension: [640, 960, 1280].includes(Number(input.maxDimension)) ? Number(input.maxDimension) : DEFAULT_SETTINGS.maxDimension,
    maxFps: typeof input.maxFps === 'number' && Number.isFinite(input.maxFps) ? Math.round(Math.min(30, Math.max(10, input.maxFps))) : DEFAULT_SETTINGS.maxFps,
  };
}
