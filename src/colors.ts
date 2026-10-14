import * as vscode from 'vscode';
import { TabState } from './state';
import { contrastColor } from './pure';

const MANAGED_COLOR_KEYS = [
  'tab.activeBackground',
  'tab.activeForeground',
  'tab.activeBorderTop',
  'tab.activeBorder',
] as const;

/**
 * Optional `workbench.colorCustomizations` sync for active-tab theme tokens.
 *
 * Since `TabDecorationProvider` now colors all tabs (both active and inactive)
 * without touching `.vscode/settings.json`, `alivetabs.colorActiveTab` defaults
 * to `false`, and any stale `tab.active*` keys left by v0.1.0 are cleaned up.
 */
export class ActiveTabColorizer implements vscode.Disposable {
  private static readonly TRACK_KEY = 'alivetabs.managedColorCustomizations';
  private applied?: string;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly tabs: TabState,
    private readonly state: vscode.Memento,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => void this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('alivetabs.colorActiveTab')) void this.refresh();
      }),
      this.tabs.onDidChange(() => void this.refresh()),
    );
    void this.refresh();
  }

  private enabled(): boolean {
    return vscode.workspace
      .getConfiguration('alivetabs')
      .get<boolean>('colorActiveTab', false);
  }

  private markForActiveEditor(): { color?: string } {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc || doc.uri.scheme !== 'file') return {};
    return this.tabs.get(doc.uri) ?? {};
  }

  /**
   * Keys we actually wrote, so refresh never deletes `tab.active*` entries the
   * user set by hand. Legacy value was a boolean: `true` (or absent) means a
   * v0.1.x/v0.2.0 install may have written all four keys — clean them once.
   */
  private managedKeys(): Set<string> {
    const raw = this.state.get<unknown>(ActiveTabColorizer.TRACK_KEY);
    if (Array.isArray(raw)) return new Set(raw.filter((x): x is string => typeof x === 'string'));
    return new Set(raw === false ? [] : [...MANAGED_COLOR_KEYS]);
  }

  private async refresh(): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) return;
    const enabled = this.enabled();
    const managed = this.managedKeys();
    if (!enabled && managed.size === 0) return;

    const cfg = vscode.workspace.getConfiguration('workbench');
    const inspect = cfg.inspect<Record<string, string>>('colorCustomizations');
    const before = { ...(inspect?.workspaceValue ?? {}) };
    const colors = { ...before };

    for (const k of managed) delete colors[k];
    managed.clear();

    const { color } = enabled ? this.markForActiveEditor() : {};
    if (color) {
      colors['tab.activeBackground'] = color;
      colors['tab.activeForeground'] = contrastColor(color);
      colors['tab.activeBorderTop'] = color;
      colors['tab.activeBorder'] = color;
      for (const k of MANAGED_COLOR_KEYS) managed.add(k);
    }

    await this.state.update(ActiveTabColorizer.TRACK_KEY, [...managed]);

    const next = JSON.stringify(colors);
    if (next === this.applied || next === JSON.stringify(before)) return;
    this.applied = next;
    const nextValue = Object.keys(colors).length > 0 ? colors : undefined;
    await cfg.update('colorCustomizations', nextValue, vscode.ConfigurationTarget.Workspace);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
