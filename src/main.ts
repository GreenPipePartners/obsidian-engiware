import { MarkdownRenderChild, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath, parseYaml, setIcon } from 'obsidian';
import type { SettingDefinitionRender } from 'obsidian';
import { componentPreview, DEFAULT_SETTINGS, settings as normalizedSettings } from './config';
import type { ComponentPreview, EngiwareSettings } from './config';
import type { ViewerHandle, ViewerMetrics } from './viewer';
import { EngibookView, ENGIBOOK_VIEW } from './engibook-view';
import type { BookImport } from './engibook';
import { normalizeDeploymentDirectory } from './deployment.ts';
import { EngisparkView, ENGISPARK_VIEW, SparkCard } from './engispark-view';
import { sparkBlock } from './engispark';

export default class Engiware extends Plugin {
  settings: EngiwareSettings = { ...DEFAULT_SETTINGS };
  readonly metrics: ViewerMetrics = { opens: 0, modelReads: 0, contextsCreated: 0, activeViewers: 0, frames: 0 };
  readonly sparkCards = new Set<SparkCard>();
  private currentModal: PreviewModal | null = null;
  private imports = new Set<AbortController>();
  private importQueue: Promise<unknown> = Promise.resolve();
  private filePicker: HTMLInputElement | null = null;

  async onload(): Promise<void> {
    this.settings = normalizedSettings(await this.loadData());
    this.addSettingTab(new EngiwareSettingsTab(this));
    this.registerView(ENGIBOOK_VIEW, leaf => new EngibookView(leaf, this));
    this.registerExtensions(['engibook'], ENGIBOOK_VIEW);
    this.registerView(ENGISPARK_VIEW, leaf => new EngisparkView(leaf, this));
    this.registerExtensions(['engispark'], ENGISPARK_VIEW);
    this.registerMarkdownCodeBlockProcessor('engispark', (source, element, context) => {
      try {
        context.addChild(new SparkCard(this, element, sparkBlock(parseYaml(source)), context.sourcePath));
      } catch (error) {
        element.createDiv({ cls: 'engiware-config-error', text: `Engiware: ${message(error)}` });
      }
    });
    this.addCommand({ id: 'import-engibook', name: 'Import .engibook', callback: () => this.chooseEngibook() });
    this.registerMarkdownCodeBlockProcessor('engiware', (source, element, context) => {
      try {
        const preview = componentPreview(parseYaml(source));
        context.addChild(new PreviewCard(this, element, preview, context.sourcePath));
      } catch (error) {
        element.createDiv({ cls: 'engiware-config-error', text: `Engiware: ${message(error)}` });
      }
    });
  }

  onunload(): void {
    this.sparkCards.forEach(card => card.unload());
    this.currentModal?.close();
    this.imports.forEach(task => task.abort());
    this.filePicker?.remove();
  }

  async importEngibook(bytes: Uint8Array, signal?: AbortSignal): Promise<BookImport> {
    const directory = this.settings.deploymentDirectory;
    const task = new AbortController();
    const abort = () => task.abort();
    if (signal?.aborted) task.abort();
    signal?.addEventListener('abort', abort, { once: true });
    this.imports.add(task);
    const operation = this.importQueue.then(async () => {
      const { importBook } = await import('./engibook');
      return importBook(this.app, bytes, task.signal, directory);
    });
    this.importQueue = operation.catch(() => undefined);
    try { return await operation; }
    finally {
      signal?.removeEventListener('abort', abort);
      this.imports.delete(task);
    }
  }

  private chooseEngibook(): void {
    this.filePicker?.remove();
    const input = activeDocument.body.createEl('input', { cls: 'engiware-import-file', attr: { type: 'file', accept: '.engibook,.zip', hidden: '' } });
    this.filePicker = input;
    const cleanup = () => {
      input.remove();
      if (this.filePicker === input) this.filePicker = null;
    };
    input.addEventListener('cancel', cleanup, { once: true });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      cleanup();
      if (file) void this.importPickedFile(file);
    }, { once: true });
    input.click();
  }

  private async importPickedFile(file: File): Promise<void> {
    const task = new AbortController();
    this.imports.add(task);
    try {
      const { MAX_ARCHIVE_BYTES, ARCHIVE_LIMIT_MESSAGE } = await import('./engibook');
      if (file.size > MAX_ARCHIVE_BYTES) throw new Error(ARCHIVE_LIMIT_MESSAGE);
      const imported = await this.importEngibook(new Uint8Array(await file.arrayBuffer()), task.signal);
      if (!task.signal.aborted) {
        new Notice(`Engiware: ${imported.updated ? 'Updated' : imported.created ? 'Imported' : 'Opened'} ${imported.manifest.title}`);
        await this.app.workspace.getLeaf(false).openFile(imported.entry);
      }
    } catch (error) {
      if (!task.signal.aborted) new Notice(`Engiware: ${message(error)}`);
    } finally { this.imports.delete(task); }
  }

  resolve(path: string, sourcePath: string): TFile | null {
    const normalized = normalizePath(path);
    return this.app.vault.getFileByPath(normalized) ?? this.app.metadataCache.getFirstLinkpathDest(normalized, sourcePath);
  }

  imageUrl(preview: ComponentPreview, sourcePath: string): string | undefined {
    const file = this.resolve(preview.image, sourcePath);
    return file ? this.app.vault.getResourcePath(file) : undefined;
  }

  openPreview(preview: ComponentPreview, sourcePath: string): PreviewModal {
    this.currentModal?.close();
    const modal = new PreviewModal(this, preview, sourcePath);
    this.currentModal = modal;
    this.metrics.opens++;
    modal.open();
    return modal;
  }

  closed(modal: PreviewModal): void {
    if (this.currentModal === modal) this.currentModal = null;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  refreshDeployments(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(ENGIBOOK_VIEW)) {
      if (leaf.view instanceof EngibookView) leaf.view.refreshDeployment();
    }
  }
}

class PreviewCard extends MarkdownRenderChild {
  constructor(private plugin: Engiware, element: HTMLElement, private preview: ComponentPreview, private sourcePath: string) {
    super(element);
  }

  onload(): void {
    const button = this.containerEl.createEl('button', {
      cls: 'engiware-preview',
      attr: { type: 'button', 'aria-label': `Expand ${this.preview.title}` },
    });
    button.setCssProps({ '--engiware-preview-height': `${this.preview.height}px` });
    const url = this.plugin.imageUrl(this.preview, this.sourcePath);
    if (url) {
      button.createEl('img', { attr: { src: url, alt: this.preview.title, loading: 'lazy', decoding: 'async' } });
    } else {
      button.createSpan({ cls: 'engiware-missing-image', text: `Image not found: ${this.preview.image}` });
    }
    const caption = button.createSpan({ cls: 'engiware-expand-caption' });
    setIcon(caption.createSpan(), 'maximize-2');
    caption.createSpan({ text: 'Expand' });
    this.registerDomEvent(button, 'click', () => {
      this.plugin.openPreview(this.preview, this.sourcePath);
    });
  }

  onunload(): void {
    // Live Preview recycles a card when editor focus moves into the modal.
    // The plugin owns that explicit modal until it is closed or unloaded.
    this.containerEl.empty();
  }
}

class PreviewModal extends Modal {
  private request: AbortController | null = null;
  private viewer: ViewerHandle | null = null;
  private poster!: HTMLImageElement;
  private stage!: HTMLDivElement;
  private renderHost!: HTMLDivElement;
  private status!: HTMLDivElement;
  private imageButton!: HTMLButtonElement;
  private modelButton!: HTMLButtonElement;
  private resetButton!: HTMLButtonElement;
  private terminationButton!: HTMLButtonElement;
  private terminationsVisible = false;
  private compatibilityPrompt!: HTMLDivElement;
  private keepImageButton!: HTMLButtonElement;
  private pendingConfirmation: ((confirmed: boolean) => void) | null = null;
  private opened = false;

  constructor(private plugin: Engiware, private preview: ComponentPreview, private sourcePath: string) {
    super(plugin.app);
  }

  onOpen(): void {
    this.opened = true;
    this.modalEl.addClass('engiware-modal');
    this.setTitle(this.preview.title);
    const toolbar = this.contentEl.createDiv({ cls: 'engiware-toolbar' });
    this.imageButton = toolbar.createEl('button', { text: 'Image', attr: { type: 'button' } });
    this.modelButton = toolbar.createEl('button', { text: '3D view', attr: { type: 'button' } });
    this.resetButton = toolbar.createEl('button', { text: 'Reset view', attr: { type: 'button' } });
    this.terminationButton = toolbar.createEl('button', { text: 'Show terminations', attr: { type: 'button', 'aria-pressed': 'false' } });
    this.terminationButton.hidden = true;
    this.terminationButton.addEventListener('click', () => {
      if (!this.viewer?.terminationCount) return;
      this.terminationsVisible = !this.terminationsVisible;
      this.viewer.setTerminationsVisible(this.terminationsVisible);
      this.terminationButton.setAttribute('aria-pressed', String(this.terminationsVisible));
      this.terminationButton.setText(this.terminationsVisible ? 'Hide terminations' : 'Show terminations');
    });
    this.imageButton.addEventListener('click', () => this.showImage('Image preview.'));
    this.modelButton.addEventListener('click', () => { void this.show3D(); });
    this.resetButton.addEventListener('click', () => this.viewer?.reset());
    this.compatibilityPrompt = this.contentEl.createDiv({
      cls: 'engiware-compatibility-prompt',
      attr: { role: 'group', 'aria-label': 'Try 3D anyway?', 'aria-describedby': 'engiware-compatibility-message' },
    });
    this.compatibilityPrompt.createEl('strong', { text: 'Try 3D anyway?' });
    this.compatibilityPrompt.createEl('p', {
      text: 'The standard graphics attempt failed. This computer may not be equipped for interactive 3D. You can try reduced-quality rendering, which may be slow or unresponsive. Use Image or Esc to stop 3D.',
      attr: { id: 'engiware-compatibility-message' },
    });
    const choices = this.compatibilityPrompt.createDiv({ cls: 'engiware-toolbar' });
    this.keepImageButton = choices.createEl('button', { text: 'Keep Image', attr: { type: 'button' } });
    this.keepImageButton.addEventListener('click', () => {
      this.showImage('Image preview. Select 3D view to load the optional model.');
      this.modelButton.focus();
    });
    choices.createEl('button', { text: 'Try 3D anyway', attr: { type: 'button' } }).addEventListener('click', () => {
      if (!this.pendingConfirmation) return;
      this.finishConfirmation(true);
      this.renderHost.hidden = false;
      this.status.setText('Loading reduced-quality 3D view…');
      this.imageButton.focus();
    });
    this.stage = this.contentEl.createDiv({ cls: 'engiware-stage' });
    this.poster = this.stage.createEl('img', { cls: 'engiware-poster', attr: { alt: this.preview.title } });
    const url = this.plugin.imageUrl(this.preview, this.sourcePath);
    if (url) this.poster.src = url;
    else this.poster.alt = `Image not found: ${this.preview.image}`;
    this.renderHost = this.stage.createDiv({ cls: 'engiware-render-host' });
    this.status = this.contentEl.createDiv({ cls: 'engiware-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.showImage(this.plugin.settings.imageOnly ? 'Image-only mode. No 3D renderer is loaded.' : 'Image preview.');
    if (this.plugin.settings.imageOnly) this.modelButton.hidden = true;
    else void this.show3D();
  }

  private releaseViewer(): void {
    this.request?.abort();
    this.request = null;
    this.finishConfirmation(false);
    this.viewer?.dispose();
    this.viewer = null;
    this.terminationsVisible = false;
    if (this.terminationButton) {
      this.terminationButton.hidden = true;
      this.terminationButton.setAttribute('aria-pressed', 'false');
      this.terminationButton.setText('Show terminations');
    }
    this.renderHost?.empty();
  }

  private showImage(status: string): void {
    this.releaseViewer();
    this.poster.hidden = false;
    this.renderHost.hidden = true;
    this.imageButton.setAttribute('aria-pressed', 'true');
    this.modelButton.setAttribute('aria-pressed', 'false');
    this.modelButton.disabled = false;
    this.resetButton.disabled = true;
    this.status.setText(status);
  }

  private finishConfirmation(confirmed: boolean): void {
    const resolve = this.pendingConfirmation;
    this.pendingConfirmation = null;
    if (this.compatibilityPrompt) this.compatibilityPrompt.hidden = true;
    resolve?.(confirmed);
  }

  private confirmCompatibility(request: AbortController): Promise<boolean> {
    if (!this.opened || request.signal.aborted || this.request !== request) return Promise.resolve(false);
    return new Promise(resolve => {
      this.pendingConfirmation = resolve;
      this.renderHost.hidden = true;
      this.compatibilityPrompt.hidden = false;
      this.status.setText('Waiting for your choice. The 3D model has not been loaded.');
      this.keepImageButton.focus();
    });
  }

  private async show3D(): Promise<void> {
    if (!this.opened || this.plugin.settings.imageOnly) return;
    this.releaseViewer();
    const request = new AbortController();
    this.request = request;
    const current = () => this.opened && !request.signal.aborted && this.request === request;
    this.modelButton.disabled = true;
    this.resetButton.disabled = true;
    this.poster.hidden = false;
    this.renderHost.hidden = false;
    this.status.setText('Loading optional 3D view…');
    try {
      const file = this.plugin.resolve(this.preview.model, this.sourcePath);
      if (!(file instanceof TFile)) throw new Error(`Model not found: ${this.preview.model}`);
      // esbuild keeps this module's initialization behind the expansion or 3D action.
      const { createViewer } = await import('./viewer');
      if (!current()) return;
      const viewer = await createViewer({
        host: this.renderHost,
        signal: request.signal,
        settings: { ...this.plugin.settings },
        metrics: this.plugin.metrics,
        confirmCompatibility: () => this.confirmCompatibility(request),
        readModel: () => {
          this.plugin.metrics.modelReads++;
          return this.app.vault.readBinary(file);
        },
        onReady: compatibilityMode => {
          if (!current()) return;
          this.poster.hidden = true;
          this.modelButton.disabled = false;
          this.resetButton.disabled = false;
          this.modelButton.setAttribute('aria-pressed', 'true');
          this.imageButton.setAttribute('aria-pressed', 'false');
          this.status.setText(`${compatibilityMode ? 'Reduced-quality 3D. ' : ''}Drag to orbit · scroll or pinch to zoom · right-drag to pan. Use Image or Esc to release 3D.`);
        },
        onSlowRender: () => {
          if (current()) this.status.setText('3D is rendering slowly. Reduced quality is in use. You can keep using 3D, or choose Image or Esc to release it.');
        },
        onFallback: reason => {
          if (current()) this.showImage(`${reason} Image preview is still available.`);
        },
      });
      if (!current()) viewer.dispose();
      else {
        this.viewer = viewer;
        this.terminationButton.hidden = viewer.terminationCount === 0;
      }
    } catch (error) {
      if (current()) this.showImage(`${message(error)} Image preview is still available.`);
    }
  }

  onClose(): void {
    this.opened = false;
    this.releaseViewer();
    this.contentEl.empty();
    this.plugin.closed(this);
  }
}

class EngiwareSettingsTab extends PluginSettingTab {
  constructor(private plugin: Engiware) { super(plugin.app, plugin); }

  // Obsidian 1.13+ renders and indexes these definitions. The render callbacks
  // also serve the legacy display() below and preserve numeric dropdown values.
  getSettingDefinitions() {
    return [
      {
        name: 'Deployment directory',
        desc: 'Vault-relative folder for extracted components. Leave empty for the vault root. Applies to future imports.',
        aliases: ['engilib', 'library', 'import', 'extraction', 'folder'],
        render: setting => {
          setting.addText(text => text.setPlaceholder('EngiLib').setValue(this.plugin.settings.deploymentDirectory).onChange(async value => {
            try {
              const directory = normalizeDeploymentDirectory(value);
              text.inputEl.setCustomValidity('');
              setting.setDesc('Vault-relative folder for extracted components. Leave empty for the vault root. Applies to future imports.');
              this.plugin.settings.deploymentDirectory = directory;
              await this.plugin.saveSettings();
              this.plugin.refreshDeployments();
            } catch (error) {
              text.inputEl.setCustomValidity(message(error));
              setting.setDesc(message(error));
            }
          }));
        },
      },
      {
        name: 'Image-only mode',
        desc: 'Expand images without creating a 3D renderer. Useful for low-powered devices or when WebGL is unavailable.',
        aliases: ['graphics', 'WebGL', 'fallback'],
        render: setting => {
          setting.addToggle(toggle => toggle.setValue(this.plugin.settings.imageOnly).onChange(async value => {
            this.plugin.settings.imageOnly = value;
            await this.plugin.saveSettings();
          }));
        },
      },
      {
        name: '3D render size',
        desc: 'Caps the longest rendered edge. Lower sizes reduce graphics work; the original model scale is preserved.',
        aliases: ['resolution', 'graphics', 'performance'],
        render: setting => {
          setting.addDropdown(dropdown => dropdown.addOptions({ '640': 'Low — 640 px', '960': 'Balanced — 960 px', '1280': 'High — 1280 px' })
            .setValue(String(this.plugin.settings.maxDimension)).onChange(async value => {
              this.plugin.settings.maxDimension = Number(value);
              await this.plugin.saveSettings();
            }));
        },
      },
      {
        name: 'Interaction frame limit',
        desc: 'Frames are drawn only when needed. Idle views draw no frames.',
        aliases: ['fps', 'frame rate', 'performance'],
        render: setting => {
          setting.addSlider(slider => slider.setLimits(10, 30, 5).setValue(this.plugin.settings.maxFps).onChange(async value => {
            this.plugin.settings.maxFps = value;
            await this.plugin.saveSettings();
          }));
        },
      },
    ] satisfies SettingDefinitionRender[];
  }

  // Obsidian before 1.13 calls display(); both paths use the same definitions.
  display(): void {
    this.containerEl.empty();
    this.getSettingDefinitions().forEach(definition => {
      const setting = new Setting(this.containerEl).setName(definition.name);
      if (definition.desc) setting.setDesc(definition.desc);
      definition.render(setting);
    });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
