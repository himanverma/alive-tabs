import * as vscode from 'vscode';
import * as path from 'path';
import { TabState } from './state';

/**
 * Optional sync to `workbench.editor.customLabels.patterns`.
 *
 * By default (`alivetabs.useCustomLabels = false`), flags are rendered directly
 * by `TabDecorationProvider` so `.vscode/settings.json` stays untouched.
 * This class also cleans up any legacy `customLabels.patterns` entries written
 * by earlier versions of Alive TABs (which used `${filename}` without `.${extname}`).
 */
export class LabelSync implements vscode.Disposable {
  private static readonly MANAGED_KEY = 'alivetabs.managedPatterns';
  private static readonly LEGACY_KEY = 'alivetabs.legacyPatternsCleaned';
  private managedPatterns: Set<string>;
  private syncing = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly tabs: TabState,
    private readonly state: vscode.Memento,
  ) {
    this.managedPatterns = new Set(state.get<string[]>(LabelSync.MANAGED_KEY, []));
    this.disposables.push(
      this.tabs.onDidChange(() => void this.sync()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('alivetabs.useCustomLabels') ||
          e.affectsConfiguration('alivetabs.flagPosition')
        ) {
          void this.sync();
        }
      }),
    );
  }

  private currentPatterns(): Record<string, string> {
    const cfg = vscode.workspace.getConfiguration('workbench.editor.customLabels');
    const inspect = cfg.inspect<Record<string, string>>('patterns');
    return { ...(inspect?.workspaceValue ?? {}) };
  }

  private relativePattern(uri: vscode.Uri): string | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return undefined;
    const multi = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    const rel = vscode.workspace.asRelativePath(uri, multi);
    const escaped = rel
      .split(path.sep)
      .join('/')
      .replace(/[\\*?[\]{}(),!+@]/g, '\\$&');
    return `**/${escaped}`;
  }

  /** Build a customLabels template that preserves the file extension. */
  private buildTemplate(uri: vscode.Uri, flag: string, pos: 'suffix' | 'prefix'): string {
    const base = path.posix.basename(uri.path);
    const stripped = base.replace(/^\.+/, '');
    const hasExt = stripped.includes('.');
    const nameToken = hasExt ? '${filename}.${extname}' : '${filename}';
    return pos === 'prefix' ? `${flag} ${nameToken}` : `${nameToken} ${flag}`;
  }

  async sync(): Promise<void> {
    if (this.syncing || !vscode.workspace.workspaceFolders?.length) return;
    this.syncing = true;
    try {
      const before = this.currentPatterns();
      const patterns = { ...before };

      for (const key of this.managedPatterns) delete patterns[key];
      // One-time cleanup of legacy v0.1.0 entries (`**/...` -> `${filename} <flag>`).
      // Runs only once so hand-written user patterns that happen to match the
      // same shape are never deleted on subsequent syncs.
      if (!this.state.get<boolean>(LabelSync.LEGACY_KEY)) {
        for (const [k, v] of Object.entries(patterns)) {
          if (
            k.startsWith('**/') &&
            typeof v === 'string' &&
            (/^\$\{filename\}(\.\$\{extname\})?\s+\S+$/.test(v) ||
              /^\S+\s+\$\{filename\}(\.\$\{extname\})?$/.test(v))
          ) {
            delete patterns[k];
          }
        }
        await this.state.update(LabelSync.LEGACY_KEY, true);
      }
      this.managedPatterns.clear();

      const cfg = vscode.workspace.getConfiguration('alivetabs');
      const useCustomLabels = cfg.get<boolean>('useCustomLabels', false);
      const flagPosition = cfg.get<'suffix' | 'prefix'>('flagPosition', 'suffix');

      if (useCustomLabels) {
        for (const [uri, mark] of this.tabs.entries()) {
          if (uri.scheme !== 'file' || !mark.flag) continue;
          const pattern = this.relativePattern(uri);
          if (!pattern) continue;
          patterns[pattern] = this.buildTemplate(uri, mark.flag, flagPosition);
          this.managedPatterns.add(pattern);
        }
      }

      await this.state.update(LabelSync.MANAGED_KEY, [...this.managedPatterns]);

      if (JSON.stringify(before) !== JSON.stringify(patterns)) {
        const nextValue = Object.keys(patterns).length > 0 ? patterns : undefined;
        await vscode.workspace
          .getConfiguration('workbench.editor.customLabels')
          .update('patterns', nextValue, vscode.ConfigurationTarget.Workspace);
      }
    } finally {
      this.syncing = false;
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
