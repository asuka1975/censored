#!/usr/bin/env node
// PR 単位の検査。サイズ、ゲート改変の分離、レビュー記録の鮮度、テスト削除の明示、課題への紐付け。
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Report, git, parseArgs, readJson } from './lib/common.mjs';
import { parseNumstatZ } from './lib/diff.mjs';
import { TEST_NAME } from './lib/source-rules.mjs';

const RECORD = /<!--\s*gate:([a-z-]+)\s+sha=([0-9a-f]{40})\s+verdict=(pass|fail)\s+reviewer=([A-Za-z0-9_-]+)\s*-->/g;

const withoutFences = (text) => text.replace(/^(```+|~~~+)[^\n]*\n[\s\S]*?(?:^\1[^\n]*$|(?![\s\S]))/gm, '');
const withoutComments = (text) => text.replace(/<!--[\s\S]*?(?:-->|$)/g, '');

/** コードブロックの中の例はレビュー記録として扱わない。記録自体は HTML コメントなので残す。 */
export function parseRecords(body) {
  const out = new Map();
  for (const m of withoutFences(body).matchAll(RECORD)) out.set(m[1], { sha: m[2], verdict: m[3], reviewer: m[4] });
  return out;
}

/**
 * 人が読む部分だけを返す。例外の宣言はここから探す。
 * WHY NOT: 本文全体を検索しない。PR テンプレートのコメント内の例示が宣言として成立し、
 * テンプレートを残しただけでサイズ上限とテスト削除の検査が無効になった。
 */
export function declaredText(body) {
  return withoutComments(withoutFences(body));
}

const matchesAny = (file, patterns) => patterns.some((p) => new RegExp(p).test(file));

export function evaluate({ files, addedLines, removedLines, body, headSha, policy, testNamesAdded, testNamesRemoved }) {
  const problems = [];
  const prose = declaredText(body);
  const isProduct = (f) => matchesAny(f, policy.productPaths);
  const isProtected = (f) => matchesAny(f, policy.protectedPaths);
  const countable = (f) => !matchesAny(f, policy.sizeExclude);

  const size = files.filter(countable).reduce((n, f) => n + (addedLines.get(f) ?? 0) + (removedLines.get(f) ?? 0), 0);
  if (size > policy.maxChangedLines && !/^Size-Exception:\s*\S/m.test(prose)) {
    problems.push({ rule: 'AI-6', message: `変更 ${size} 行が上限 ${policy.maxChangedLines} 行を超える。分割するか PR 本文に Size-Exception: 理由 を書く` });
  }

  const product = files.filter(isProduct);
  const guarded = files.filter(isProtected);
  if (product.length > 0 && guarded.length > 0) {
    problems.push({
      rule: 'AI-8',
      message: `ゲート設定と製品コードを同じ PR で変更している。分離する: ${guarded.slice(0, 5).join(', ')}`,
    });
  }

  if (product.length > 0) {
    const records = parseRecords(body);
    for (const gate of policy.requiredReviewGates) {
      const r = records.get(gate);
      if (!r) problems.push({ rule: 'AI-5', message: `レビュー記録 gate:${gate} が無い(/review-gates を実行する)` });
      else if (r.sha !== headSha) problems.push({ rule: 'AI-5', message: `gate:${gate} は ${r.sha.slice(0, 10)} に対するもので、HEAD ${headSha.slice(0, 10)} と一致しない。再レビューする` });
      else if (r.verdict !== 'pass') problems.push({ rule: 'AI-5', message: `gate:${gate} の判定が ${r.verdict}` });
    }
    if (!/(^|\s)(Refs|Closes|Fixes):?\s+#\d+/im.test(prose)) {
      problems.push({ rule: 'AI-2', message: '受け入れ条件を持つ Issue に紐づける(Closes #123 / Refs #123)' });
    }
  }

  const removed = testNamesRemoved.filter((n) => !testNamesAdded.includes(n));
  if (removed.length > 0 && !/^Test-Removal:\s*\S/m.test(prose)) {
    problems.push({ rule: 'TQ-M9', message: `テストを削除・改名している: ${removed.slice(0, 5).map((n) => `"${n}"`).join(', ')}。意図的なら PR 本文に Test-Removal: 理由 を書く` });
  }
  return problems;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.base) {
    console.error('usage: check-pr --base <ref> [--body-file <file>] [--head-sha <sha>]');
    process.exit(2);
  }
  const report = new Report('check-pr');
  const policy = readJson('tools/policy/pr.json');

  let body = args['body-file'] ? fs.readFileSync(args['body-file'], 'utf8') : '';
  let headSha = args['head-sha'] ?? git(['rev-parse', 'HEAD']).trim();
  if (process.env.GITHUB_EVENT_PATH && fs.existsSync(process.env.GITHUB_EVENT_PATH)) {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    if (event.pull_request) {
      body = event.pull_request.body ?? '';
      headSha = event.pull_request.head.sha;
    }
  }

  const changes = parseNumstatZ(git(['diff', '--numstat', '-z', '--no-renames', `${args.base}...HEAD`]));
  const files = changes.map((c) => c.file);
  const addedLines = new Map(changes.map((c) => [c.file, c.added]));
  const removedLines = new Map(changes.map((c) => [c.file, c.removed]));

  const diff = git(['diff', '--no-color', '--no-ext-diff', `${args.base}...HEAD`, '--', '*.hs', '*.purs']);
  const name = new RegExp(TEST_NAME.source);
  const testNamesAdded = [];
  const testNamesRemoved = [];
  for (const line of diff.split('\n')) {
    const m = name.exec(line);
    if (!m) continue;
    if (line.startsWith('+')) testNamesAdded.push(m[1]);
    else if (line.startsWith('-')) testNamesRemoved.push(m[1]);
  }

  const problems = evaluate({ files, addedLines, removedLines, body, headSha, policy, testNamesAdded, testNamesRemoved });
  for (const p of problems) report.error(p.rule, null, null, p.message);
  report.finish(`${files.length} ファイル`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
