import { FileView, TFile } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import type Engiware from './main';

export const ENGIBOOK_VIEW = 'engiware-engibook';

export class EngibookView extends FileView {
  private task: AbortController | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: Engiware) { super(leaf); }
  getViewType(): string { return ENGIBOOK_VIEW; }
  getIcon(): string { return 'package'; }
  canAcceptExtension(extension: string): boolean { return extension.toLowerCase() === 'engibook'; }

  async onLoadFile(file: TFile): Promise<void> {
    this.task?.abort();
    const task = new AbortController();
    this.task = task;
    this.contentEl.empty();
    this.contentEl.addClass('engiware-book');
    const status = this.contentEl.createDiv({ cls: 'engiware-status', text: 'Reading Engibook…', attr: { role: 'status' } });
    try {
      const { inspectBook, ASSET_DIRECTORIES, MAX_ARCHIVE_BYTES } = await import('./engibook');
      if (file.stat.size > MAX_ARCHIVE_BYTES) throw new Error('This Engibook exceeds the 128 MiB archive limit.');
      const bytes = new Uint8Array(await this.app.vault.readBinary(file));
      const { manifest, expandedBytes } = await inspectBook(bytes, task.signal);
      if (task.signal.aborted) return;
      status.remove();
      this.contentEl.createEl('h2', { text: manifest.title });
      this.contentEl.createEl('p', { text: `${manifest.files.length} files · ${(expandedBytes / 1_000_000).toFixed(2)} MB expanded · Engibook v${manifest.formatVersion}` });
      this.contentEl.createEl('p', { text: 'Extract this package to use its note, manuals, editable drawings, and optional 3D model in your vault.' });
      this.contentEl.createEl('p', { text: `Note: ${manifest.entrypoint}` });
      const list = this.contentEl.createEl('ul');
      for (const directory of ASSET_DIRECTORIES) {
        const count = manifest.files.filter(member => member.path.startsWith(`${manifest.assetRoot}/${directory}/`)).length;
        list.createEl('li', { text: `${manifest.assetRoot}/${directory}/ — ${count} ${count === 1 ? 'file' : 'files'}` });
      }
      const actions = this.contentEl.createDiv({ cls: 'engiware-book-actions' });
      if (this.app.vault.getFileByPath(manifest.entrypoint)) {
        const open = actions.createEl('button', { cls: 'mod-cta', text: 'Open component', attr: { type: 'button' } });
        open.addEventListener('click', () => {
          const entry = this.app.vault.getFileByPath(manifest.entrypoint);
          if (entry) void this.leaf.openFile(entry);
        });
      }
      const extract = actions.createEl('button', { text: 'Extract and open', attr: { type: 'button' } });
      const result = this.contentEl.createDiv({ cls: 'engiware-status', attr: { role: 'status', 'aria-live': 'polite' } });
      const extractPackage = async () => {
        extract.disabled = true;
        result.setText('Extracting component files…');
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

  async onUnloadFile(): Promise<void> {
    this.task?.abort();
    this.task = null;
    this.contentEl.empty();
  }

  onunload(): void { this.task?.abort(); }
}
