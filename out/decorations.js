"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TabDecorationProvider = void 0;
const vscode = __importStar(require("vscode"));
const pure_1 = require("./pure");
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
class TabDecorationProvider {
    tabs;
    emitter = new vscode.EventEmitter();
    onDidChangeFileDecorations = this.emitter.event;
    /** Recent non-file tab URIs queried by the workbench (e.g. `webview-panel:`, `vscode-cascade-editor:`). */
    seenNonFileUris = new Map();
    pendingTimers = new Set();
    registration;
    reRegisterTimer;
    disposables = [];
    constructor(tabs) {
        this.tabs = tabs;
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
        this.disposables.push(this.tabs.onDidChange((uris) => {
            this.emitter.fire(uris);
            if (!uris ||
                (Array.isArray(uris) ? uris : [uris]).some((uri) => KNOWN_TAB_SCHEMES.has(uri.scheme))) {
                this.scheduleReconcile();
            }
        }), vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('alivetabs.tabStyle') ||
                e.affectsConfiguration('alivetabs.flagPosition') ||
                e.affectsConfiguration('alivetabs.useCustomLabels') ||
                e.affectsConfiguration('alivetabs.rules')) {
                this.emitter.fire(undefined);
            }
        }), vscode.window.tabGroups.onDidChangeTabs((e) => {
            // Refresh everything when tabs open/close/change so marks re-render
            // even if another provider temporarily won the decoration merge.
            this.emitter.fire(undefined);
            this.handleTabChanges(e);
        }));
    }
    provideFileDecoration(uri) {
        if (IGNORED_SCHEMES.has(uri.scheme))
            return undefined;
        let mark;
        let stored = false;
        if (uri.scheme !== 'file') {
            this.rememberSeen(uri);
            mark = this.tabs.get(uri) ?? this.adoptOrphanedMark(uri);
            stored = mark !== undefined;
        }
        else {
            mark = this.tabs.get(uri);
            stored = mark !== undefined;
            if (!mark)
                mark = this.matchRule(uri); // virtual mark from alivetabs.rules
        }
        if (!mark || (!mark.flag && !mark.color))
            return undefined;
        const cfg = vscode.workspace.getConfiguration('alivetabs');
        const flagPos = cfg.get('flagPosition', 'suffix');
        const tabStyle = cfg.get('tabStyle', 'tinted');
        // When customLabels renders the flag inside the tab label text, don't
        // duplicate it via the decoration badge or injected CSS. Only applies to
        // stored marks — LabelSync writes patterns only for those, and rule-derived
        // (virtual) marks must render themselves.
        const flagDelegated = stored &&
            mark.flag !== undefined &&
            cfg.get('useCustomLabels', false) &&
            uri.scheme === 'file' &&
            vscode.workspace.getWorkspaceFolder(uri) !== undefined;
        const badge = !flagDelegated && mark.flag ? (0, pure_1.firstGraphemes)(mark.flag, 2) : undefined;
        const parts = [];
        if (mark.flag)
            parts.push(`Flag: ${mark.flag}`);
        if (mark.color)
            parts.push(`Color: ${mark.color}`);
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
    matchRule(uri) {
        if (uri.scheme !== 'file')
            return undefined;
        const rules = vscode.workspace.getConfiguration('alivetabs').get('rules', []);
        if (!Array.isArray(rules) || !rules.length)
            return undefined;
        const multi = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
        const rel = vscode.workspace.asRelativePath(uri, multi).replace(/\\/g, '/');
        const base = uri.path.split('/').pop() ?? '';
        for (const r of rules) {
            if (!r || typeof r !== 'object')
                continue;
            const o = r;
            const pattern = typeof o.pattern === 'string' ? o.pattern : '';
            if (!pattern)
                continue;
            const target = pattern.includes('/') ? rel : base;
            if ((0, pure_1.globMatch)(pattern, target)) {
                const flag = typeof o.flag === 'string' && o.flag ? o.flag : undefined;
                const color = typeof o.color === 'string' ? (0, pure_1.sanitizeHex)(o.color) : undefined;
                if (flag || color)
                    return { flag, color };
            }
        }
        return undefined;
    }
    /**
     * Resolve the active tab. Non-file resource URIs are paired with TabInputs
     * by view type and tab-strip order.
     */
    resolveActiveTab() {
        const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
        if (activeTab) {
            const input = activeTab.input;
            if (input) {
                if (input.uri instanceof vscode.Uri) {
                    return {
                        uri: input.uri,
                        label: input.uri.scheme === 'file' ? undefined : activeTab.label,
                    };
                }
                if (input.modified instanceof vscode.Uri) {
                    return {
                        uri: input.modified,
                        label: input.modified.scheme === 'file' ? undefined : activeTab.label,
                    };
                }
            }
            const resolved = this.resolveUriForTab(activeTab);
            if (resolved)
                return { ...resolved, label: resolved.label ?? activeTab.label };
            // Never apply a mark to the last-queried sibling session as a fallback.
            return undefined;
        }
        const doc = vscode.window.activeTextEditor?.document;
        if (doc)
            return { uri: doc.uri };
        return undefined;
    }
    /** Resolve a live tab's metadata from a decoration URI. */
    resolveTab(uri) {
        if (!KNOWN_TAB_SCHEMES.has(uri.scheme))
            return undefined;
        const viewType = uri.scheme === 'webview-panel' ? this.viewTypeForUri(uri) : undefined;
        if (uri.scheme === 'webview-panel' && !viewType)
            return undefined;
        const tabs = this.openTabsFor(uri.scheme, viewType);
        const uris = this.seenUrisFor(uri.scheme, viewType);
        if (tabs.length !== uris.length)
            return undefined;
        const index = uris.findIndex((seen) => seen.toString() === uri.toString());
        if (index < 0)
            return undefined;
        return this.metadataForTab(tabs[index], uri.scheme, viewType);
    }
    resolveUriForTab(tab) {
        const input = tab.input;
        let scheme;
        let viewType;
        if (typeof input?.viewType === 'string') {
            scheme = 'webview-panel';
            viewType = normalizeViewType(input.viewType);
        }
        else if (input === undefined) {
            scheme = 'vscode-cascade-editor';
        }
        else {
            return undefined;
        }
        const tabs = this.openTabsFor(scheme, viewType);
        const uris = this.seenUrisFor(scheme, viewType);
        if (tabs.length !== uris.length)
            return undefined;
        const index = tabs.indexOf(tab);
        if (index < 0)
            return undefined;
        return { uri: uris[index], ...this.metadataForTab(tab, scheme, viewType) };
    }
    openTabsFor(scheme, viewType) {
        const out = [];
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const input = tab.input;
                if (scheme === 'webview-panel' &&
                    viewType &&
                    typeof input?.viewType === 'string' &&
                    normalizeViewType(input.viewType) === viewType) {
                    out.push(tab);
                }
                else if (scheme === 'vscode-cascade-editor' && input === undefined) {
                    out.push(tab);
                }
            }
        }
        return out;
    }
    seenUrisFor(scheme, viewType) {
        return [...this.seenNonFileUris.values()]
            .map(({ uri }) => uri)
            .filter((uri) => uri.scheme === scheme &&
            (scheme !== 'webview-panel' || (!!viewType && uri.path.includes(viewType))));
    }
    viewTypeForUri(uri) {
        const viewTypes = new Set();
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const input = tab.input;
                if (typeof input?.viewType === 'string' &&
                    uri.path.includes(normalizeViewType(input.viewType))) {
                    viewTypes.add(normalizeViewType(input.viewType));
                }
            }
        }
        return viewTypes.size === 1 ? [...viewTypes][0] : undefined;
    }
    metadataForTab(tab, scheme, viewType) {
        const tabSlot = this.tabSlotFor(tab, scheme, viewType);
        return {
            label: tab.label,
            ...(scheme === 'webview-panel' && viewType ? { viewType } : {}),
            ...(tabSlot ? { tabSlot } : {}),
        };
    }
    tabSlotFor(tab, scheme, viewType) {
        for (const group of vscode.window.tabGroups.all) {
            if (!group.tabs.includes(tab))
                continue;
            const peers = group.tabs.filter((candidate) => {
                const input = candidate.input;
                if (candidate.label !== tab.label)
                    return false;
                if (scheme === 'webview-panel') {
                    return (!!viewType &&
                        typeof input?.viewType === 'string' &&
                        normalizeViewType(input.viewType) === viewType);
                }
                return scheme === 'vscode-cascade-editor' && input === undefined;
            });
            const index = peers.indexOf(tab);
            return index < 0
                ? undefined
                : JSON.stringify([scheme, viewType ?? '', group.viewColumn, index]);
        }
        return undefined;
    }
    rememberSeen(uri) {
        const key = uri.toString();
        // Keep insertion position on re-query — positional pairing relies on
        // first-seen order matching the tab-strip order.
        const prev = this.seenNonFileUris.get(key);
        if (prev)
            prev.ts = Date.now();
        else
            this.seenNonFileUris.set(key, { uri, ts: Date.now() });
        while (this.seenNonFileUris.size > MAX_SEEN_URIS) {
            const oldest = this.seenNonFileUris.keys().next().value;
            if (oldest === undefined)
                break;
            this.seenNonFileUris.delete(oldest);
        }
    }
    /**
     * Re-attach a mark whose URI went stale — e.g. a webview or agent panel that
     * was closed and reopened with a new panel/session id. Migration only happens
     * when exactly one candidate matches and the old key hasn't been rendered this
     * session (its tab is gone), so a live tab can never lose its mark.
     */
    adoptOrphanedMark(uri) {
        if (uri.scheme === 'untitled')
            return undefined;
        const candidates = [];
        for (const [key, m] of this.tabs.rawEntries()) {
            if (this.seenNonFileUris.has(key))
                continue;
            const old = tryParseUri(key);
            if (!old || old.scheme !== uri.scheme)
                continue;
            if (uri.scheme === 'webview-panel') {
                const vt = m.viewType ? normalizeViewType(m.viewType) : guessWebviewViewType(old);
                if (!vt || !uri.path.includes(vt))
                    continue;
            }
            candidates.push([key, m]);
        }
        const viewType = uri.scheme === 'webview-panel' ? this.viewTypeForUri(uri) : undefined;
        const liveTabs = this.openTabsFor(uri.scheme, viewType);
        const liveUris = this.seenUrisFor(uri.scheme, viewType);
        if (candidates.length !== 1 ||
            liveTabs.length !== 1 ||
            liveUris.length !== 1) {
            // Defer ambiguous sessions until all current tab URIs have been queried.
            this.scheduleReconcile();
            return undefined;
        }
        const [oldKey, mark] = candidates[0];
        void this.tabs.migrate(oldKey, uri, this.resolveTab(uri) ?? {});
        return mark;
    }
    reconcileTimer;
    scheduleReconcile() {
        if (this.reconcileTimer)
            return;
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
     * URI belongs to the i-th open tab of that viewType. Saved slots survive
     * future URI changes; legacy marks fall back to labels and only use a full
     * positional match when every remaining mark has a corresponding open tab.
     */
    reconcileNonFileMarks() {
        const stale = this.tabs
            .rawEntries()
            .map(([key, mark]) => ({ key, mark, uri: tryParseUri(key) }))
            .filter((e) => e.uri !== undefined &&
            KNOWN_TAB_SCHEMES.has(e.uri.scheme) &&
            !this.seenNonFileUris.has(e.key));
        // Open non-file tabs in strip order, bucketed by viewType.
        const openWeb = new Map();
        const openCascade = [];
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const input = tab.input;
                if (typeof input?.viewType === 'string') {
                    const viewType = normalizeViewType(input.viewType);
                    const tabs = openWeb.get(viewType);
                    if (tabs)
                        tabs.push(tab);
                    else
                        openWeb.set(viewType, [tab]);
                }
                else if (input === undefined) {
                    openCascade.push(tab);
                }
            }
        }
        const usedKeys = new Set();
        const reconcileBucket = (scheme, viewType, tabs, uris) => {
            if (!uris.length || uris.length !== tabs.length)
                return;
            const currentTabs = tabs.map((tab, i) => {
                const metadata = this.metadataForTab(tab, scheme, viewType);
                return {
                    tab,
                    uri: uris[i],
                    label: tab.label,
                    tabSlot: metadata.tabSlot,
                    metadata,
                };
            });
            const candidates = stale.filter((entry) => {
                if (usedKeys.has(entry.key) || entry.uri.scheme !== scheme)
                    return false;
                if (scheme !== 'webview-panel')
                    return true;
                if (!viewType)
                    return false;
                return entry.mark.viewType
                    ? normalizeViewType(entry.mark.viewType) === viewType
                    : entry.uri.path.includes(viewType);
            });
            const unmarkedTabs = currentTabs.filter((current) => !this.tabs.get(current.uri));
            const matches = (0, pure_1.matchSessionMarks)(candidates.map((entry) => ({
                key: entry.key,
                label: entry.mark.label,
                tabSlot: entry.mark.tabSlot,
            })), unmarkedTabs.map((current) => ({
                uri: current.uri.toString(),
                label: current.label,
                tabSlot: current.tabSlot,
            })), scheme === 'webview-panel');
            for (const match of matches) {
                if (usedKeys.has(match.key))
                    continue;
                const current = currentTabs.find((entry) => entry.uri.toString() === match.uri);
                if (!current)
                    continue;
                usedKeys.add(match.key);
                void this.tabs.migrate(match.key, current.uri, current.metadata);
            }
        };
        reconcileBucket('vscode-cascade-editor', undefined, openCascade, this.seenUrisFor('vscode-cascade-editor'));
        for (const [viewType, tabs] of openWeb) {
            reconcileBucket('webview-panel', viewType, tabs, this.seenUrisFor('webview-panel', viewType));
        }
    }
    handleTabChanges(e) {
        // Saving an untitled editor swaps its `untitled:` URI for a `file:` URI via
        // a tab `changed` event (no workspace rename event fires) — migrate the mark
        // when the swap is unambiguous.
        const newFileUris = [];
        for (const tab of [...e.opened, ...e.changed]) {
            const input = tab.input;
            if (input?.uri instanceof vscode.Uri && input.uri.scheme === 'file') {
                newFileUris.push(input.uri);
            }
        }
        if (newFileUris.length === 1) {
            const openUntitled = this.openUntitledKeys();
            const orphans = this.tabs
                .rawEntries()
                .filter(([key]) => key.startsWith('untitled:') && !openUntitled.has(key));
            if (orphans.length === 1)
                void this.tabs.migrate(orphans[0][0], newFileUris[0]);
        }
        for (const tab of e.closed) {
            const input = tab.input;
            // A closed untitled editor discards its content permanently — its mark can
            // never match again, so drop it (unless the swap above already migrated it).
            if (input?.uri instanceof vscode.Uri && input.uri.scheme === 'untitled') {
                const uri = input.uri;
                const timer = setTimeout(() => {
                    this.pendingTimers.delete(timer);
                    if (this.tabs.hasKey(uri.toString()))
                        void this.tabs.clear(uri);
                }, 400);
                this.pendingTimers.add(timer);
                continue;
            }
            // Non-file tabs (webview/cascade) close without exposing their URI — evict
            // the least-recently-queried matching URI so its mark becomes adoptable by
            // a reopened panel. Re-queries of surviving tabs refresh their timestamps
            // before this runs.
            let pred;
            if (typeof input?.viewType === 'string') {
                const vt = input.viewType.replace(/^mainThreadWebview-/, '');
                pred = (u) => u.scheme === 'webview-panel' && u.path.includes(vt);
            }
            else if (!input?.uri) {
                pred = (u) => u.scheme === 'vscode-cascade-editor';
            }
            else {
                continue;
            }
            const timer = setTimeout(() => {
                this.pendingTimers.delete(timer);
                let oldestKey;
                let oldestTs = Infinity;
                for (const [key, { uri, ts }] of this.seenNonFileUris) {
                    if (ts < oldestTs && pred(uri)) {
                        oldestTs = ts;
                        oldestKey = key;
                    }
                }
                if (oldestKey !== undefined)
                    this.seenNonFileUris.delete(oldestKey);
                this.scheduleReconcile();
            }, 600);
            this.pendingTimers.add(timer);
        }
        this.scheduleReconcile();
    }
    openUntitledKeys() {
        const keys = new Set();
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const input = tab.input;
                if (input?.uri instanceof vscode.Uri && input.uri.scheme === 'untitled') {
                    keys.add(input.uri.toString());
                }
            }
        }
        return keys;
    }
    dispose() {
        if (this.reRegisterTimer)
            clearTimeout(this.reRegisterTimer);
        for (const t of this.pendingTimers)
            clearTimeout(t);
        this.registration.dispose();
        this.emitter.dispose();
        for (const d of this.disposables)
            d.dispose();
    }
}
exports.TabDecorationProvider = TabDecorationProvider;
/**
 * Build a dot-free CSS payload for `ThemeColor(id)`.
 * VS Code's `asCssVariableName` replaces `.` with `-`, so all selectors use
 * attribute matchers (`[role="tab"]`, `[class~="active"]`) and integer percentages.
 */
function buildThemeColorPayload(mark, flagPos, tabStyle, flagDelegated) {
    const hex = (0, pure_1.sanitizeHex)(mark.color);
    const fg = hex ? (0, pure_1.contrastColor)(hex) : '#ffffff';
    const rules = [`alivetabs, ${hex ?? 'inherit'})`];
    if (hex) {
        if (tabStyle === 'full') {
            rules.push(`:is(#_at, [role="tab"]):not([class~="active"]):has(&) { background-color: color-mix(in srgb, ${hex} 72%, var(--vscode-tab-inactiveBackground, #1e1e1e)) !important; box-shadow: inset 0 -2px 0 0 rgba(0, 0, 0, 35%) !important; }`, `:is(#_at, [role="tab"])[class~="active"]:has(&) { background-color: ${hex} !important; box-shadow: inset 0 2px 0 0 rgba(255, 255, 255, 35%), inset 0 -2px 0 0 rgba(0, 0, 0, 35%) !important; }`, `:is(#_at, [role="tab"]):has(&), :is(#_at, [role="tab"]):has(&) [class~="label-name"], :is(#_at, [role="tab"]):has(&) [class~="label-description"], :is(#_at, [role="tab"]):has(&) [class~="action-label"] { color: ${fg} !important; }`);
        }
        else if (tabStyle === 'border') {
            rules.push(`:is(#_at, [role="tab"]):not([class~="active"]):has(&) { box-shadow: inset 0 -2px 0 0 ${hex} !important; }`, `:is(#_at, [role="tab"])[class~="active"]:has(&) { box-shadow: inset 0 2px 0 0 ${hex}, inset 0 -2px 0 0 ${hex} !important; }`, `:is(#_at, [role="tab"]):has(&) [class~="label-name"] { color: ${hex} !important; }`);
        }
        else {
            // 'tinted' (default): neon-pill tint + glowing border matching the Alive TABs icon
            rules.push(`:is(#_at, [role="tab"]):not([class~="active"]):has(&) { background-color: color-mix(in srgb, ${hex} 24%, transparent) !important; box-shadow: inset 0 -2px 0 0 ${hex} !important; }`, `:is(#_at, [role="tab"])[class~="active"]:has(&) { background-color: color-mix(in srgb, ${hex} 42%, transparent) !important; box-shadow: inset 0 0 0 1px ${hex}, inset 0 -2px 0 0 ${hex} !important; }`, `:is(#_at, [role="tab"]):has(&) [class~="label-name"] { color: color-mix(in srgb, ${hex} 35%, var(--vscode-tab-activeForeground, #ffffff)) !important; }`);
        }
    }
    if (mark.flag && !flagDelegated) {
        const escapedFlag = (0, pure_1.escapeCssContent)(mark.flag);
        // Hide the raw FileDecoration ::after badge on the tab itself so we don't render
        // duplicate badges on tabs while keeping the badge visible in the Explorer tree.
        rules.push(`&:is([role="tab"] *)::after { display: none !important; }`);
        if (flagPos === 'prefix') {
            rules.push(`:is(#_at, [role="tab"]):has(&) [class~="label-name"]::before { content: "${escapedFlag} "; font-style: normal; }`);
        }
        else {
            rules.push(`:is(#_at, [role="tab"]):has(&) [class~="label-name"]::after { content: " ${escapedFlag}"; font-style: normal; }`);
        }
    }
    rules.push(`--alivetabs: var(--vscode-none`);
    return rules.join('; ');
}
function tryParseUri(key) {
    try {
        return vscode.Uri.parse(key);
    }
    catch {
        return undefined;
    }
}
function normalizeViewType(viewType) {
    return viewType.replace(/^mainThreadWebview-/, '');
}
/** Best-effort viewType recovery from a `webview-panel:` URI path (`/<viewType>-<panelId>`). */
function guessWebviewViewType(uri) {
    const stripped = uri.path.replace(/^\/+/, '').replace(/-[A-Za-z0-9]{4,}$/, '');
    return stripped || undefined;
}
//# sourceMappingURL=decorations.js.map