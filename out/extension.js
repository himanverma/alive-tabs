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
exports.activate = activate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const state_1 = require("./state");
const labels_1 = require("./labels");
const colors_1 = require("./colors");
const decorations_1 = require("./decorations");
const server_1 = require("./server");
const deepmode_1 = require("./deepmode");
const pure_1 = require("./pure");
const PRESETS = [
    { name: 'Urgent / Bug', flag: '🔴', color: '#e11d48' },
    { name: 'In Progress', flag: '🟠', color: '#ea580c' },
    { name: 'Needs Review', flag: '🟡', color: '#d97706' },
    { name: 'Done / Verified', flag: '🟢', color: '#16a34a' },
    { name: 'Reference / Docs', flag: '🔵', color: '#2563eb' },
    { name: 'Core / Important', flag: '🟣', color: '#7c3aed' },
    { name: 'Flagged', flag: '🚩', color: '#06b6d4' },
    { name: 'Starred', flag: '⭐', color: '#eab308' },
    { name: 'Pinned', flag: '📌', color: '#db2777' },
];
const FLAGS = [
    { name: 'Red', emoji: '🔴' },
    { name: 'Orange', emoji: '🟠' },
    { name: 'Yellow', emoji: '🟡' },
    { name: 'Green', emoji: '🟢' },
    { name: 'Blue', emoji: '🔵' },
    { name: 'Purple', emoji: '🟣' },
    { name: 'Flag', emoji: '🚩' },
    { name: 'Star', emoji: '⭐' },
    { name: 'Pin', emoji: '📌' },
    { name: 'Hot / Fire', emoji: '🔥' },
    { name: 'Fast / Key', emoji: '⚡' },
    { name: 'Test / Lab', emoji: '🧪' },
];
const COLORS = [
    { name: 'Crimson', color: '#e11d48' },
    { name: 'Orange', color: '#ea580c' },
    { name: 'Amber', color: '#d97706' },
    { name: 'Gold', color: '#eab308' },
    { name: 'Lime', color: '#65a30d' },
    { name: 'Green', color: '#16a34a' },
    { name: 'Teal', color: '#0d9488' },
    { name: 'Cyan', color: '#06b6d4' },
    { name: 'Blue', color: '#2563eb' },
    { name: 'Violet', color: '#7c3aed' },
    { name: 'Pink', color: '#db2777' },
    { name: 'Slate', color: '#475569' },
];
function colorNameOf(hex) {
    if (!hex)
        return undefined;
    const lower = hex.toLowerCase();
    return COLORS.find((c) => c.color.toLowerCase() === lower)?.name ?? hex;
}
/** User-defined presets from `alivetabs.presets` settings (validated). */
function userPresets() {
    const raw = vscode.workspace.getConfiguration('alivetabs').get('presets', []);
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const r of raw) {
        if (!r || typeof r !== 'object')
            continue;
        const o = r;
        const name = typeof o.name === 'string' ? o.name.trim() : '';
        const flag = typeof o.flag === 'string' && o.flag.length <= 10 ? o.flag : undefined;
        const color = typeof o.color === 'string' ? (0, pure_1.sanitizeHex)(o.color) : undefined;
        if (name && flag && color)
            out.push({ name, flag, color });
    }
    return out;
}
/** Human-friendly display name for any tab URI (files, Claude Code webviews, Cascade agent tabs, etc.). */
function displayNameFor(uri, storedLabel) {
    if (storedLabel)
        return storedLabel;
    if (uri.scheme === 'file' || uri.scheme === 'untitled') {
        return path.posix.basename(uri.path) || uri.path;
    }
    const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    if (activeTab?.label) {
        const input = activeTab.input;
        if (uri.scheme === 'webview-panel' && typeof input?.viewType === 'string') {
            const vt = input.viewType.replace(/^mainThreadWebview-/, '');
            if (uri.path.includes(vt))
                return activeTab.label;
        }
        else if (uri.scheme === 'vscode-cascade-editor' && !input) {
            return activeTab.label;
        }
    }
    if (uri.path.includes('claudeVSCodePanel'))
        return 'Claude Code';
    if (uri.scheme === 'vscode-cascade-editor')
        return 'Agent Session';
    return path.posix.basename(uri.path) || uri.toString();
}
/** Scan command arguments for a Uri (supports any scheme: file, webview-panel, vscode-cascade-editor, etc.). */
function findUriInArgs(args, depth = 0) {
    if (depth > 2)
        return undefined;
    for (const a of args) {
        if (a instanceof vscode.Uri)
            return a;
        if (Array.isArray(a)) {
            const found = findUriInArgs(a, depth + 1);
            if (found)
                return found;
        }
        else if (a && typeof a === 'object') {
            const o = a;
            for (const key of ['uri', 'resource', 'editor', 'input']) {
                if (o[key] instanceof vscode.Uri)
                    return o[key];
                if (o[key] && typeof o[key] === 'object') {
                    const found = findUriInArgs([o[key]], depth + 1);
                    if (found)
                        return found;
                }
            }
        }
    }
    return undefined;
}
function resolveTarget(args, decorations, tabs) {
    const fromArgs = findUriInArgs(args);
    if (fromArgs) {
        const existing = tabs.get(fromArgs)?.label;
        const label = fromArgs.scheme === 'file' ? undefined : displayNameFor(fromArgs, existing);
        return { uri: fromArgs, label };
    }
    return decorations.resolveActiveTab();
}
let overviewPanel;
async function activate(context) {
    const tabs = new state_1.TabState(context.workspaceState);
    const decorations = new decorations_1.TabDecorationProvider(tabs);
    const labels = new labels_1.LabelSync(tabs, context.workspaceState);
    const colorizer = new colors_1.ActiveTabColorizer(tabs, context.workspaceState);
    const deep = new deepmode_1.DeepMode(context);
    const server = new server_1.ConfigServer(tabs);
    const statusBar = createStatusBar(tabs, decorations);
    context.subscriptions.push(tabs, decorations, labels, colorizer, server, statusBar);
    const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
    reg('alivetabs.setPreset', async (...args) => {
        const target = resolveTarget(args, decorations, tabs);
        if (!target)
            return vscode.window.showWarningMessage('Alive TABs: no tab selected.');
        const { uri, label, viewType } = target;
        const cur = tabs.get(uri);
        const titleName = displayNameFor(uri, label ?? cur?.label);
        const items = [...PRESETS, ...userPresets()].map((p) => {
            const isCurrent = cur?.flag === p.flag && cur?.color?.toLowerCase() === p.color;
            return {
                label: `${p.flag}  ${p.name}`,
                description: isCurrent ? `${p.color}  (current)` : p.color,
                flag: p.flag,
                color: p.color,
            };
        });
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator }, { label: '$(flag) Set Flag Only…', action: 'flag' }, { label: '$(symbol-color) Set Tab Color Only…', action: 'color' }, { label: '$(clear-all) Clear Flag & Color', action: 'clear' });
        const pick = await vscode.window.showQuickPick(items, {
            title: `Alive TABs Preset — ${titleName}`,
            placeHolder: 'Pick a flag + color preset',
        });
        if (!pick)
            return;
        if (pick.action === 'flag')
            return vscode.commands.executeCommand('alivetabs.setFlag', uri);
        if (pick.action === 'color')
            return vscode.commands.executeCommand('alivetabs.setColor', uri);
        if (pick.action === 'clear')
            return tabs.clear(uri);
        if (pick.flag && pick.color) {
            await tabs.set(uri, {
                flag: pick.flag,
                color: pick.color,
                ...(label ? { label } : {}),
                ...(viewType ? { viewType } : {}),
            });
        }
    });
    reg('alivetabs.setFlag', async (...args) => {
        const target = resolveTarget(args, decorations, tabs);
        if (!target)
            return vscode.window.showWarningMessage('Alive TABs: no tab selected.');
        const { uri, label, viewType } = target;
        const cur = tabs.get(uri);
        const titleName = displayNameFor(uri, label ?? cur?.label);
        const items = FLAGS.map((f) => ({
            label: `${f.emoji}  ${f.name}`,
            description: cur?.flag === f.emoji ? '(current)' : undefined,
            emoji: f.emoji,
        }));
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator }, {
            label: '$(pencil) Custom flag…',
            description: 'any emoji or short tag (e.g. WIP, TODO, BUG)',
            action: 'custom',
        }, { label: '$(close) Remove flag', description: 'clear the flag only', action: 'remove' });
        const pick = await vscode.window.showQuickPick(items, {
            title: `Flag for ${titleName}`,
            placeHolder: 'Pick a flag',
        });
        if (!pick)
            return;
        if (pick.action === 'remove')
            return tabs.set(uri, { flag: undefined });
        let emoji = pick.emoji;
        if (pick.action === 'custom') {
            emoji = (await vscode.window.showInputBox({
                title: 'Custom Flag',
                prompt: 'Enter an emoji or short label (up to 10 characters)',
                value: cur?.flag ?? '',
                validateInput: (v) => v.trim().length > 10 ? 'Keep it to 10 characters or less' : undefined,
            }))?.trim();
            if (!emoji)
                return;
        }
        if (emoji)
            await tabs.set(uri, { flag: emoji, ...(label ? { label } : {}), ...(viewType ? { viewType } : {}) });
    });
    reg('alivetabs.setColor', async (...args) => {
        const target = resolveTarget(args, decorations, tabs);
        if (!target)
            return vscode.window.showWarningMessage('Alive TABs: no tab selected.');
        const { uri, label, viewType } = target;
        const cur = tabs.get(uri);
        const titleName = displayNameFor(uri, label ?? cur?.label);
        const items = COLORS.map((c) => {
            const isCurrent = cur?.color?.toLowerCase() === c.color.toLowerCase();
            return {
                label: `$(circle-filled) ${c.name}`,
                description: isCurrent ? `${c.color}  (current)` : c.color,
                color: c.color,
            };
        });
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator }, { label: '$(pencil) Custom hex…', description: 'e.g. #ff8800 or #f80', action: 'custom' }, { label: '$(close) Remove color', description: 'clear the color only', action: 'remove' });
        const pick = await vscode.window.showQuickPick(items, {
            title: `Tab Color for ${titleName}`,
            placeHolder: 'Pick a tab color',
        });
        if (!pick)
            return;
        if (pick.action === 'remove')
            return tabs.set(uri, { color: undefined });
        let color = pick.color;
        if (pick.action === 'custom') {
            const raw = (await vscode.window.showInputBox({
                title: 'Custom Tab Color',
                prompt: 'Hex color (#rrggbb or #rgb)',
                value: cur?.color ?? '#',
                validateInput: (v) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())
                    ? undefined
                    : 'Enter a 3- or 6-digit hex color (e.g. #ff8800)',
            }))?.trim();
            if (!raw)
                return;
            const clean = raw.replace(/^#/, '');
            color =
                clean.length === 3
                    ? `#${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`.toLowerCase()
                    : `#${clean.toLowerCase()}`;
        }
        if (color)
            await tabs.set(uri, { color, ...(label ? { label } : {}), ...(viewType ? { viewType } : {}) });
    });
    reg('alivetabs.switchTabStyle', async () => {
        const cfg = vscode.workspace.getConfiguration('alivetabs');
        const cur = cfg.get('tabStyle', 'tinted');
        const styles = [
            {
                label: '$(sparkle) Tinted (Neon Glow)',
                style: 'tinted',
                detail: 'Translucent color fill + glowing border (matches the Alive TABs icon).',
                description: cur === 'tinted' ? '(current)' : undefined,
            },
            {
                label: '$(symbol-color) Full Fill',
                style: 'full',
                detail: 'Solid vibrant background fill with high-contrast text.',
                description: cur === 'full' ? '(current)' : undefined,
            },
            {
                label: '$(layout-panel) Border & Label',
                style: 'border',
                detail: 'Colored top/bottom accent bar + colored filename.',
                description: cur === 'border' ? '(current)' : undefined,
            },
        ];
        const pick = await vscode.window.showQuickPick(styles, {
            title: 'Alive TABs: Tab Color Style',
            placeHolder: 'Select how colored tabs are rendered',
        });
        if (!pick)
            return;
        const target = vscode.workspace.workspaceFolders?.length
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
        await cfg.update('tabStyle', pick.style, target);
    });
    reg('alivetabs.clear', async (...args) => {
        const target = resolveTarget(args, decorations, tabs);
        if (target)
            await tabs.clear(target.uri);
    });
    reg('alivetabs.clearAll', async () => {
        const n = tabs.entries().length;
        if (n === 0)
            return vscode.window.showInformationMessage('Alive TABs: nothing to clear.');
        const yes = await vscode.window.showWarningMessage(`Clear flags and colors on ${n} tab${n === 1 ? '' : 's'}?`, { modal: true }, 'Clear');
        if (yes === 'Clear')
            await tabs.clearAll();
    });
    reg('alivetabs.showOverview', () => showOverview(tabs, decorations));
    reg('alivetabs.enableDeepMode', async () => {
        const ok = await deep.install();
        if (ok) {
            const r = await vscode.window.showInformationMessage('Deep mode installed. Reload the window to activate.', 'Reload Window');
            if (r === 'Reload Window')
                vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    });
    reg('alivetabs.disableDeepMode', async () => {
        const ok = await deep.uninstall();
        if (ok) {
            const r = await vscode.window.showInformationMessage('Deep mode removed. Reload the window to finish.', 'Reload Window');
            if (r === 'Reload Window')
                vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    });
    // Background startup work — intentionally not awaited so commands register fast.
    void labels.sync();
    void server.start().catch(() => {
        // Deep mode config server is optional.
    });
    void tabs.pruneMissingFiles();
}
function createStatusBar(tabs, decorations) {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    item.command = 'alivetabs.showOverview';
    const update = () => {
        const show = vscode.workspace
            .getConfiguration('alivetabs')
            .get('showStatusBarItem', true);
        if (!show) {
            item.hide();
            return;
        }
        const count = tabs.entries().length;
        const activeUri = decorations.resolveActiveTab()?.uri;
        const activeMark = activeUri ? tabs.get(activeUri) : undefined;
        if (activeMark && (activeMark.flag || activeMark.color)) {
            const badge = activeMark.flag ?? '$(symbol-color)';
            const cname = colorNameOf(activeMark.color);
            item.text = `${badge} ${cname ?? 'Flagged'}${count > 1 ? ` (${count})` : ''}`;
            item.tooltip = `Alive TABs — Active tab: ${[
                activeMark.flag && `Flag ${activeMark.flag}`,
                cname && `Color ${cname}`,
            ]
                .filter(Boolean)
                .join(', ')}\nClick to open Alive TABs overview (${count} marked)`;
        }
        else if (count > 0) {
            item.text = `$(symbol-color) Alive TABs (${count})`;
            item.tooltip = `Alive TABs — ${count} marked tab${count === 1 ? '' : 's'} (click to view)`;
        }
        else {
            item.text = `$(symbol-color) Alive TABs`;
            item.tooltip = 'Alive TABs — Right-click any tab or click here to open overview';
        }
        item.show();
    };
    const subs = [
        tabs.onDidChange(update),
        vscode.window.onDidChangeActiveTextEditor(update),
        vscode.window.tabGroups.onDidChangeTabs(update),
        vscode.window.tabGroups.onDidChangeTabGroups(update),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('alivetabs.showStatusBarItem'))
                update();
        }),
    ];
    update();
    return {
        dispose() {
            item.dispose();
            for (const s of subs)
                s.dispose();
        },
    };
}
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function getNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++)
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    return nonce;
}
function showOverview(tabs, decorations) {
    if (overviewPanel) {
        overviewPanel.reveal(vscode.ViewColumn.Beside);
        return;
    }
    const panel = vscode.window.createWebviewPanel('alivetabs.overview', 'Alive TABs', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    overviewPanel = panel;
    const nonce = getNonce();
    const render = () => {
        const entries = tabs.entries();
        const tabStyle = vscode.workspace
            .getConfiguration('alivetabs')
            .get('tabStyle', 'tinted');
        // Open file tabs that match an `alivetabs.rules` glob but have no stored
        // mark — shown as `auto` rows so rule effects are visible at a glance.
        const storedKeys = new Set(entries.map(([u]) => u.toString()));
        const autoRows = vscode.window.tabGroups.all
            .flatMap((g) => g.tabs)
            .map((t) => t.input?.uri)
            .filter((u) => u instanceof vscode.Uri && u.scheme === 'file')
            .filter((u) => !storedKeys.has(u.toString()))
            .map((u) => ({ uri: u, mark: decorations.matchRule(u) }))
            .filter((e) => !!e.mark)
            .map(({ uri, mark: m }) => {
            const rel = vscode.workspace.asRelativePath(uri, false);
            const base = path.posix.basename(uri.path);
            const dir = path.posix.dirname(rel);
            const uriStr = escapeHtml(uri.toString());
            const flagHtml = m.flag
                ? `<span class="flag-pill">${escapeHtml(m.flag)}</span>`
                : `<span class="muted">—</span>`;
            const colorHtml = m.color
                ? `<span class="color-chip"><span class="sw" style="background:${escapeHtml(m.color)}"></span>${escapeHtml(colorNameOf(m.color) ?? m.color)}</span>`
                : `<span class="muted">—</span>`;
            return `<tr class="auto">
          <td class="col-flag">${flagHtml}</td>
          <td class="col-color">${colorHtml}</td>
          <td class="col-file">
            <a href="#" class="file-link" data-cmd="open" data-uri="${uriStr}">
              <strong>${escapeHtml(base)}</strong>
              ${dir && dir !== '.' ? `<span class="dir">${escapeHtml(dir)}</span>` : ''}
            </a>
            <span class="badge auto-badge">auto</span>
          </td>
          <td class="col-actions">
            <button data-cmd="flag" data-uri="${uriStr}" title="Set Flag">Flag</button>
            <button data-cmd="color" data-uri="${uriStr}" title="Set Color">Color</button>
          </td>
        </tr>`;
        })
            .join('');
        const rows = entries
            .map(([uri, m]) => {
            const isFile = uri.scheme === 'file';
            const rel = isFile ? vscode.workspace.asRelativePath(uri, false) : '';
            const base = isFile ? path.posix.basename(uri.path) : displayNameFor(uri, m.label);
            const dir = isFile ? path.posix.dirname(rel) : uri.scheme;
            const uriStr = escapeHtml(uri.toString());
            const flagHtml = m.flag
                ? `<span class="flag-pill">${escapeHtml(m.flag)}</span>`
                : `<span class="muted">—</span>`;
            const colorHtml = m.color
                ? `<span class="color-chip"><span class="sw" style="background:${escapeHtml(m.color)}"></span>${escapeHtml(colorNameOf(m.color) ?? m.color)}</span>`
                : `<span class="muted">—</span>`;
            return `<tr>
          <td class="col-flag">${flagHtml}</td>
          <td class="col-color">${colorHtml}</td>
          <td class="col-file">
            <a href="#" class="file-link" data-cmd="open" data-uri="${uriStr}">
              <strong>${escapeHtml(base)}</strong>
              ${dir && dir !== '.' ? `<span class="dir">${escapeHtml(dir)}</span>` : ''}
            </a>
          </td>
          <td class="col-actions">
            <button data-cmd="flag" data-uri="${uriStr}" title="Change Flag">Flag</button>
            <button data-cmd="color" data-uri="${uriStr}" title="Change Color">Color</button>
            <button class="danger" data-cmd="clear" data-uri="${uriStr}" title="Clear">✕</button>
          </td>
        </tr>`;
        })
            .join('');
        panel.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        padding: 16px 20px;
        line-height: 1.5;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
      }
      .header h2 {
        margin: 0;
        font-size: 16px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .badge {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
      }
      .toolbar {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      button {
        background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
        border: 1px solid transparent;
        border-radius: 4px;
        padding: 4px 10px;
        font-size: 12px;
        cursor: pointer;
      }
      button:hover {
        background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.35));
      }
      button.primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      button.primary:hover {
        background: var(--vscode-button-hoverBackground);
      }
      button.danger:hover {
        background: rgba(225, 29, 72, 0.25);
        color: #fda4af;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th {
        text-align: left;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        opacity: 0.7;
        padding: 6px 8px;
        border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
      }
      td {
        padding: 8px;
        border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.12));
        vertical-align: middle;
      }
      tr:hover td {
        background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.08));
      }
      .flag-pill {
        font-size: 15px;
      }
      .color-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
      }
      .sw {
        display: inline-block;
        width: 14px;
        height: 14px;
        border-radius: 4px;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.25);
      }
      .file-link {
        color: var(--vscode-textLink-foreground);
        text-decoration: none;
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .file-link:hover strong {
        text-decoration: underline;
      }
      .dir {
        font-size: 11px;
        opacity: 0.6;
      }
      .muted {
        opacity: 0.4;
      }
      .col-actions {
        text-align: right;
        white-space: nowrap;
      }
      .col-actions button {
        padding: 2px 8px;
        margin-left: 4px;
      }
      tr.auto td {
        opacity: 0.75;
      }
      .auto-badge {
        margin-left: 8px;
      }
      .empty {
        text-align: center;
        padding: 36px 16px;
        opacity: 0.75;
      }
    </style></head><body>
      <div class="header">
        <h2>
          Alive TABs
          <span class="badge">${entries.length} marked</span>
          <span class="badge">Style: ${escapeHtml(tabStyle)}</span>
        </h2>
        <div class="toolbar">
          <button class="primary" data-cmd="presetActive">+ Mark Active Tab</button>
          <button data-cmd="switchStyle">Tab Style</button>
          ${entries.length ? `<button class="danger" data-cmd="clearAll">Clear All</button>` : ''}
        </div>
      </div>
      ${rows || autoRows
            ? `<table>
              <thead>
                <tr><th>Flag</th><th>Color</th><th>Tab / File</th><th style="text-align:right">Actions</th></tr>
              </thead>
              <tbody>${rows}${autoRows}</tbody>
            </table>`
            : `<div class="empty">
              <p>No flagged or colored tabs in this workspace yet.</p>
              <p>Right-click any editor tab (including Claude Code &amp; Agent tabs) or Explorer file → <strong>Alive TABs</strong>.</p>
            </div>`}
      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.addEventListener('click', (e) => {
          const el = e.target.closest('[data-cmd]');
          if (!el) return;
          e.preventDefault();
          vscode.postMessage({ cmd: el.dataset.cmd, uri: el.dataset.uri });
        });
      </script>
    </body></html>`;
    };
    render();
    const sub = tabs.onDidChange(render);
    const cfgSub = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('alivetabs.tabStyle') ||
            e.affectsConfiguration('alivetabs.rules'))
            render();
    });
    const tabsSub = vscode.window.tabGroups.onDidChangeTabs(render);
    panel.onDidDispose(() => {
        overviewPanel = undefined;
        sub.dispose();
        cfgSub.dispose();
        tabsSub.dispose();
    });
    panel.webview.onDidReceiveMessage(async (m) => {
        if (m.cmd === 'presetActive') {
            await vscode.commands.executeCommand('alivetabs.setPreset');
        }
        else if (m.cmd === 'switchStyle') {
            await vscode.commands.executeCommand('alivetabs.switchTabStyle');
        }
        else if (m.cmd === 'clearAll') {
            await vscode.commands.executeCommand('alivetabs.clearAll');
        }
        else if (m.uri) {
            const uri = vscode.Uri.parse(m.uri);
            if (m.cmd === 'open') {
                if (uri.scheme === 'file' || uri.scheme === 'untitled') {
                    await vscode.commands.executeCommand('vscode.open', uri);
                }
                else if (uri.path.includes('claudeVSCodePanel')) {
                    await vscode.commands.executeCommand('claude-vscode.focus');
                }
                else {
                    const name = displayNameFor(uri, tabs.get(uri)?.label);
                    void vscode.window.showInformationMessage(`Alive TABs: can't reopen "${name}" — reopen that tab manually.`);
                }
            }
            else if (m.cmd === 'flag') {
                await vscode.commands.executeCommand('alivetabs.setFlag', uri);
            }
            else if (m.cmd === 'color') {
                await vscode.commands.executeCommand('alivetabs.setColor', uri);
            }
            else if (m.cmd === 'clear') {
                await tabs.clear(uri);
            }
        }
    });
}
//# sourceMappingURL=extension.js.map