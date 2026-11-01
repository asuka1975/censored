#!/usr/bin/env node
// コンパイル済みの全テスト(output/Test.Censored.<Package>.Main)を実行する。
// WHY NOT: spago test を使わない。カバレッジとミューテーションでは再ビルドなしで出力 JS を直接走らせる必要がある。
// runSpecAndExitProcess がプロセスを終了させるので、パッケージごとに子プロセスを分ける。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../output');
const mains = fs.existsSync(output)
  ? fs.readdirSync(output).filter((d) => /^Test\.Censored\.[\w.]+\.Main$/.test(d)).sort()
  : [];
if (mains.length === 0) {
  console.error('run-tests: テストが見つからない。spago build を先に実行する');
  process.exit(1);
}
let failed = false;
for (const main of mains) {
  const url = pathToFileURL(path.join(output, main, 'index.js')).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(url)}).then((m) => m.main())`], {
    stdio: 'inherit',
  });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
