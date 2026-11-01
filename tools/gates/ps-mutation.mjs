#!/usr/bin/env node
// PureScript のミューテーションテスト。purs の出力 JS を Stryker で変異させ、ソースマップで PS の行へ戻す。
//   --mode diff --base <ref> : 変更された PS 行のみ判定する。PR ゲート(TQ-M6)
//   --mode full              : 全体。夜間ジョブ(TQ-M7)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, Report, changedLines, parseArgs, readJson, readText, rel, walk } from './lib/common.mjs';
import { classifyMutants } from './lib/mutants.mjs';

const args = parseArgs(process.argv.slice(2));
const mode = args.mode ?? 'diff';
if (mode === 'diff' && !args.base) {
  console.error('usage: ps-mutation --mode diff --base <ref> | --mode full');
  process.exit(2);
}
const report = new Report(`ps-mutation(${mode})`);
const policy = readJson('tools/policy/mutation.json').frontend;
const frontend = path.join(ROOT, 'frontend');

const sourceFiles = policy.instrument
  .flatMap((layer) => walk(`frontend/packages/${layer}/src`, (f) => f.endsWith('.purs')))
  .map(rel)
  .filter((f) => !f.split('/').includes('Generated'));
const moduleOf = (file) => /^module\s+([\w.]+)/m.exec(readText(file))?.[1];

const changed = mode === 'diff' ? changedLines(args.base) : null;
const targets = sourceFiles.filter((f) => mode === 'full' || changed.has(f));
if (targets.length === 0) {
  console.log(`${report.name}: 対象なし`);
  process.exit(0);
}

const mutate = targets.map((f) => `output/${moduleOf(f)}/index.js`);
for (const m of mutate) {
  if (!fs.existsSync(path.join(frontend, m))) {
    report.error('TQ-M8', m, null, 'コンパイル結果が無い。spago build を先に実行する');
  }
}
if (report.errors.length > 0) { report.finish(); process.exit(); }

const jsonPath = path.join(frontend, 'reports/mutation/mutation.json');
// 前回の結果を今回の結果と取り違えない。
fs.rmSync(jsonPath, { force: true });
const stryker = path.join(ROOT, 'node_modules/.bin/stryker');
const run = spawnSync(stryker, ['run', 'stryker.config.json', '--mutate', mutate.join(',')], {
  cwd: frontend, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, PATH: `${path.join(ROOT, 'node_modules/.bin')}:${process.env.PATH}` },
});
if (run.status !== 0 || !fs.existsSync(jsonPath)) {
  process.stderr.write(run.stdout + run.stderr);
  report.error('TQ-M8', null, null, 'Stryker の実行に失敗した');
  report.finish();
  process.exit();
}

const result = classifyMutants(readJson(jsonPath), {
  changed,
  loadMap: (jsFile) => {
    const mapPath = path.join(frontend, `${jsFile}.map`);
    if (!fs.existsSync(mapPath)) return null;
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    return {
      mappings: map.mappings,
      sourcePath: (i) => rel(path.resolve(path.dirname(path.join(frontend, jsFile)), map.sources[i])),
    };
  },
  loadSource: (psFile) => (fs.existsSync(path.join(ROOT, psFile)) ? readText(psFile) : null),
});

for (const problem of result.problems) report.error('TQ-M8', null, null, problem);
const { killed, survived, ignored, undetermined, survivors } = result;
const total = killed + survived;
const score = total === 0 ? 100 : (killed / total) * 100;
if (total === 0 && undetermined > 0) {
  report.error('TQ-M8', null, null, `${undetermined} 件のミュータントがすべて実行時エラーなどで判定できなかった`);
}
if (mode === 'diff' && survived > 0) {
  for (const s of survivors) report.error('TQ-M6', null, null, `ミュータント生存: ${s}`);
}
if (mode === 'full') {
  for (const s of survivors) report.warn('TQ-M7', null, null, `ミュータント生存: ${s}`);
  if (total === 0) report.error('TQ-M8', null, null, '判定対象のミュータントが 0 件。計測自体が機能していない');
  if (score < policy.fullMinScore) report.error('TQ-M7', null, null, `スコア ${score.toFixed(1)}% が下限 ${policy.fullMinScore}% を下回る`);
}
report.finish(`killed ${killed} / survived ${survived} / 生成コード等で除外 ${ignored}${undetermined ? ` / 判定不能 ${undetermined}` : ''}${mode === 'full' ? ` / score ${score.toFixed(1)}%` : ''}`);
