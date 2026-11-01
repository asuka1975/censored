#!/usr/bin/env node
// cabal test --enable-coverage の結果を統合して、リポジトリ相対パスの LCOV を作る。
// パッケージをまたぐテスト(application のテストが domain を通す等)も数えるため tix を合算する。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, parseArgs, rel, walk } from './lib/common.mjs';
import { sourceWithoutTicks } from './lib/hpc.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.out) {
  console.error('usage: hs-coverage --out <lcov>');
  process.exit(2);
}
const backend = path.join(ROOT, 'backend');
const dist = path.join(backend, 'dist-newstyle');

function findDirs(dir, match, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (match(p)) out.push(p);
    else findDirs(p, match, out);
  }
  return out;
}

const buildDir = path.join(dist, 'build');
const tixFiles = [];
(function collect(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p);
    else if (e.name.endsWith('.tix') && p.includes(`${path.sep}tix${path.sep}`)) tixFiles.push(p);
  }
}(buildDir));

if (tixFiles.length === 0) {
  console.error('hs-coverage: .tix が見つからない。cabal test all --enable-coverage を先に実行する');
  process.exit(1);
}

const merged = path.join(dist, 'coverage-all.tix');
execFileSync('hpc', ['sum', '--union', `--output=${merged}`, ...tixFiles], { cwd: backend, stdio: 'inherit' });

// テストモジュール自身は測定対象から外す(テストのカバレッジは意味を持たない)。
const tix = fs.readFileSync(merged, 'utf8');
const testModules = new Set(
  [...tix.matchAll(/TixModule "([^"]+)\/([^"/]+)"/g)]
    .filter((m) => /-spec$/.test(m[1]))
    .map((m) => m[2]),
);

const mixDirs = findDirs(buildDir, (p) => p.endsWith(`${path.sep}mix`))
  .filter((p) => p.includes(`${path.sep}hpc${path.sep}vanilla${path.sep}`)
    && !p.includes(`${path.sep}t${path.sep}`));
const packageDirs = walk(path.join(backend, 'packages'), (f) => f.endsWith('.cabal')).map((f) => path.dirname(f));

const raw = execFileSync('hpc-codecov', [
  '--format=lcov',
  ...mixDirs.map((d) => `--mix=${path.relative(backend, d)}`),
  ...packageDirs.map((d) => `--src=${path.relative(backend, d)}`),
  ...[...testModules].map((m) => `--exclude=${m}`),
  path.relative(backend, merged),
], { cwd: backend, encoding: 'utf8', maxBuffer: 1 << 28 });

let lcov = raw.replace(/^SF:(.*)$/gm, (_, f) => `SF:backend/${f}`);

// WHY NOT: tix に無いモジュールをすべて未テスト扱いにしない。実行コードの無いモジュールは tix に現れない。
// mix のティックが空のものだけを、実行行 0 のモジュールとして LCOV に加える(COV-2 の偽の不合格を防ぐ)。
const reported = new Set([...lcov.matchAll(/^SF:(.*)$/gm)].map((m) => m[1]));
for (const mix of mixDirs.flatMap((d) => walk(d, (f) => f.endsWith('.mix')))) {
  const source = sourceWithoutTicks(fs.readFileSync(mix, 'utf8'));
  if (!source) continue;
  for (const dir of packageDirs) {
    const file = path.join(dir, source);
    if (fs.existsSync(file) && !reported.has(rel(file))) {
      reported.add(rel(file));
      lcov += `TN:\nSF:${rel(file)}\nLF:0\nLH:0\nend_of_record\n`;
    }
  }
}

fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
fs.writeFileSync(args.out, lcov);
console.log(`hs-coverage: tix ${tixFiles.length} 件を統合 → ${args.out}`);
