interface GraphicsOptions {
  host: HTMLElement;
  signal: AbortSignal;
  maxDimension: number;
  confirmCompatibility(): Promise<boolean>;
}

export async function requestGraphicsContext(options: GraphicsOptions) {
  const { host, signal, maxDimension } = options;
  const cancelled = () => new DOMException('3D view cancelled.', 'AbortError');
  if (signal.aborted) throw cancelled();

  const attempt = (compatibilityMode: boolean) => {
    const canvas = host.createEl('canvas', { cls: 'engiware-canvas is-loading' });
    try {
      // The strict attempt is a capability check, not a permanent performance gate.
      const context = canvas.getContext('webgl2', {
        alpha: true,
        antialias: !compatibilityMode && maxDimension > 640,
        stencil: true,
        powerPreference: 'low-power',
        failIfMajorPerformanceCaveat: !compatibilityMode,
      });
      if (context) return { canvas, context, compatibilityMode };
      canvas.remove();
      return null;
    } catch (error) {
      canvas.remove();
      throw error;
    }
  };

  const standard = attempt(false);
  if (standard) return standard;
  // No canvas or model is kept while the user decides whether to retry.
  const confirmed = await options.confirmCompatibility();
  if (signal.aborted || !confirmed) throw cancelled();
  const compatible = attempt(true);
  if (compatible) return compatible;
  throw new Error('Obsidian could not create a WebGL 2 context, even in reduced-quality mode.');
}
