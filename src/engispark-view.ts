import { FileView, MarkdownRenderChild, Notice } from 'obsidian';
import type { TFile, WorkspaceLeaf } from 'obsidian';
import type Engiware from './main';
import { inspectSpark, MAX_SPARK_BYTES } from './engispark.ts';
import type { SparkPackage } from './engispark.ts';
import { PerspectiveRuntime } from './perspective-runtime.ts';
import { renderPerspective } from './perspective-renderer.ts';
import { sha256 } from './engibook.ts';
import { deployedPath } from './deployment.ts';

export const ENGISPARK_VIEW = 'engiware-engispark';

export class SparkCard extends MarkdownRenderChild {
  private task: AbortController | null = null;
  private runtime: PerspectiveRuntime | null = null;
  private releaseRenderer: (() => void) | null = null;
  private target: TFile | null = null;

  constructor(private plugin: Engiware, element: HTMLElement, private path: string, private sourcePath: string, private autoStart = false) {
    super(element);
  }

  onload(): void {
    this.plugin.sparkCards.add(this);
    this.registerEvent(this.plugin.app.vault.on('modify', file => {
      if (file.path === this.target?.path) void this.readPackage();
    }));
    void this.readPackage();
  }

  private release(): void {
    this.releaseRenderer?.();
    this.releaseRenderer = null;
    this.runtime?.dispose();
    this.runtime = null;
  }

  private async readPackage(): Promise<void> {
    this.task?.abort();
    this.release();
    const task = new AbortController();
    this.task = task;
    const host = this.containerEl;
    host.empty();
    host.addClass('engiware-spark');
    const status = host.createDiv({ cls: 'engiware-status', text: 'Reading Engispark…', attr: { role: 'status', 'aria-live': 'polite' } });
    try {
      const file = this.plugin.resolve(this.path, this.sourcePath);
      if (!file) throw new Error(`Engispark not found: ${this.path}`);
      if (file.stat.size > MAX_SPARK_BYTES) throw new Error('Engispark archives are limited to 16 MiB.');
      this.target = file;
      const spark = await inspectSpark(new Uint8Array(await this.plugin.app.vault.readBinary(file)), task.signal);
      if (task.signal.aborted) return;
      host.createEl('h4', { text: spark.manifest.title, cls: 'engiware-spark-title' });
      host.createDiv({ cls: 'engiware-spark-source', text: `Perspective · ${spark.manifest.ignition.viewPath}` });
      const toolbar = host.createDiv({ cls: 'engiware-toolbar' });
      const sample = toolbar.createEl('button', { text: 'Sample view', attr: { type: 'button', 'aria-expanded': 'false' } });
      const reset = toolbar.createEl('button', { text: 'Reset sample', attr: { type: 'button' } });
      reset.hidden = true;
      const extract = toolbar.createEl('button', { text: 'Extract Ignition files', attr: { type: 'button' } });
      const stage = host.createDiv({ cls: 'engiware-spark-stage' });
      stage.hidden = true;
      const tagState = host.createDiv({ cls: 'engiware-spark-tags', attr: { role: 'status', 'aria-live': 'polite' } });
      tagState.hidden = true;
      const detail = host.createEl('details', { cls: 'engiware-spark-details' });
      detail.createEl('summary', { text: 'Native view and import instructions' });
      detail.createEl('p', { text: 'The sample renders view.json directly from the enclosed Ignition project ZIP. Layout and bindings come from that native resource.' });
      const steps = detail.createEl('ol');
      steps.createEl('li', { text: 'Extract Ignition files, then import the project ZIP using the file menu in Ignition Designer.' });
      steps.createEl('li', { text: 'In the Tag Browser, import the supplied .tags.json into the [default] provider for the sample memory tag.' });
      steps.createEl('li', { text: `Open ${spark.manifest.ignition.viewPath} in Perspective preview mode. The extracted README describes its parameters and controls.` });
      detail.createEl('code', { text: `Native view SHA-256: ${spark.viewSha256}` });
      host.append(status);
      status.setText('Ready · local tag sample.');

      const start = () => {
        if (this.runtime) {
          this.release();
          stage.hidden = true;
          tagState.hidden = true;
          reset.hidden = true;
          sample.setText('Sample view');
          sample.setAttribute('aria-expanded', 'false');
          status.setText('Sample closed. Reopening starts from the packaged tag values.');
          return;
        }
        try {
          const runtime = new PerspectiveRuntime(spark.view, spark.manifest.simulation.tags);
          this.runtime = runtime;
          this.releaseRenderer = renderPerspective(stage, runtime, error => status.setText(message(error)));
          const showTags = () => {
            tagState.empty();
            for (const tag of runtime.tags.readBlocking(spark.manifest.simulation.tags.map(item => item.path))) {
              tagState.createEl('code', { text: `${tag.tagPath} = ${String(tag.value)} · ${tag.quality}` });
            }
          };
          runtime.subscribe(showTags);
          showTags();
          stage.hidden = false;
          tagState.hidden = false;
          reset.hidden = false;
          sample.setText('Close sample');
          sample.setAttribute('aria-expanded', 'true');
          status.setText('Local sample active. Use the native view’s controls; tag values belong to this sample.');
        } catch (error) { this.release(); status.setText(message(error)); }
      };
      sample.addEventListener('click', start, { signal: task.signal });
      reset.addEventListener('click', () => this.runtime?.reset(), { signal: task.signal });
      extract.addEventListener('click', () => {
        extract.disabled = true;
        void this.extract(spark, task.signal).then(folder => {
          if (task.signal.aborted) return;
          status.setText(`Ignition files: ${folder}`);
          new Notice(`Engiware: Ignition files extracted to ${folder}`);
        }).catch((error: unknown) => {
          if (!task.signal.aborted) status.setText(message(error));
        }).finally(() => { extract.disabled = false; });
      }, { signal: task.signal });
      if (this.autoStart) start();
    } catch (error) {
      if (!task.signal.aborted) status.setText(`Engiware: ${message(error)}`);
    }
  }

  private async extract(spark: SparkPackage, signal: AbortSignal): Promise<string> {
    const { vault } = this.plugin.app;
    const directory = deployedPath(this.plugin.settings.deploymentDirectory, `Exports/${spark.manifest.id}_${spark.manifest.version}`);
    const members = [spark.manifest.ignition.project, spark.manifest.ignition.tags, 'README.md'].filter(path => spark.files[path]);
    const destinations = members.map(path => ({ path: `${directory}/${path.split('/').pop()!}`, bytes: spark.files[path] }));
    const folders = directory.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'));
    const check = () => { if (signal.aborted) throw new DOMException('Engispark closed.', 'AbortError'); };
    // Preflight all destinations before exporting; an existing different file is never replaced.
    for (const path of folders) {
      if (vault.getAbstractFileByPath(path) && !vault.getFolderByPath(path)) throw new Error(`Export folder conflicts with a file: ${path}`);
    }
    for (const destination of destinations) {
      const existing = vault.getAbstractFileByPath(destination.path);
      if (!existing) continue;
      const file = vault.getFileByPath(destination.path);
      if (!file || await sha256(new Uint8Array(await vault.readBinary(file))) !== await sha256(destination.bytes)) {
        throw new Error(`Export already exists with different contents: ${destination.path}`);
      }
    }
    for (const path of folders) { check(); if (!vault.getFolderByPath(path)) await vault.createFolder(path); }
    for (const destination of destinations) {
      check();
      if (!vault.getFileByPath(destination.path)) await vault.createBinary(destination.path, destination.bytes.slice().buffer);
    }
    return directory;
  }

  onunload(): void { this.plugin.sparkCards.delete(this); this.task?.abort(); this.release(); this.containerEl.empty(); }
}

export class EngisparkView extends FileView {
  private card: SparkCard | null = null;
  constructor(leaf: WorkspaceLeaf, private plugin: Engiware) { super(leaf); }
  getViewType(): string { return ENGISPARK_VIEW; }
  getIcon(): string { return 'toggle-right'; }
  canAcceptExtension(extension: string): boolean { return extension.toLowerCase() === 'engispark'; }
  async onLoadFile(file: TFile): Promise<void> {
    this.closeCard();
    this.contentEl.addClass('engiware-spark-file');
    this.card = new SparkCard(this.plugin, this.contentEl.createDiv(), file.path, file.path, true);
    this.addChild(this.card);
  }
  private closeCard(): void { if (this.card) this.removeChild(this.card); this.card = null; this.contentEl.empty(); }
  async onUnloadFile(): Promise<void> { this.closeCard(); }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
