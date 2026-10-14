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
exports.LabelSync = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
/**
 * Optional sync to `workbench.editor.customLabels.patterns`.
 *
 * By default (`alivetabs.useCustomLabels = false`), flags are rendered directly
 * by `TabDecorationProvider` so `.vscode/settings.json` stays untouched.
 * This class also cleans up any legacy `customLabels.patterns` entries written
 * by earlier versions of Alive TABs (which used `${filename}` without `.${extname}`).
 */
class LabelSync {
    tabs;
    state;
    static MANAGED_KEY = 'alivetabs.managedPatterns';
    static LEGACY_KEY = 'alivetabs.legacyPatternsCleaned';
    managedPatterns;
    syncing = false;
    disposables = [];
    constructor(tabs, state) {
        this.tabs = tabs;
        this.state = state;
        this.managedPatterns = new Set(state.get(LabelSync.MANAGED_KEY, []));
        this.disposables.push(this.tabs.onDidChange(() => void this.sync()), vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('alivetabs.useCustomLabels') ||
                e.affectsConfiguration('alivetabs.flagPosition')) {
                void this.sync();
            }
        }));
    }
    currentPatterns() {
        const cfg = vscode.workspace.getConfiguration('workbench.editor.customLabels');
        const inspect = cfg.inspect('patterns');
        return { ...(inspect?.workspaceValue ?? {}) };
    }
    relativePattern(uri) {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (!folder)
            return undefined;
        const multi = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
        const rel = vscode.workspace.asRelativePath(uri, multi);
        const escaped = rel
            .split(path.sep)
            .join('/')
            .replace(/[\\*?[\]{}(),!+@]/g, '\\$&');
        return `**/${escaped}`;
    }
    /** Build a customLabels template that preserves the file extension. */
    buildTemplate(uri, flag, pos) {
        const base = path.posix.basename(uri.path);
        const stripped = base.replace(/^\.+/, '');
        const hasExt = stripped.includes('.');
        const nameToken = hasExt ? '${filename}.${extname}' : '${filename}';
        return pos === 'prefix' ? `${flag} ${nameToken}` : `${nameToken} ${flag}`;
    }
    async sync() {
        if (this.syncing || !vscode.workspace.workspaceFolders?.length)
            return;
        this.syncing = true;
        try {
            const before = this.currentPatterns();
            const patterns = { ...before };
            for (const key of this.managedPatterns)
                delete patterns[key];
            // One-time cleanup of legacy v0.1.0 entries (`**/...` -> `${filename} <flag>`).
            // Runs only once so hand-written user patterns that happen to match the
            // same shape are never deleted on subsequent syncs.
            if (!this.state.get(LabelSync.LEGACY_KEY)) {
                for (const [k, v] of Object.entries(patterns)) {
                    if (k.startsWith('**/') &&
                        typeof v === 'string' &&
                        (/^\$\{filename\}(\.\$\{extname\})?\s+\S+$/.test(v) ||
                            /^\S+\s+\$\{filename\}(\.\$\{extname\})?$/.test(v))) {
                        delete patterns[k];
                    }
                }
                await this.state.update(LabelSync.LEGACY_KEY, true);
            }
            this.managedPatterns.clear();
            const cfg = vscode.workspace.getConfiguration('alivetabs');
            const useCustomLabels = cfg.get('useCustomLabels', false);
            const flagPosition = cfg.get('flagPosition', 'suffix');
            if (useCustomLabels) {
                for (const [uri, mark] of this.tabs.entries()) {
                    if (uri.scheme !== 'file' || !mark.flag)
                        continue;
                    const pattern = this.relativePattern(uri);
                    if (!pattern)
                        continue;
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
        }
        finally {
            this.syncing = false;
        }
    }
    dispose() {
        for (const d of this.disposables)
            d.dispose();
    }
}
exports.LabelSync = LabelSync;
//# sourceMappingURL=labels.js.map