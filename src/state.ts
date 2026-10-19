import * as vscode from 'vscode';

export interface TabMark {
  flag?: string;   // emoji or short tag, e.g. "🔴", "🚩", "WIP"
  color?: string;  // hex color, e.g. "#e11d48"
  label?: string;  // friendly display name for non-file tabs (e.g. "Claude Code")
  viewType?: string; // webview viewType used to re-attach marks across panel re-opens
  tabSlot?: string; // best-effort stable slot for duplicate session tabs
  migratedFrom?: string; // previous URI key, set when a mark is auto-migrated
  ts?: number;     // epoch ms of last update
}

/** Per-workspace store of tab decorations, keyed by normalized URI string. */
export class TabState implements vscode.Disposable {
  private static readonly KEY = 'alivetabs.marks';
  private marks = new Map<string, TabMark>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChange = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly state: vscode.Memento) {
    const raw = state.get<Record<string, TabMark>>(TabState.KEY, {});
    for (const [k, v] of Object.entries(raw)) {
      if (v && (v.flag || v.color)) this.marks.set(k, v);
    }

    this.disposables.push(
      vscode.workspace.onDidRenameFiles((e) => void this.handleRenames(e.files)),
      vscode.workspace.onDidDeleteFiles((e) => void this.handleDeletes(e.files)),
    );
  }

  get(uri: vscode.Uri): TabMark | undefined {
    return this.marks.get(uri.toString());
  }

  hasKey(key: string): boolean {
    return this.marks.has(key);
  }

  /** Raw `[key, mark]` pairs — keys are already-normalized URI strings. */
  rawEntries(): [string, TabMark][] {
    return [...this.marks.entries()];
  }

  async set(uri: vscode.Uri, patch: Partial<TabMark>): Promise<void> {
    const key = uri.toString();
    const next: TabMark = { ...this.marks.get(key), ...patch, ts: Date.now() };
    if (!next.flag) delete next.flag;
    if (!next.color) delete next.color;
    if (!next.label) delete next.label;
    if (!next.viewType) delete next.viewType;
    if (!next.migratedFrom) delete next.migratedFrom;
    if (!next.flag && !next.color) this.marks.delete(key);
    else this.marks.set(key, next);
    await this.persist([uri]);
  }

  async clear(uri: vscode.Uri): Promise<void> {
    if (!this.marks.delete(uri.toString())) return;
    await this.persist([uri]);
  }

  async clearAll(): Promise<void> {
    const affected = this.entries().map(([u]) => u);
    this.marks.clear();
    await this.persist(affected.length ? affected : undefined);
  }

  /** Move a mark from a stale key to a live URI (save-as, re-opened panels). */
  async migrate(
    fromKey: string,
    to: vscode.Uri,
    patch: Partial<TabMark> = {},
  ): Promise<boolean> {
    const mark = this.marks.get(fromKey);
    if (!mark || this.marks.has(to.toString())) return false;
    this.marks.delete(fromKey);
    const next = { ...mark, ...patch, migratedFrom: fromKey };
    if (!next.tabSlot) delete next.tabSlot;
    this.marks.set(to.toString(), next);
    await this.persist([vscode.Uri.parse(fromKey), to]);
    return true;
  }

  /** Drop file marks whose target no longer exists on disk. */
  async pruneMissingFiles(): Promise<number> {
    const dead: vscode.Uri[] = [];
    for (const key of [...this.marks.keys()]) {
      const uri = vscode.Uri.parse(key);
      if (uri.scheme !== 'file') continue;
      try {
        await vscode.workspace.fs.stat(uri);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'FileNotFound' || (e instanceof Error && /ENOENT/i.test(e.message))) {
          this.marks.delete(key);
          dead.push(uri);
        }
      }
    }
    if (dead.length) await this.persist(dead);
    return dead.length;
  }

  entries(): [vscode.Uri, TabMark][] {
    return [...this.marks.entries()].map(([k, v]) => [vscode.Uri.parse(k), v]);
  }

  /** Config snapshot consumed by the deep-mode injected runtime. */
  toConfig(workspaceFolders: readonly vscode.WorkspaceFolder[]): object {
    const cfg = vscode.workspace.getConfiguration('alivetabs');
    const tabStyle = cfg.get<string>('tabStyle', 'tinted');
    const flagPosition = cfg.get<string>('flagPosition', 'suffix');
    const roots = workspaceFolders.map((f) => f.uri.fsPath);
    const rawRules = cfg.get<unknown>('rules', []);
    const rules = Array.isArray(rawRules)
      ? rawRules
          .map((r) => {
            if (!r || typeof r !== 'object') return undefined;
            const o = r as Record<string, unknown>;
            const pattern = typeof o.pattern === 'string' ? o.pattern : '';
            const flag = typeof o.flag === 'string' && o.flag ? o.flag : undefined;
            const color = typeof o.color === 'string' ? o.color : undefined;
            return pattern && (flag || color) ? { pattern, flag, color } : undefined;
          })
          .filter(
            (r): r is { pattern: string; flag: string | undefined; color: string | undefined } =>
              r !== undefined,
          )
      : [];
    const tabs: { path: string; base: string; label?: string; flag?: string; color?: string }[] = [];
    for (const [k, v] of this.marks) {
      const uri = vscode.Uri.parse(k);
      const fsPath = uri.scheme === 'file' ? uri.fsPath : uri.path;
      tabs.push({
        path: fsPath,
        base: v.label ?? fsPath.split(/[\\/]/).pop() ?? fsPath,
        label: v.label,
        flag: v.flag,
        color: v.color,
      });
    }
    return { roots, tabStyle, flagPosition, tabs, rules };
  }

  private async handleRenames(
    files: readonly { readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }[],
  ): Promise<void> {
    const changed: vscode.Uri[] = [];
    for (const { oldUri, newUri } of files) {
      const oldStr = oldUri.toString();
      const oldPrefix = oldStr.endsWith('/') ? oldStr : oldStr + '/';
      for (const [k, v] of [...this.marks.entries()]) {
        if (k === oldStr) {
          this.marks.delete(k);
          this.marks.set(newUri.toString(), v);
          changed.push(oldUri, newUri);
        } else if (k.startsWith(oldPrefix)) {
          const suffix = k.slice(oldStr.length);
          const target = vscode.Uri.parse(newUri.toString() + suffix);
          this.marks.delete(k);
          this.marks.set(target.toString(), v);
          changed.push(vscode.Uri.parse(k), target);
        }
      }
    }
    if (changed.length) await this.persist(changed);
  }

  private async handleDeletes(files: readonly vscode.Uri[]): Promise<void> {
    const changed: vscode.Uri[] = [];
    for (const delUri of files) {
      const delStr = delUri.toString();
      const delPrefix = delStr.endsWith('/') ? delStr : delStr + '/';
      for (const k of [...this.marks.keys()]) {
        if (k === delStr || k.startsWith(delPrefix)) {
          this.marks.delete(k);
          changed.push(vscode.Uri.parse(k));
        }
      }
    }
    if (changed.length) await this.persist(changed);
  }

  private async persist(uris?: vscode.Uri[]): Promise<void> {
    await this.state.update(TabState.KEY, Object.fromEntries(this.marks));
    this.emitter.fire(uris);
  }

  dispose(): void {
    this.emitter.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
