#!/usr/bin/env node
// コミットログ規約(WHY を必須にする)の検査。commit-msg フックと CI の両方から使う。
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Report, git, parseArgs } from './lib/common.mjs';

const TYPES = 'feat|fix|refactor|perf|test|docs|build|ci|chore|revert|security';
const SUBJECT = new RegExp(`^(${TYPES})(\\(([a-z0-9-]+)\\))?(!)?: (.+)$`);
const MAX_SUBJECT = 72;
const MIN_WHY = 15;

export function checkMessage(message, { inRange = false } = {}) {
  const problems = [];
  const lines = message.replace(/\r/g, '').split('\n').filter((l) => !l.startsWith('#'));
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  const subject = lines[0] ?? '';

  // 手元での fixup は作業の途中なので通す。PR に残っていれば不合格にする。
  if (/^(fixup!|squash!|amend!)/.test(subject)) {
    return inRange ? [{ rule: 'COM-6', message: `fixup コミットはマージ前に畳む: "${subject}"` }] : [];
  }

  const m = SUBJECT.exec(subject);
  if (!m) {
    problems.push({ rule: 'COM-1', message: `件名は <type>(<scope>): <要約> の形式にする(type: ${TYPES}): "${subject}"` });
  } else if ([...m[5]].length > MAX_SUBJECT) {
    problems.push({ rule: 'COM-1', message: `要約は ${MAX_SUBJECT} 文字以内にする` });
  }
  if (lines.length > 1 && lines[1].trim() !== '') {
    problems.push({ rule: 'COM-1', message: '件名の次の行は空行にする' });
  }

  const body = lines.slice(2).join('\n');
  const why = /^Why:[ \t]*(.*(?:\n(?![A-Z][A-Za-z-]*:)(?!\n).*)*)/m.exec(body);
  if (!why || why[1].trim() === '') {
    problems.push({ rule: 'COM-2', message: '本文に `Why:` を書く(なぜ今この変更が必要か)' });
  } else {
    const text = why[1].trim();
    if ([...text].length < MIN_WHY) {
      problems.push({ rule: 'COM-2', message: `Why: が短すぎる(${MIN_WHY} 文字以上。変更内容ではなく理由を書く)` });
    }
    if (m && text === m[5].trim()) {
      problems.push({ rule: 'COM-2', message: 'Why: が件名の繰り返しになっている' });
    }
  }

  if (m && m[4] && !/^BREAKING CHANGE:\s*\S/m.test(body)) {
    problems.push({ rule: 'COM-4', message: '`!` を付けたら BREAKING CHANGE: に移行方法を書く' });
  }
  if (/^ADR:\s*/m.test(body) && !/^ADR:\s*\d{4}(,\s*\d{4})*\s*$/m.test(body)) {
    problems.push({ rule: 'COM-5', message: 'ADR トレーラーは `ADR: 0007` の形式にする' });
  }
  return problems;
}

function isMergeInProgress() {
  try {
    git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    return true;
  } catch {
    return false;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = new Report('check-commits');
  if (args.file) {
    // WHY NOT: 件名が Merge で始まるかで判定しない。通常のコミットでも規約を迂回できてしまう。実際の状態を見る。
    if (isMergeInProgress()) {
      report.finish('マージコミットは対象外');
      return;
    }
    const message = fs.readFileSync(args.file, 'utf8');
    for (const p of checkMessage(message)) report.error(p.rule, null, null, p.message);
    report.finish();
    return;
  }
  if (!args.range) {
    console.error('usage: check-commits --file <msgfile> | --range <base>..<head>');
    process.exit(2);
  }
  const shas = git(['rev-list', '--no-merges', args.range]).split('\n').filter(Boolean);
  for (const sha of shas) {
    const message = git(['log', '-1', '--format=%B', sha]);
    for (const p of checkMessage(message, { inRange: true })) {
      report.error(p.rule, sha.slice(0, 10), null, p.message);
    }
  }
  report.finish(`${shas.length} コミット`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
