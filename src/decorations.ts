import * as vscode from 'vscode';
import { TabMark, TabState } from './state';
import { contrastColor, sanitizeHex, escapeCssContent, firstGraphemes, globMatch } from './pure';

export type TabStyle = 'tinted' | 'full' | 'border';

/** Schemes that never represent a user-facing editor tab. */
const IGNORED_SCHEMES = new Set([
  'vscode-scm',
  'output',
  'debug',
  'walkThrough',
  'walkThroughSnippet',
  'git',
  'search-result',
  'vscode-userdata',
]);

/** Non-file schemes whose tabs carry session-generated URIs (re-attach candidates). */
const KNOWN_TAB_SCHEMES = new Set(['webview-panel', 'vscode-cascade-editor']);

/** Upper bound for `seenNonFileUris` so the cache can't grow forever. */
const MAX_SEEN_URIS = 128;

/**
 * Native per-tab & Explorer decoration provider.
 *
 * Uses `vscode.FileDecorationProvider` together with CSS Nesting (`[role="tab"]:has(&)`)
 * so that EVERY marked tab — including normal files, Claude Code webview panels
 * (`webview-panel:`), Devin/Cascade agent session tabs (`vscode-cascade-editor:`),
 * untitled editors, and diffs — gets its own background/border color and flag
 * without requiring root/workbench.html patching or polluting `.vscode/settings.json`.
 */
export class TabDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;

  /** Recent non-file tab URIs queried by the workbench (e.g. `webview-panel:`, `vscode-cascade-editor:`). */
  private readonly seenNonFileUris = new Map<string, { uri: vscode.Uri; ts: number }>();
  private lastNonFileUri?: vscode.Uri;
  private readonly pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  private registration: vscode.Disposable;
  private reRegisterTimer?: ReturnType<typeof setTimeout>;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly tabs: TabState) {
    this.registration = vscode.window.registerFileDecorationProvider(this);

    // Re-register once after built-in extensions (like vscode.git) finish starting
    // so Alive TABs sits at the end of IDecorationsService's provider list —
    // the last provider wins the merged decoration's color for a resource.
    this.reRegisterTimer = setTimeout(() => {
      this.registration.dispose();
      this.registration = vscode.window.registerFileDecorationProvider(this);
      this.emitter.fire(undefined);
      this.scheduleReconcile();
    }, 2500);

    this.disposables.push(
      this.tabs.onDidChange((uris) => this.emitter.fire(uris)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('alivetabs.tabStyle') ||
          e.affectsConfiguration('alivetabs.flagPosition') ||
          e.affectsConfiguration('alivetabs.useCustomLabels') ||
          e.affectsConfiguration('alivetabs.rules')
        ) {
          this.emitter.fire(undefined);
        }
      }),
      vscode.window.tabGroups.onDidChangeTabs((e) => {
        // Refresh everything when tabs open/close/change so marks re-render
        // even if another provider temporarily won the decoration merge.
        this.emitter.fire(undefined);
        this.handleTabChanges(e);
      }),
    );
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (IGNORED_SCHEMES.has(uri.scheme)) return undefined;
    let mark: TabMark | undefined;
    let stored = false;
    if (uri.scheme !== 'file') {
      this.rememberSeen(uri);
      mark = this.tabs.get(uri) ?? this.adoptOrphanedMark(uri);
      stored = mark !== undefined;
    } else {
      mark = this.tabs.get(uri);
      stored = mark !== undefined;
      if (!mark) mark = this.matchRule(uri); // virtual mark from alivetabs.rules
    }
    if (!mark || (!mark.flag && !mark.color)) return undefined;

    const cfg = vscode.workspace.getConfiguration('alivetabs');
    const flagPos = cfg.get<'suffix' | 'prefix'>('flagPosition', 'suffix');
    const tabStyle = cfg.get<TabStyle>('tabStyle', 'tinted');
    // When customLabels renders the flag inside the tab label text, don't
    // duplicate it via the decoration badge or injected CSS. Only applies to
    // stored marks — LabelSync writes patterns only for those, and rule-derived
    // (virtual) marks must render themselves.
    const flagDelegated =
      stored &&
      mark.flag !== undefined &&
      cfg.get<boolean>('useCustomLabels', false) &&
      uri.scheme === 'file' &&
      vscode.workspace.getWorkspaceFolder(uri) !== undefined;

    const badge = !flagDelegated && mark.flag ? firstGraphemes(mark.flag, 2) : undefined;
    const parts: string[] = [];
    if (mark.flag) parts.push(`Flag: ${mark.flag}`);
    if (mark.color) parts.push(`Color: ${mark.color}`);
    const tooltip = `Alive TABs — ${parts.join(' • ')}${stored ? '' : ' (auto)'}`;

    const color = new vscode.ThemeColor(buildThemeColorPayload(mark, flagPos, tabStyle, flagDelegated));
    return new vscode.FileDecoration(badge, tooltip, color);
  }

  /**
   * Evaluate `alivetabs.rules` for a file URI — a virtual (unpersisted) mark.
   * Patterns containing `/` match the workspace-relative path (folder name
   * included in multi-root workspaces); patterns without `/` match the basename.
   * First matching rule wins.
   */
  matchRule(uri: vscode.Uri): TabMark | undefined {
    if (uri.scheme !== 'file') return undefined;
    const rules = vscode.workspace.getConfiguration('alivetabs').get<unknown[]>('rules', []);
    if (!Array.isArray(rules) || !rules.length) return undefined;
    const multi = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    const rel = vscode.workspace.asRelativePath(uri, multi).replace(/\\/g, '/');
    const base = uri.path.split('/').pop() ?? '';
    for (const r of rules) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const pattern = typeof o.pattern === 'string' ? o.pattern : '';
      if (!pattern) continue;
      const target = pattern.includes('/') ? rel : base;
      if (globMatch(pattern, target)) {
        const flag = typeof o.flag === 'string' && o.flag ? o.flag : undefined;
        const color = typeof o.color === 'string' ? sanitizeHex(o.color) : undefined;
        if (flag || color) return { flag, color };
      }
    }
    return undefined;
  }

  /**
   * Resolve the URI and display label of the currently active editor tab,
   * including non-file tabs such as Claude Code (`TabInputWebview`) and
   * Devin/Cascade agent sessions (`vscode-cascade-editor`).
   */
  resolveActiveTab(): { uri: vscode.Uri; label?: string; viewType?: string } | undefined {
    const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    if (activeTab) {
      const input = activeTab.input as Record<string, unknown> | undefined;
      if (input) {
        if (input.uri instanceof vscode.Uri) {
          return { uri: input.uri, label: activeTab.label };
        }
        if (input.modified instanceof vscode.Uri) {
          return { uri: input.modified, label: activeTab.label };
        }
        if (typeof input.viewType === 'string') {
          const vt = input.viewType.replace(/^mainThreadWebview-/, '');
          const uri = this.mostRecentSeen(
            (u) => u.scheme === 'webview-panel' && u.path.includes(vt),
          );
          if (uri) return { uri, label: activeTab.label, viewType: vt };
        }
      } else {
        // Custom workbench EditorInputs (e.g. CascadeEditorInput `vscode-cascade-editor`)
        // have `activeTab.input === undefined` in the extension host.
        const uri =
          this.mostRecentSeen((u) => u.scheme === 'vscode-cascade-editor') ?? this.lastNonFileUri;
        if (uri) return { uri, label: activeTab.label };
      }
    }

    const doc = vscode.window.activeTextEditor?.document;
    if (doc) return { uri: doc.uri };
    return undefined;
  }

  /** Most recently decoration-queried URI matching `pred` (recency ≈ active tab). */
  private mostRecentSeen(pred: (u: vscode.Uri) => boolean): vscode.Uri | undefined {
    let best: vscode.Uri | undefined;
    let ts = -1;
    for (const { uri, ts: t } of this.seenNonFileUris.values()) {
      if (t > ts && pred(uri)) {
        ts = t;
        best = uri;
      }
    }
    return best;
  }

  private rememberSeen(uri: vscode.Uri): void {
    const key = uri.toString();
    // Keep insertion position on re-query — positional pairing relies on
    // first-seen order matching the tab-strip order.
    const prev = this.seenNonFileUris.get(key);
    if (prev) prev.ts = Date.now();
    else this.seenNonFileUris.set(key, { uri, ts: Date.now() });
    if (KNOWN_TAB_SCHEMES.has(uri.scheme)) this.lastNonFileUri = uri;
    while (this.seenNonFileUris.size > MAX_SEEN_URIS) {
      const oldest = this.seenNonFileUris.keys().next().value;
      if (oldest === undefined) break;
      this.seenNonFileUris.delete(oldest);
    }
  }

  /**
   * Re-attach a mark whose URI went stale — e.g. a webview or agent panel that
   * was closed and reopened with a new panel/session id. Migration only happens
   * when exactly one candidate matches and the old key hasn't been rendered this
   * session (its tab is gone), so a live tab can never lose its mark.
   */
  private adoptOrphanedMark(uri: vscode.Uri): TabMark | undefined {
    if (uri.scheme === 'untitled') return undefined;
    const candidates: [string, TabMark][] = [];
    for (const [key, m] of this.tabs.rawEntries()) {
      if (this.seenNonFileUris.has(key)) continue;
      const old = tryParseUri(key);
      if (!old || old.scheme !== uri.scheme) continue;
      if (uri.scheme === 'webview-panel') {
        const vt = m.viewType ?? guessWebviewViewType(old);
        if (!vt || !uri.path.includes(vt)) continue;
      }
      candidates.push([key, m]);
    }
    if (candidates.length !== 1) {
      // Several same-viewType orphans — the positional reconcile pass may
      // still be able to pair URIs with tabs by label.
      this.scheduleReconcile();
      return undefined;
    }
    const [oldKey, mark] = candidates[0];
    void this.tabs.migrate(oldKey, uri);
    return mark;
  }

  private reconcileTimer?: ReturnType<typeof setTimeout>;

  private scheduleReconcile(): void {
    if (this.reconcileTimer) return;
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = undefined;
      this.reconcileNonFileMarks();
    }, 350);
  }

  /**
   * Positional re-attach for stale non-file marks.
   *
   * `provideFileDecoration` learns a tab's URI but not its label; `tabGroups`
   * exposes each tab's label/viewType but not its URI. Decoration queries
   * arrive in tab-strip order, so within one viewType bucket the i-th queried
   * URI belongs to the i-th open tab of that viewType — pairing there, then
   * migrating the mark whose stored `label` exactly equals the tab's label.
   *
   * Guarded to avoid wrong attribution: a bucket is only paired when the
   * count of open tabs equals the count of queried URIs for that viewType and
   * every open tab label is unique. Anything unresolved stays orphaned and
   * remains visible in the overview for manual re-marking.
   */
  private reconcileNonFileMarks(): void {
    const stale = this.tabs
      .rawEntries()
      .map(([key, mark]) => ({ key, mark, uri: tryParseUri(key) }))
      .filter(
        (e): e is { key: string; mark: TabMark; uri: vscode.Uri } =>
          e.uri !== undefined &&
          KNOWN_TAB_SCHEMES.has(e.uri.scheme) &&
          !this.seenNonFileUris.has(e.key),
      );
    if (!stale.length) return;

    // Open non-file tabs in strip order, bucketed by viewType.
    const openWeb = new Map<string, string[]>();
    const openCascade: string[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as Record<string, unknown> | undefined;
        if (typeof input?.viewType === 'string') {
          const vt = input.viewType.replace(/^mainThreadWebview-/, '');
          const labels = openWeb.get(vt);
          if (labels) labels.push(tab.label);
          else openWeb.set(vt, [tab.label]);
        } else if (input === undefined) {
          openCascade.push(tab.label);
        }
      }
    }

    const seenOf = (scheme: string) =>
      [...this.seenNonFileUris.values()]
        .map((x) => x.uri)
        .filter((u) => u.scheme === scheme);

    const usedKeys = new Set<string>();
    const pairBucket = (
      labels: string[],
      uris: vscode.Uri[],
      findKey: (label: string) => string | undefined,
    ): void => {
      if (!uris.length || uris.length !== labels.length) return;
      if (new Set(labels).size !== labels.length) return;
      for (let i = 0; i < uris.length; i++) {
        const key = findKey(labels[i]);
        if (key && !usedKeys.has(key)) {
          usedKeys.add(key);
          void this.tabs.migrate(key, uris[i]);
        }
      }
    };

    const staleFor = (scheme: string, vt?: string) =>
      stale.filter(
        (e) =>
          !usedKeys.has(e.key) &&
          e.uri.scheme === scheme &&
          (vt === undefined ||
            e.mark.viewType === vt ||
            (!e.mark.viewType && e.uri.path.includes(vt))),
      );

    // Cascade bucket — only when stale cascade marks exist (the
    // `input === undefined` bucket is noisy: terminals/settings land there).
    if (staleFor('vscode-cascade-editor').length) {
      const uris = seenOf('vscode-cascade-editor');
      pairBucket(openCascade, uris, (label) => {
        const c = staleFor('vscode-cascade-editor').filter((e) => e.mark.label === label);
        return c.length === 1 ? c[0].key : undefined;
      });
    }

    const seenWeb = seenOf('webview-panel');
    for (const [vt, labels] of openWeb) {
      const uris = seenWeb.filter((u) => u.path.includes(vt));
      pairBucket(labels, uris, (label) => {
        const c = staleFor('webview-panel', vt).filter((e) => e.mark.label === label);
        return c.length === 1 ? c[0].key : undefined;
      });
    }
  }

  private handleTabChanges(e: {
    opened: readonly vscode.Tab[];
    closed: readonly vscode.Tab[];
    changed: readonly vscode.Tab[];
  }): void {
    // Saving an untitled editor swaps its `untitled:` URI for a `file:` URI via
    // a tab `changed` event (no workspace rename event fires) — migrate the mark
    // when the swap is unambiguous.
    const newFileUris: vscode.Uri[] = [];
    for (const tab of [...e.opened, ...e.changed]) {
      const input = tab.input as Record<string, unknown> | undefined;
      if (input?.uri instanceof vscode.Uri && input.uri.scheme === 'file') {
        newFileUris.push(input.uri);
      }
    }
    if (newFileUris.length === 1) {
      const openUntitled = this.openUntitledKeys();
      const orphans = this.tabs
        .rawEntries()
        .filter(([key]) => key.startsWith('untitled:') && !openUntitled.has(key));
      if (orphans.length === 1) void this.tabs.migrate(orphans[0][0], newFileUris[0]);
    }

    for (const tab of e.closed) {
      const input = tab.input as Record<string, unknown> | undefined;

      // A closed untitled editor discards its content permanently — its mark can
      // never match again, so drop it (unless the swap above already migrated it).
      if (input?.uri instanceof vscode.Uri && input.uri.scheme === 'untitled') {
        const uri = input.uri;
        const timer = setTimeout(() => {
          this.pendingTimers.delete(timer);
          if (this.tabs.hasKey(uri.toString())) void this.tabs.clear(uri);
        }, 400);
        this.pendingTimers.add(timer);
        continue;
      }

      // Non-file tabs (webview/cascade) close without exposing their URI — evict
      // the least-recently-queried matching URI so its mark becomes adoptable by
      // a reopened panel. Re-queries of surviving tabs refresh their timestamps
      // before this runs.
      let pred: (u: vscode.Uri) => boolean;
      if (typeof input?.viewType === 'string') {
        const vt = input.viewType.replace(/^mainThreadWebview-/, '');
        pred = (u) => u.scheme === 'webview-panel' && u.path.includes(vt);
      } else if (!input?.uri) {
        pred = (u) => u.scheme === 'vscode-cascade-editor';
      } else {
        continue;
      }
      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer);
        let oldestKey: string | undefined;
        let oldestTs = Infinity;
        for (const [key, { uri, ts }] of this.seenNonFileUris) {
          if (ts < oldestTs && pred(uri)) {
            oldestTs = ts;
            oldestKey = key;
          }
        }
        if (oldestKey !== undefined) this.seenNonFileUris.delete(oldestKey);
        this.scheduleReconcile();
      }, 600);
      this.pendingTimers.add(timer);
    }
    this.scheduleReconcile();
  }

  private openUntitledKeys(): Set<string> {
    const keys = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as Record<string, unknown> | undefined;
        if (input?.uri instanceof vscode.Uri && input.uri.scheme === 'untitled') {
          keys.add(input.uri.toString());
        }
      }
    }
    return keys;
  }

  dispose(): void {
    if (this.reRegisterTimer) clearTimeout(this.reRegisterTimer);
    for (const t of this.pendingTimers) clearTimeout(t);
    this.registration.dispose();
    this.emitter.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

/**
 * Build a dot-free CSS payload for `ThemeColor(id)`.
 * VS Code's `asCssVariableName` replaces `.` with `-`, so all selectors use
 * attribute matchers (`[role="tab"]`, `[class~="active"]`) and integer percentages.
 */
function buildThemeColorPayload(
  mark: TabMark,
  flagPos: 'suffix' | 'prefix',
  tabStyle: TabStyle,
  flagDelegated: boolean,
): string {
  const hex = sanitizeHex(mark.color);
  const fg = hex ? contrastColor(hex) : '#ffffff';
  const rules: string[] = [`alivetabs, ${hex ?? 'inherit'})`];

  if (hex) {
    if (tabStyle === 'full') {
      rules.push(
        `:is(#_at, [role="tab"]):not([class~="active"]):has(&) { background-color: color-mix(in srgb, ${hex} 72%, var(--vscode-tab-inactiveBackground, #1e1e1e)) !important; box-shadow: inset 0 -2px 0 0 rgba(0, 0, 0, 35%) !important; }`,
        `:is(#_at, [role="tab"])[class~="active"]:has(&) { background-color: ${hex} !important; box-shadow: inset 0 2px 0 0 rgba(255, 255, 255, 35%), inset 0 -2px 0 0 rgba(0, 0, 0, 35%) !important; }`,
        `:is(#_at, [role="tab"]):has(&), :is(#_at, [role="tab"]):has(&) [class~="label-name"], :is(#_at, [role="tab"]):has(&) [class~="label-description"], :is(#_at, [role="tab"]):has(&) [class~="action-label"] { color: ${fg} !important; }`,
      );
    } else if (tabStyle === 'border') {
      rules.push(
        `:is(#_at, [role="tab"]):not([class~="active"]):has(&) { box-shadow: inset 0 -2px 0 0 ${hex} !important; }`,
        `:is(#_at, [role="tab"])[class~="active"]:has(&) { box-shadow: inset 0 2px 0 0 ${hex}, inset 0 -2px 0 0 ${hex} !important; }`,
        `:is(#_at, [role="tab"]):has(&) [class~="label-name"] { color: ${hex} !important; }`,
      );
    } else {
      // 'tinted' (default): neon-pill tint + glowing border matching the Alive TABs icon
      rules.push(
        `:is(#_at, [role="tab"]):not([class~="active"]):has(&) { background-color: color-mix(in srgb, ${hex} 24%, transparent) !important; box-shadow: inset 0 -2px 0 0 ${hex} !important; }`,
        `:is(#_at, [role="tab"])[class~="active"]:has(&) { background-color: color-mix(in srgb, ${hex} 42%, transparent) !important; box-shadow: inset 0 0 0 1px ${hex}, inset 0 -2px 0 0 ${hex} !important; }`,
        `:is(#_at, [role="tab"]):has(&) [class~="label-name"] { color: color-mix(in srgb, ${hex} 35%, var(--vscode-tab-activeForeground, #ffffff)) !important; }`,
      );
    }
  }

  if (mark.flag && !flagDelegated) {
    const escapedFlag = escapeCssContent(mark.flag);
    // Hide the raw FileDecoration ::after badge on the tab itself so we don't render
    // duplicate badges on tabs while keeping the badge visible in the Explorer tree.
    rules.push(`&:is([role="tab"] *)::after { display: none !important; }`);
    if (flagPos === 'prefix') {
      rules.push(
        `:is(#_at, [role="tab"]):has(&) [class~="label-name"]::before { content: "${escapedFlag} "; font-style: normal; }`,
      );
    } else {
      rules.push(
        `:is(#_at, [role="tab"]):has(&) [class~="label-name"]::after { content: " ${escapedFlag}"; font-style: normal; }`,
      );
    }
  }

  rules.push(`--alivetabs: var(--vscode-none`);
  return rules.join('; ');
}

function tryParseUri(key: string): vscode.Uri | undefined {
  try {
    return vscode.Uri.parse(key);
  } catch {
    return undefined;
  }
}

/** Best-effort viewType recovery from a `webview-panel:` URI path (`/<viewType>-<panelId>`). */
function guessWebviewViewType(uri: vscode.Uri): string | undefined {
  const stripped = uri.path.replace(/^\/+/, '').replace(/-[A-Za-z0-9]{4,}$/, '');
  return stripped || undefined;
}
