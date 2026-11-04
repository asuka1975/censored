#!/usr/bin/env node
// 計測ページを手元で配信する静的サーバー。標準ライブラリだけで動く。
//   node tools/llm-bench/serve.mjs [--port 8080] [--isolation off|require-corp|credentialless]
// localhost は安全なコンテキストなので、WebGPU と Cache Storage が使える。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// WHY NOT: ディレクトリを丸ごと配信しない。許可した 5 つだけを返し、パスの組み立てによる読み出しを起こさない。
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/bench.mjs': ['bench.mjs', 'text/javascript; charset=utf-8'],
  '/engines.mjs': ['engines.mjs', 'text/javascript; charset=utf-8'],
  '/lib.mjs': ['lib.mjs', 'text/javascript; charset=utf-8'],
  '/topics.mjs': ['topics.mjs', 'text/javascript; charset=utf-8'],
};

export const ISOLATION_MODES = ['off', 'require-corp', 'credentialless'];

/** cross-origin isolation(wllama のマルチスレッドに要る)のヘッダー。off なら付けない。 */
export function isolationHeaders(mode) {
  if (!ISOLATION_MODES.includes(mode)) throw new Error(`isolation は ${ISOLATION_MODES.join(', ')} のどれか: ${mode}`);
  return mode === 'off' ? {} : { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': mode };
}

export function createServer({ isolation }) {
  const extra = isolationHeaders(isolation);
  return http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const entry = req.method === 'GET' || req.method === 'HEAD' ? FILES[pathname] : undefined;
    if (!entry) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store', ...extra });
    res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(path.join(ROOT, entry[0])));
  });
}

function main(argv) {
  const opt = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? fallback : argv[i + 1];
  };
  const port = Number(opt('port', '8080'));
  const isolation = opt('isolation', 'off');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`port が不正: ${opt('port')}`);
  // SAFETY: 127.0.0.1 にだけ束縛する。同じネットワークの他の端末から見えない。
  createServer({ isolation }).listen(port, '127.0.0.1', () => {
    console.log(`http://localhost:${port}/?config=1&backend=wasm  (isolation=${isolation})`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
