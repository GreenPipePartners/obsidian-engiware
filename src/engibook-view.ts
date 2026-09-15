import { FileView, TFile } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import type Engiware from './main';
import type { BookManifest } from './engibook';
import { ASSET_DIRECTORIES } from './engibook';
import { deployedPath } from './deployment.ts';

export const ENGIBOOK_VIEW = 'engiware-engibook';

export class EngibookView extends FileView {
  private task: AbortController | null = null;
  private manifest: BookManifest | null = null;
  private destinationEl: HTMLParagraphElement | null = null;
  private assetList: HTMLUListElement | null = null;
  private openButton: HTMLButtonElement | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: Engiware) { super(leaf); }
  getViewType(): string { return ENGIBOOK_VIEW; }
  getIcon(): string { return 'package'; }
  canAcceptExtension(extension: string): boolean { return extension.toLowerCase() === 'engibook'; }

  async onLoadFile(file: TFile): Promise<void> {
    this.manifest = null;
    this.task?.abort();
    const task = new AbortController();
    this.task = task;
    this.contentEl.empty();
    this.contentEl.addClass('engiware-book');
    const status = this.contentEl.createDiv({ cls: 'engiware-status', text: 'Reading Engibook…', attr: { role: 'status' } });
    try {
      const { inspectBook, bookFilename, MAX_ARCHIVE_BYTES } = await import('./engibook');
      if (file.stat.size > MAX_ARCHIVE_BYTES) throw new Error('This Engibook exceeds the 128 MiB archive limit.');
      const bytes = new Uint8Array(await this.app.vault.readBinary(file));
      const { manifest, expandedBytes } = await inspectBook(bytes, task.signal);
      if (task.signal.aborted) return;
      this.manifest = manifest;
      status.remove();
      this.contentEl.createEl('h2', { text: manifest.title });
      this.contentEl.createEl('p', { text: `${manifest.files.length} files · ${(expandedBytes / 1_000_000).toFixed(2)} MB expanded · Format ${manifest.formatVersion}${manifest.formatVersion === 2 ? ` · Content version ${manifest.engibookVersion}` : ''}` });
      this.contentEl.createEl('p', { text: `Package: ${bookFilename(manifest)}` });
      this.contentEl.createEl('p', { text: manifest.formatVersion === 2
        ? 'Deploy this component to your library. A newer content version replaces its packaged destination files, including local edits.'
        : 'Extract this package to use its note, manuals, editable drawings, and optional 3D model in your vault.' });
      this.destinationEl = this.contentEl.createEl('p');
      this.assetList = this.contentEl.createEl('ul');
      const actions = this.contentEl.createDiv({ cls: 'engiware-book-actions' });
      this.openButton = actions.createEl('button', { cls: 'mod-cta', text: 'Open component', attr: { type: 'button' } });
      this.openButton.addEventListener('click', () => {
        const entry = this.app.vault.getFileByPath(deployedPath(this.plugin.settings.deploymentDirectory, manifest.entrypoint));
        if (entry) void this.leaf.openFile(entry);
      });
      this.refreshDeployment();
      const extract = actions.createEl('button', { text: 'Deploy and open', attr: { type: 'button' } });
      const result = this.contentEl.createDiv({ cls: 'engiware-status', attr: { role: 'status', 'aria-live': 'polite' } });
      const extractPackage = async () => {
        extract.disabled = true;
        result.setText('Deploying component files…');
        try {
          const imported = await this.plugin.importEngibook(bytes, task.signal);
          if (!task.signal.aborted) await this.leaf.openFile(imported.entry);
        } catch (error) {
          if (!task.signal.aborted) result.setText(error instanceof Error ? error.message : String(error));
        } finally { extract.disabled = false; }
      };
      extract.addEventListener('click', () => { void extractPackage(); });
    } catch (error) {
      if (!task.signal.aborted) status.setText(error instanceof Error ? error.message : String(error));
    }
  }

  refreshDeployment(): void {
    if (!this.manifest || !this.destinationEl || !this.assetList || !this.openButton) return;
    const manifest = this.manifest;
    const root = this.plugin.settings.deploymentDirectory;
    const entrypoint = deployedPath(root, manifest.entrypoint);
    this.destinationEl.setText(`Deploy to: ${entrypoint}`);
    this.openButton.hidden = !this.app.vault.getFileByPath(entrypoint);
    this.assetList.empty();
    for (const directory of ASSET_DIRECTORIES) {
      const path = `${manifest.assetRoot}/${directory}/`;
      const count = manifest.files.filter(member => member.path.startsWith(path)).length;
      this.assetList.createEl('li', { text: `${deployedPath(root, path)} — ${count} ${count === 1 ? 'file' : 'files'}` });
    }
  }

  async onUnloadFile(): Promise<void> {
    this.manifest = null;
    this.task?.abort();
    this.task = null;
    this.contentEl.empty();
  }

  onunload(): void { this.task?.abort(); }
}
