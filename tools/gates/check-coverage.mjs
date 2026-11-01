#!/usr/bin/env node
// カバレッジゲート。層ごとの下限(COV-1)、未計測モジュールの検出(COV-2)、差分カバレッジ(COV-3)。
import { Report, changedLines, exists, parseArgs, readJson, readText, rel, walk } from './lib/common.mjs';
import { filterLines, parseLcov, percent } from './lib/lcov.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.side || !args.lcov) {
  console.error('usage: check-coverage --side backend|frontend --lcov <file> [--base <ref>]');
  process.exit(2);
}
const policy = readJson('tools/policy/coverage.json');
const side = policy[args.side];
const report = new Report(`check-coverage(${args.side})`);
const ext = args.side === 'backend' ? '.hs' : '.purs';

const excluded = (file) => policy.excludeFiles.some((p) => new RegExp(p).test(file));
const lcov = exists(args.lcov) ? parseLcov(readText(args.lcov)) : null;
if (!lcov) {
  report.error('COV-1', args.lcov, null, 'LCOV が無い。テストを coverage 付きで実行したか確認する');
  report.finish();
  process.exit();
}

const filtered = new Map();
for (const [file, lines] of lcov) {
  if (excluded(file) || !exists(file)) continue;
  filtered.set(file, filterLines(lines, readText(file), side.ignoreLinePatterns ?? []));
}

const summary = [];
for (const [layer, floor] of Object.entries(side.floors)) {
  const srcDir = `${side.root}/${layer}/src`;
  const sources = walk(srcDir, (f) => f.endsWith(ext)).map(rel).filter((f) => !excluded(f));
  if (sources.length === 0) continue;

  let total = 0;
  let hit = 0;
  for (const file of sources) {
    const lines = filtered.get(file);
    if (!lines) {
      // WHY NOT: LCOV に無いファイルを無視すると、テストから一度も読まれないモジュールほど合格してしまう。
      report.error('COV-2', file, null, 'テストから一度も読み込まれていないモジュール');
      continue;
    }
    total += lines.size;
    for (const c of lines.values()) if (c > 0) hit++;
  }
  const pct = percent(hit, total);
  summary.push(`${layer} ${pct.toFixed(1)}% (下限 ${floor}%)`);
  if (pct < floor) {
    report.error('COV-1', srcDir, null, `行カバレッジ ${pct.toFixed(1)}% が下限 ${floor}% を下回る(${hit}/${total})`);
  }
}

if (args.base) {
  const changed = changedLines(args.base);
  let total = 0;
  let hit = 0;
  const uncovered = [];
  for (const [file, lineSet] of changed) {
    if (!file.endsWith(ext) || !file.startsWith(`${side.root}/`) || !file.includes('/src/') || excluded(file)) continue;
    const lines = filtered.get(file);
    if (!lines) continue;
    for (const n of lineSet) {
      if (!lines.has(n)) continue;
      total++;
      if (lines.get(n) > 0) hit++;
      else uncovered.push(`${file}:${n}`);
    }
  }
  const pct = percent(hit, total);
  summary.push(`差分 ${pct.toFixed(1)}% (${hit}/${total})`);
  if (pct < policy.diffMinPercent) {
    report.error('COV-3', null, null, `変更行のカバレッジ ${pct.toFixed(1)}% が下限 ${policy.diffMinPercent}% を下回る`);
    for (const u of uncovered) report.error('COV-3', u, null, '変更行がテストで実行されていない');
  }
}

report.finish(summary.join(' / ') || '対象パッケージなし');
