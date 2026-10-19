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
exports.TabState = void 0;
const vscode = __importStar(require("vscode"));
/** Per-workspace store of tab decorations, keyed by normalized URI string. */
class TabState {
    state;
    static KEY = 'alivetabs.marks';
    marks = new Map();
    emitter = new vscode.EventEmitter();
    onDidChange = this.emitter.event;
    disposables = [];
    constructor(state) {
        this.state = state;
        const raw = state.get(TabState.KEY, {});
        for (const [k, v] of Object.entries(raw)) {
            if (v && (v.flag || v.color))
                this.marks.set(k, v);
        }
        this.disposables.push(vscode.workspace.onDidRenameFiles((e) => void this.handleRenames(e.files)), vscode.workspace.onDidDeleteFiles((e) => void this.handleDeletes(e.files)));
    }
    get(uri) {
        return this.marks.get(uri.toString());
    }
    hasKey(key) {
        return this.marks.has(key);
    }
    /** Raw `[key, mark]` pairs — keys are already-normalized URI strings. */
    rawEntries() {
        return [...this.marks.entries()];
    }
    async set(uri, patch) {
        const key = uri.toString();
        const next = { ...this.marks.get(key), ...patch, ts: Date.now() };
        if (!next.flag)
            delete next.flag;
        if (!next.color)
            delete next.color;
        if (!next.label)
            delete next.label;
        if (!next.viewType)
            delete next.viewType;
        if (!next.migratedFrom)
            delete next.migratedFrom;
        if (!next.flag && !next.color)
            this.marks.delete(key);
        else
            this.marks.set(key, next);
        await this.persist([uri]);
    }
    async clear(uri) {
        if (!this.marks.delete(uri.toString()))
            return;
        await this.persist([uri]);
    }
    async clearAll() {
        const affected = this.entries().map(([u]) => u);
        this.marks.clear();
        await this.persist(affected.length ? affected : undefined);
    }
    /** Move a mark from a stale key to a live URI (save-as, re-opened panels). */
    async migrate(fromKey, to, patch = {}) {
        const mark = this.marks.get(fromKey);
        if (!mark || this.marks.has(to.toString()))
            return false;
        this.marks.delete(fromKey);
        const next = { ...mark, ...patch, migratedFrom: fromKey };
        if (!next.tabSlot)
            delete next.tabSlot;
        this.marks.set(to.toString(), next);
        await this.persist([vscode.Uri.parse(fromKey), to]);
        return true;
    }
    /** Drop file marks whose target no longer exists on disk. */
    async pruneMissingFiles() {
        const dead = [];
        for (const key of [...this.marks.keys()]) {
            const uri = vscode.Uri.parse(key);
            if (uri.scheme !== 'file')
                continue;
            try {
                await vscode.workspace.fs.stat(uri);
            }
            catch (e) {
                const code = e.code;
                if (code === 'FileNotFound' || (e instanceof Error && /ENOENT/i.test(e.message))) {
                    this.marks.delete(key);
                    dead.push(uri);
                }
            }
        }
        if (dead.length)
            await this.persist(dead);
        return dead.length;
    }
    entries() {
        return [...this.marks.entries()].map(([k, v]) => [vscode.Uri.parse(k), v]);
    }
    /** Config snapshot consumed by the deep-mode injected runtime. */
    toConfig(workspaceFolders) {
        const cfg = vscode.workspace.getConfiguration('alivetabs');
        const tabStyle = cfg.get('tabStyle', 'tinted');
        const flagPosition = cfg.get('flagPosition', 'suffix');
        const roots = workspaceFolders.map((f) => f.uri.fsPath);
        const rawRules = cfg.get('rules', []);
        const rules = Array.isArray(rawRules)
            ? rawRules
                .map((r) => {
                if (!r || typeof r !== 'object')
                    return undefined;
                const o = r;
                const pattern = typeof o.pattern === 'string' ? o.pattern : '';
                const flag = typeof o.flag === 'string' && o.flag ? o.flag : undefined;
                const color = typeof o.color === 'string' ? o.color : undefined;
                return pattern && (flag || color) ? { pattern, flag, color } : undefined;
            })
                .filter((r) => r !== undefined)
            : [];
        const tabs = [];
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
    async handleRenames(files) {
        const changed = [];
        for (const { oldUri, newUri } of files) {
            const oldStr = oldUri.toString();
            const oldPrefix = oldStr.endsWith('/') ? oldStr : oldStr + '/';
            for (const [k, v] of [...this.marks.entries()]) {
                if (k === oldStr) {
                    this.marks.delete(k);
                    this.marks.set(newUri.toString(), v);
                    changed.push(oldUri, newUri);
                }
                else if (k.startsWith(oldPrefix)) {
                    const suffix = k.slice(oldStr.length);
                    const target = vscode.Uri.parse(newUri.toString() + suffix);
                    this.marks.delete(k);
                    this.marks.set(target.toString(), v);
                    changed.push(vscode.Uri.parse(k), target);
                }
            }
        }
        if (changed.length)
            await this.persist(changed);
    }
    async handleDeletes(files) {
        const changed = [];
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
        if (changed.length)
            await this.persist(changed);
    }
    async persist(uris) {
        await this.state.update(TabState.KEY, Object.fromEntries(this.marks));
        this.emitter.fire(uris);
    }
    dispose() {
        this.emitter.dispose();
        for (const d of this.disposables)
            d.dispose();
    }
}
exports.TabState = TabState;
//# sourceMappingURL=state.js.map