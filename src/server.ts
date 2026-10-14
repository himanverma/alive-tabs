import * as http from 'http';
import * as vscode from 'vscode';
import { TabState } from './state';

const PORTS = [46291, 46292, 46293];

/**
 * Tiny localhost server that exposes the current tab-mark config to the
 * injected deep-mode runtime. The workbench CSP explicitly allows
 * `connect-src http://127.0.0.1:*`.
 */
export class ConfigServer implements vscode.Disposable {
  private server?: http.Server;
  port?: number;

  constructor(private readonly tabs: TabState) {}

  start(): Promise<void> {
    if (this.server) return Promise.resolve();
    const server = http.createServer((req, res) => {
      if (req.url === '/alivetabs') {
        const body = JSON.stringify(
          this.tabs.toConfig(vscode.workspace.workspaceFolders ?? []),
        );
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        });
        res.end(body);
      } else {
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
          } catch {
            // never listened
          }
          return reject(new Error('No free AliveTABs port'));
        }
        const port = PORTS[index++];
        server.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE' || err.code === 'EACCES') attempt();
          else reject(err);
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

  dispose(): void {
    this.server?.close();
    this.server = undefined;
  }
}
