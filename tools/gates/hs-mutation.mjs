#!/usr/bin/env node
// Haskell のミューテーションテスト。sydtest-mutation を Cabal から駆動する。
//   --mode diff --base <ref> : 変更箇所のみ。PR ゲート(TQ-M6)
//   --mode full              : 全体。夜間ジョブ(TQ-M7)
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, Report, changedLines, git, parseArgs, readJson } from './lib/common.mjs';
import { uninstrumentedChanges, uninstrumentedNotice } from './lib/instrument-scope.mjs';

const args = parseArgs(process.argv.slice(2));
const mode = args.mode ?? 'diff';
if (mode === 'diff' && !args.base) {
  console.error('usage: hs-mutation --mode diff --base <ref> | --mode full');
  process.exit(2);
}

// WHY NOT: ロケールを環境任せにしない。POSIX ロケールでは日本語のテスト名が子プロセスの引数で壊れ、
// driver が「no valid coverage-child test id」で失敗する。
process.env.LANG = 'C.UTF-8';
process.env.LC_ALL = 'C.UTF-8';

const report = new Report(`hs-mutation(${mode})`);
const policy = readJson('tools/policy/mutation.json').backend;
const backend = path.join(ROOT, 'backend');
const builddir = path.join(backend, 'dist-mutation');
// WHY NOT: マニフェストを実行ごとに消さない。プラグインはコンパイル時にしか書かないので、ビルドキャッシュが
// 効くと空になり「ミューテーション0件で PASS」という偽の合格になる。ビルド成果物と同じ寿命で保持する。
const manifestRoot = path.join(builddir, 'manifest');
const suitesRoot = path.join(builddir, 'suites');
const runRoot = path.join(builddir, `run-${mode}`);
fs.rmSync(runRoot, { recursive: true, force: true });
fs.mkdirSync(runRoot, { recursive: true });

const layers = fs.existsSync(path.join(backend, 'packages'))
  ? fs.readdirSync(path.join(backend, 'packages'))
    .filter((d) => fs.existsSync(path.join(backend, 'packages', d, `censored-${d}.cabal`)))
  : [];
const instrumented = policy.instrument.filter((l) => layers.includes(l));
if (mode === 'diff') {
  const outOfScope = uninstrumentedChanges([...changedLines(args.base).keys()], readJson('tools/policy/mutation.json'), 'backend');
  if (outOfScope.length > 0) console.log(uninstrumentedNotice(report.name, outOfScope));
}
if (instrumented.length === 0) {
  console.log(`${report.name}: 対象パッケージなし`);
  process.exit(0);
}

const cabalBase = ['--project-file=cabal.project.mutation', `--builddir=${path.relative(backend, builddir)}`, '-j'];
function cabal(cmd, target, env = {}) {
  const r = spawnSync('cabal', [cmd, target, ...cabalBase], {
    cwd: backend, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 28,
  });
  if (r.status !== 0) {
    process.stderr.write(r.stdout + r.stderr);
    console.error(`cabal ${cmd} ${target} が失敗した`);
    process.exit(1);
  }
  return r.stdout;
}

const manifests = [];
for (const layer of instrumented) {
  const dir = path.join(manifestRoot, layer);
  fs.mkdirSync(dir, { recursive: true });
  cabal('build', `censored-${layer}:lib:censored-${layer}`, { MUTATION_PLUGIN_MANIFEST_DIR: dir });
  if (fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length === 0) {
    report.error('TQ-M8', `backend/packages/${layer}`, null, 'マニフェストが空。dist-mutation を消して再実行する');
  }
  manifests.push(`--manifest=${dir}`);
}

const suiteArgs = [];
const suiteExes = [];
for (const layer of layers) {
  const cabalFile = fs.readFileSync(path.join(backend, 'packages', layer, `censored-${layer}.cabal`), 'utf8');
  const suite = `censored-${layer}-spec`;
  if (!new RegExp(`^test-suite\\s+${suite}\\s*$`, 'm').test(cabalFile)) continue;
  cabal('build', `censored-${layer}:test:${suite}`, { MUTATION_PLUGIN_SKIP: '1' });
  const bin = execFileSync('cabal', ['list-bin', `censored-${layer}:test:${suite}`, ...cabalBase.slice(0, 2)], {
    cwd: backend, encoding: 'utf8',
  }).trim().split('\n').pop();
  const pkgRoot = path.join(suitesRoot, `censored-${layer}`);
  fs.mkdirSync(path.join(pkgRoot, 'test'), { recursive: true });
  const dest = path.join(pkgRoot, 'test', suite);
  fs.copyFileSync(bin, dest);
  fs.chmodSync(dest, 0o755);
  suiteArgs.push(`--suite-pkg=censored-${layer}=${pkgRoot}=${path.join(backend, 'packages', layer)}`);
  suiteExes.push({ suite, dest, cwd: path.join(backend, 'packages', layer) });
}
if (suiteArgs.length === 0) {
  report.error('TQ-M8', null, null, 'テストスイートが 1 つも見つからない(censored-<layer>-spec)');
  report.finish();
  process.exit();
}

const driver = (argv, opts = {}) => spawnSync('sydtest-mutation-driver', argv, {
  cwd: backend, encoding: 'utf8', maxBuffer: 1 << 30, env: { ...process.env, NO_COLOR: '1' }, ...opts,
});

const coverageDir = path.join(runRoot, 'coverage');
const cov = driver(['coverage', ...manifests, ...suiteArgs, `--mutation-augmented-manifest-dir=${path.join(coverageDir, 'augmented')}`]);
if (cov.status !== 0) {
  process.stderr.write(cov.stdout + cov.stderr);
  report.error('TQ-M8', null, null, 'カバレッジ段階が失敗した(テストが落ちている可能性)');
  report.finish();
  process.exit();
}
fs.mkdirSync(path.join(coverageDir, 'test-locations'), { recursive: true });
for (const { suite, dest, cwd } of suiteExes) {
  const r = spawnSync(dest, ['--mutation-coverage-list-locations'], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status === 0) fs.writeFileSync(path.join(coverageDir, 'test-locations', `${suite}.json`), r.stdout);
}

const outDir = path.join(runRoot, 'report');
let result;
if (mode === 'diff') {
  const diffFile = path.join(runRoot, 'changes.diff');
  fs.writeFileSync(diffFile, git(['diff', '--relative=backend', `${args.base}...HEAD`]));
  result = driver(['diff', ...suiteArgs, `--coverage-dir=${coverageDir}`, `--out-dir=${outDir}`, `--diff=${diffFile}`, '--no-fail-fast']);
} else {
  result = driver(['run', ...manifests, ...suiteArgs, `--coverage-dir=${coverageDir}`,
    `--mutation-augmented-manifest-dir=${path.join(runRoot, 'augmented')}`, `--out-dir=${outDir}`, '--no-fail-fast']);
}
const reportJson = path.join(outDir, 'report.json');
if (!fs.existsSync(reportJson)) {
  process.stderr.write(result.stdout + result.stderr);
  report.error('TQ-M8', null, null, 'ドライバがレポートを出力しなかった(制御ミュータントの失敗など、結果を信頼できない)');
  report.finish();
  process.exit();
}

const { killed = 0, survived = 0, uncovered = 0, timed_out: timedOut = 0, skipped = 0 } = readJson(reportJson).mutations ?? {};
const total = killed + survived + uncovered + timedOut;
const score = total === 0 ? 100 : ((killed + timedOut) / total) * 100;
const summary = `killed ${killed + timedOut} / survived ${survived} / uncovered ${uncovered} / skipped ${skipped}`;

if (survived + uncovered > 0 || mode === 'full') {
  process.stdout.write(fs.readFileSync(path.join(outDir, 'report.txt'), 'utf8').replace(/\x1b\[[0-9;]*m/g, ''));
}
if (mode === 'diff') {
  if (survived > 0) report.error('TQ-M6', null, null, `変更箇所で ${survived} 件のミュータントが生存(テストが変更を検出できていない)`);
  if (uncovered > 0) report.error('TQ-M6', null, null, `変更箇所で ${uncovered} 件がテスト未到達`);
} else {
  if (total === 0) report.error('TQ-M8', null, null, 'ミューテーションが 0 件。計測自体が機能していない');
  if (score < policy.fullMinScore) {
    report.error('TQ-M7', null, null, `スコア ${score.toFixed(1)}% が下限 ${policy.fullMinScore}% を下回る`);
  }
}
report.finish(`${summary}${mode === 'full' ? ` / score ${score.toFixed(1)}%` : ''} → ${path.relative(ROOT, outDir)}`);
