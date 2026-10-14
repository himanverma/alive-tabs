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
exports.DeepMode = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const HTML_MARKER = './alivetabs.js';
/** Node script (runs as root) that installs the runtime + script tag and
 *  refreshes the product checksum so the IDE doesn't flag itself corrupt. */
const PATCH_MJS = `import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [appRoot, payloadDir] = process.argv.slice(2);
if (!appRoot || !payloadDir) { console.error('usage: patch.mjs <appRoot> <payloadDir>'); process.exit(2); }

const wbDir = path.join(appRoot, 'out/vs/code/electron-browser/workbench');
const htmlPath = path.join(wbDir, 'workbench.html');
const htmlBak = htmlPath + '.alivetabs.bak';
const jsSrc = path.join(payloadDir, 'alivetabs.js');
const jsDst = path.join(wbDir, 'alivetabs.js');
const productPath = path.join(appRoot, 'product.json');
const productBak = productPath + '.alivetabs.bak';

if (!fs.existsSync(htmlPath)) { console.error('workbench.html not found at ' + htmlPath); process.exit(1); }

if (!fs.existsSync(htmlBak)) fs.copyFileSync(htmlPath, htmlBak);
fs.copyFileSync(jsSrc, jsDst);

let html = fs.readFileSync(htmlPath, 'utf8');
const tag = '<script src="${HTML_MARKER}"></script>';
if (!html.includes('${HTML_MARKER}')) {
  html = html.replace('</html>', '\\t' + tag + '\\n</html>');
  fs.writeFileSync(htmlPath, html);
}

if (!fs.existsSync(productBak)) fs.copyFileSync(productPath, productBak);
const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
product.checksums = product.checksums || {};
product.checksums['vs/code/electron-browser/workbench/workbench.html'] =
  crypto.createHash('sha256').update(fs.readFileSync(htmlPath)).digest('base64');
fs.writeFileSync(productPath, JSON.stringify(product, null, '\\t') + '\\n');

console.log('AliveTABs deep mode installed. Restart the IDE to activate.');
`;
const UNPATCH_MJS = `import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [appRoot] = process.argv.slice(2);
if (!appRoot) { console.error('usage: unpatch.mjs <appRoot>'); process.exit(2); }

const wbDir = path.join(appRoot, 'out/vs/code/electron-browser/workbench');
const htmlPath = path.join(wbDir, 'workbench.html');
const productPath = path.join(appRoot, 'product.json');
const jsPath = path.join(wbDir, 'alivetabs.js');
const tag = '${HTML_MARKER}';

// Remove only our script tag from the *current* workbench.html and refresh that
// single checksum — never restore the .bak files, which would roll back any IDE
// update installed after the patch.
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  if (html.includes(tag)) {
    const next = html
      .split('\\n')
      .filter((l) => !l.includes(tag))
      .join('\\n');
    fs.writeFileSync(htmlPath, next);
    if (fs.existsSync(productPath)) {
      const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
      if (product.checksums) {
        product.checksums['vs/code/electron-browser/workbench/workbench.html'] =
          crypto.createHash('sha256').update(fs.readFileSync(htmlPath)).digest('base64');
        fs.writeFileSync(productPath, JSON.stringify(product, null, '\\t') + '\\n');
      }
    }
    console.log('Removed AliveTABs script tag.');
  } else {
    console.log('No AliveTABs patch found in workbench.html.');
  }
} else {
  console.error('workbench.html not found at ' + htmlPath);
}
if (fs.existsSync(jsPath)) fs.unlinkSync(jsPath);
console.log('AliveTABs deep mode removed. Restart the IDE.');
`;
function run(cmd, args) {
    return new Promise((resolve) => {
        (0, child_process_1.execFile)(cmd, args, (err, stdout, stderr) => {
            resolve({ code: err ? (err.code ?? 1) : 0, out: stdout + stderr });
        });
    });
}
class DeepMode {
    context;
    constructor(context) {
        this.context = context;
    }
    async payloadDir() {
        const dir = path.join(this.context.globalStorageUri.fsPath, 'deepmode');
        await fs.promises.mkdir(dir, { recursive: true });
        const runtime = path.join(this.context.extensionUri.fsPath, 'runtime', 'alivetabs.js');
        await fs.promises.copyFile(runtime, path.join(dir, 'alivetabs.js'));
        await fs.promises.writeFile(path.join(dir, 'patch.mjs'), PATCH_MJS);
        await fs.promises.writeFile(path.join(dir, 'unpatch.mjs'), UNPATCH_MJS);
        return dir;
    }
    async install() {
        const appRoot = vscode.env.appRoot;
        const dir = await this.payloadDir();
        const script = path.join(dir, 'patch.mjs');
        const node = process.execPath;
        for (const [cmd, args] of [
            ['pkexec', [node, script, appRoot, dir]],
            ['sudo', ['-n', node, script, appRoot, dir]],
        ]) {
            const r = await run(cmd, args);
            if (r.code === 0)
                return true;
        }
        const cmdline = `sudo ${node} "${script}" "${appRoot}" "${dir}"`;
        const choice = await vscode.window.showWarningMessage('AliveTABs deep mode needs admin rights to patch the IDE workbench.', 'Copy command', 'Cancel');
        if (choice === 'Copy command') {
            await vscode.env.clipboard.writeText(cmdline);
            vscode.window.showInformationMessage('Run the copied command in a terminal, then restart the IDE.');
        }
        return false;
    }
    async uninstall() {
        const appRoot = vscode.env.appRoot;
        const dir = await this.payloadDir();
        const script = path.join(dir, 'unpatch.mjs');
        const node = process.execPath;
        for (const [cmd, args] of [
            ['pkexec', [node, script, appRoot]],
            ['sudo', ['-n', node, script, appRoot]],
        ]) {
            const r = await run(cmd, args);
            if (r.code === 0)
                return true;
        }
        const cmdline = `sudo ${node} "${script}" "${appRoot}"`;
        const choice = await vscode.window.showWarningMessage('Removing deep mode needs admin rights.', 'Copy command', 'Cancel');
        if (choice === 'Copy command') {
            await vscode.env.clipboard.writeText(cmdline);
            vscode.window.showInformationMessage('Run the copied command in a terminal, then restart the IDE.');
        }
        return false;
    }
}
exports.DeepMode = DeepMode;
//# sourceMappingURL=deepmode.js.map