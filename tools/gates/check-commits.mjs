#!/usr/bin/env node
// コミットログ規約(WHY を必須にする)の検査。commit-msg フックと CI の両方から使う。
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isAdrPath, isStatusOnlyChange } from './lib/adr-status.mjs';
import { Report, exists, git, parseArgs, readJson } from './lib/common.mjs';

const TYPES = 'feat|fix|refactor|perf|test|docs|build|ci|chore|revert|security';
const SUBJECT = new RegExp(`^(${TYPES})(\\(([a-z0-9-]+)\\))?(!)?: (.+)$`);
const MAX_SUBJECT = 72;
const MIN_WHY = 15;

const POLICY = 'tools/policy/commits.json';
const AI_TRAILER = /^(Co-Authored-By|Claude-Session):/im;

/**
 * 人間だけが書いたコミットか(COM-9)。作者が登録された人間で、AI の痕跡(Co-Authored-By など)が無いこと。
 *
 * WHY NOT: コミッター(committer)では判定しない。AI が書いたコミットも、人間のアカウントでコミットされる。
 * 作者の自己申告は偽れるが、ADR を Accepted にするのは人間だけ(ADR-9)という強制は CODEOWNERS が担う。
 * ここで外すのは Why の検査だけである。
 */
export function isHumanAuthored({ authorEmail, message }, humanAuthors) {
  if (!authorEmail || AI_TRAILER.test(message)) return false;
  return humanAuthors.some((human) => human.toLowerCase() === authorEmail.toLowerCase());
}

export function checkMessage(message, { inRange = false, exempt = false } = {}) {
  const problems = [];
  const lines = message.replace(/\r/g, '').split('\n').filter((l) => !l.startsWith('#'));
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  const subject = lines[0] ?? '';

  // 手元での fixup は作業の途中なので通す。PR に残っていれば不合格にする。
  if (/^(fixup!|squash!|amend!)/.test(subject)) {
    return inRange ? [{ rule: 'COM-6', message: `fixup コミットはマージ前に畳む: "${subject}"` }] : [];
  }
  // 人間が ADR の状態を書き換えただけのコミットは、件名も Why も検査しない(COM-9)。
  if (exempt) return [];

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

/** 人間の作者の登録を読む。無ければ空(誰も対象外にしない)。解釈できなければ失敗にする。 */
function loadHumanAuthors(report) {
  if (!exists(POLICY)) return [];
  try {
    const { humanAuthors } = readJson(POLICY);
    if (Array.isArray(humanAuthors) && humanAuthors.every((e) => typeof e === 'string' && e.trim() !== '')) return humanAuthors;
  } catch {
    // 下で同じ失敗として報告する。
  }
  report.error('COM-9', POLICY, null, '`humanAuthors`(メールアドレスの配列)を読めない。人間による ADR の状態変更の免除は使えない');
  return [];
}

const showOrNull = (spec) => {
  try { return git(['show', spec]); } catch { return null; }
};

function nameStatus(output) {
  const tokens = output.split('\0');
  const out = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) out.push({ change: tokens[i], path: tokens[i + 1] });
  return out;
}

/** 変更が ADR の状態の書き換えだけか。読めないものは false にする(GATE-1)。 */
function isStatusOnly(files, before, after) {
  if (files.length === 0 || files.some(({ change, path }) => change !== 'M' || !isAdrPath(path))) return false;
  return isStatusOnlyChange(files.map(({ change, path }) => ({ change, path, before: before(path), after: after(path) })));
}

function commitIsExempt(sha, humanAuthors) {
  if (humanAuthors.length === 0) return false;
  try {
    const message = git(['log', '-1', '--format=%B', sha]);
    const authorEmail = git(['log', '-1', '--format=%ae', sha]).trim();
    if (!isHumanAuthored({ authorEmail, message }, humanAuthors)) return false;
    const files = nameStatus(git(['diff-tree', '-r', '--no-commit-id', '--no-renames', '--name-status', '-z', `${sha}^`, sha]));
    return isStatusOnly(files, (p) => showOrNull(`${sha}^:${p}`), (p) => showOrNull(`${sha}:${p}`));
  } catch {
    return false;
  }
}

// WHY NOT: フックでは、HEAD との差分を作られるコミットの変更とみなす。--amend ではこの前提が崩れ、
// 直前のコミットの変更を含めずに判定する。フックは早く失敗させるための便宜で、強制力の本体は CI の範囲検査にある。
function stagedCommitIsExempt(message, humanAuthors) {
  if (humanAuthors.length === 0) return false;
  try {
    const authorEmail = /<([^>]*)>/.exec(git(['var', 'GIT_AUTHOR_IDENT']))?.[1] ?? '';
    if (!isHumanAuthored({ authorEmail, message }, humanAuthors)) return false;
    const files = nameStatus(git(['diff', '--cached', '--no-renames', '--name-status', '-z']));
    return isStatusOnly(files, (p) => showOrNull(`HEAD:${p}`), (p) => showOrNull(`:${p}`));
  } catch {
    return false;
  }
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
    const exempt = stagedCommitIsExempt(message, loadHumanAuthors(report));
    for (const p of checkMessage(message, { exempt })) report.error(p.rule, null, null, p.message);
    report.finish(exempt ? '人間による ADR の状態の書き換えのみのため、件名と Why は検査しない(COM-9)' : '');
    return;
  }
  if (!args.range) {
    console.error('usage: check-commits --file <msgfile> | --range <base>..<head>');
    process.exit(2);
  }
  const humanAuthors = loadHumanAuthors(report);
  const shas = git(['rev-list', '--no-merges', args.range]).split('\n').filter(Boolean);
  const exempted = [];
  for (const sha of shas) {
    const message = git(['log', '-1', '--format=%B', sha]);
    const exempt = commitIsExempt(sha, humanAuthors);
    if (exempt) exempted.push(sha.slice(0, 10));
    for (const p of checkMessage(message, { inRange: true, exempt })) {
      report.error(p.rule, sha.slice(0, 10), null, p.message);
    }
  }
  const note = exempted.length > 0 ? `。人間による ADR の状態の書き換えのみのため、件名と Why は検査しない(COM-9): ${exempted.join(', ')}` : '';
  report.finish(`${shas.length} コミット${note}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
