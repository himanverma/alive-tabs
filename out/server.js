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
exports.ConfigServer = void 0;
const http = __importStar(require("http"));
const vscode = __importStar(require("vscode"));
const PORTS = [46291, 46292, 46293];
/**
 * Tiny localhost server that exposes the current tab-mark config to the
 * injected deep-mode runtime. The workbench CSP explicitly allows
 * `connect-src http://127.0.0.1:*`.
 */
class ConfigServer {
    tabs;
    server;
    port;
    constructor(tabs) {
        this.tabs = tabs;
    }
    start() {
        if (this.server)
            return Promise.resolve();
        const server = http.createServer((req, res) => {
            if (req.url === '/alivetabs') {
                const body = JSON.stringify(this.tabs.toConfig(vscode.workspace.workspaceFolders ?? []));
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-store',
                });
                res.end(body);
            }
            else {
                res.writeHead(404);
                res.end();
            }
        });
        return new Promise((resolve, reject) => {
            let index = 0;
            const attempt = () => {
                if (index >= PORTS.length) {
                    this.server = undefined;
                    try {
                        server.close();
                    }
                    catch {
                        // never listened
                    }
                    return reject(new Error('No free AliveTABs port'));
                }
                const port = PORTS[index++];
                server.once('error', (err) => {
                    if (err.code === 'EADDRINUSE' || err.code === 'EACCES')
                        attempt();
                    else
                        reject(err);
                });
                server.once('listening', () => {
                    this.port = port;
                    server.removeAllListeners('error');
                    resolve();
                });
                server.listen(port, '127.0.0.1');
            };
            this.server = server;
            attempt();
        });
    }
    dispose() {
        this.server?.close();
        this.server = undefined;
    }
}
exports.ConfigServer = ConfigServer;
//# sourceMappingURL=server.js.map