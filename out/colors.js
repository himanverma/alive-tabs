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
exports.ActiveTabColorizer = void 0;
const vscode = __importStar(require("vscode"));
const pure_1 = require("./pure");
const MANAGED_COLOR_KEYS = [
    'tab.activeBackground',
    'tab.activeForeground',
    'tab.activeBorderTop',
    'tab.activeBorder',
];
/**
 * Optional `workbench.colorCustomizations` sync for active-tab theme tokens.
 *
 * Since `TabDecorationProvider` now colors all tabs (both active and inactive)
 * without touching `.vscode/settings.json`, `alivetabs.colorActiveTab` defaults
 * to `false`, and any stale `tab.active*` keys left by v0.1.0 are cleaned up.
 */
class ActiveTabColorizer {
    tabs;
    state;
    static TRACK_KEY = 'alivetabs.managedColorCustomizations';
    applied;
    disposables = [];
    constructor(tabs, state) {
        this.tabs = tabs;
        this.state = state;
        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(() => void this.refresh()), vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('alivetabs.colorActiveTab'))
                void this.refresh();
        }), this.tabs.onDidChange(() => void this.refresh()));
        void this.refresh();
    }
    enabled() {
        return vscode.workspace
            .getConfiguration('alivetabs')
            .get('colorActiveTab', false);
    }
    markForActiveEditor() {
        const doc = vscode.window.activeTextEditor?.document;
        if (!doc || doc.uri.scheme !== 'file')
            return {};
        return this.tabs.get(doc.uri) ?? {};
    }
    /**
     * Keys we actually wrote, so refresh never deletes `tab.active*` entries the
     * user set by hand. Legacy value was a boolean: `true` (or absent) means a
     * v0.1.x/v0.2.0 install may have written all four keys — clean them once.
     */
    managedKeys() {
        const raw = this.state.get(ActiveTabColorizer.TRACK_KEY);
        if (Array.isArray(raw))
            return new Set(raw.filter((x) => typeof x === 'string'));
        return new Set(raw === false ? [] : [...MANAGED_COLOR_KEYS]);
    }
    async refresh() {
        if (!vscode.workspace.workspaceFolders?.length)
            return;
        const enabled = this.enabled();
        const managed = this.managedKeys();
        if (!enabled && managed.size === 0)
            return;
        const cfg = vscode.workspace.getConfiguration('workbench');
        const inspect = cfg.inspect('colorCustomizations');
        const before = { ...(inspect?.workspaceValue ?? {}) };
        const colors = { ...before };
        for (const k of managed)
            delete colors[k];
        managed.clear();
        const { color } = enabled ? this.markForActiveEditor() : {};
        if (color) {
            colors['tab.activeBackground'] = color;
            colors['tab.activeForeground'] = (0, pure_1.contrastColor)(color);
            colors['tab.activeBorderTop'] = color;
            colors['tab.activeBorder'] = color;
            for (const k of MANAGED_COLOR_KEYS)
                managed.add(k);
        }
        await this.state.update(ActiveTabColorizer.TRACK_KEY, [...managed]);
        const next = JSON.stringify(colors);
        if (next === this.applied || next === JSON.stringify(before))
            return;
        this.applied = next;
        const nextValue = Object.keys(colors).length > 0 ? colors : undefined;
        await cfg.update('colorCustomizations', nextValue, vscode.ConfigurationTarget.Workspace);
    }
    dispose() {
        for (const d of this.disposables)
            d.dispose();
    }
}
exports.ActiveTabColorizer = ActiveTabColorizer;
//# sourceMappingURL=colors.js.map