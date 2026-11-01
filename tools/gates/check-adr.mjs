#!/usr/bin/env node
// ADR の書式・採番・状態遷移・不変性・参照整合を検査する。
import path from 'node:path';
import { Report, exists, git, isGitRepo, parseArgs, readText, rel, walk } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
const report = new Report('check-adr');
const ADR_DIR = 'docs/adr';
const FILE_RE = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const NOT_ADR = new Set(['README.md', 'template.md']);
const STATUS_RE = /^- Status:\s*(Proposed|Accepted|Rejected|Deprecated|Superseded by ADR-(\d{4}))\s*$/m;
const DATE_RE = /^- Date:\s*(\d{4}-\d{2}-\d{2})\s*$/m;
const REQUIRED = ['背景', '決定', '検討した代替案', '結果', '再検討の条件'];

const files = walk(ADR_DIR, (f) => f.endsWith('.md') && !NOT_ADR.has(path.basename(f)));
const adrs = new Map();

for (const file of files) {
  const name = rel(file);
  const base = path.basename(file);
  const matched = FILE_RE.exec(base);
  if (!matched) {
    report.error('ADR-2', name, null, 'ファイル名は NNNN-slug.md(英小文字・数字・ハイフン)にする');
    continue;
  }
  const number = matched[1];
  if (adrs.has(number)) {
    report.error('ADR-1', name, null, `番号 ${number} が ${adrs.get(number).name} と重複している`);
    continue;
  }
  const text = readText(file);
  const title = /^# ADR-(\d{4}): (.+)$/m.exec(text);
  if (!title) report.error('ADR-2', name, 1, '1 行目は `# ADR-NNNN: タイトル` にする');
  else if (title[1] !== number) report.error('ADR-2', name, 1, `タイトルの番号(${title[1]})がファイル名(${number})と一致しない`);

  const status = STATUS_RE.exec(text);
  if (!status) report.error('ADR-3', name, null, '`- Status:` は Proposed / Accepted / Rejected / Deprecated / Superseded by ADR-NNNN のいずれか');
  if (!DATE_RE.test(text)) report.error('ADR-2', name, null, '`- Date: YYYY-MM-DD` が必要');
  if (!/^- Deciders:\s*\S/m.test(text)) report.error('ADR-2', name, null, '`- Deciders:` が必要(決定した人間)');

  for (const heading of REQUIRED) {
    if (!new RegExp(`^## ${heading}\\s*$`, 'm').test(text)) report.error('ADR-2', name, null, `\`## ${heading}\` が必要`);
  }
  const alt = /^## 検討した代替案\s*$([\s\S]*?)(?=^## |\Z)/m.exec(text);
  if (alt) {
    const options = (alt[1].match(/^### /gm) ?? []).length;
    if (options < 2) report.error('ADR-4', name, null, '代替案は採用案を含めて 2 つ以上、`### ` で並べる');
    if (!/却下/.test(alt[1])) report.error('ADR-4', name, null, '不採用の案には却下理由を書く');
  }
  adrs.set(number, { name, text, status: status?.[1] ?? null, supersededBy: status?.[2] ?? null });
}

const numbers = [...adrs.keys()].sort();
numbers.forEach((n, i) => {
  if (Number(n) !== i + 1) report.error('ADR-1', adrs.get(n).name, null, `番号が連番でない(期待: ${String(i + 1).padStart(4, '0')})`);
});
for (const [n, adr] of adrs) {
  if (adr.supersededBy) {
    if (adr.supersededBy === n) report.error('ADR-3', adr.name, null, '自分自身を置き換えられない');
    else if (!adrs.has(adr.supersededBy)) report.error('ADR-3', adr.name, null, `置き換え先 ADR-${adr.supersededBy} が存在しない`);
  }
}

if (exists(`${ADR_DIR}/README.md`)) {
  const index = readText(`${ADR_DIR}/README.md`);
  for (const [n, adr] of adrs) {
    const base = path.basename(adr.name);
    const row = index.split('\n').find((l) => l.includes(`(${base})`));
    if (!row) report.error('ADR-5', `${ADR_DIR}/README.md`, null, `索引に ADR-${n} が無い`);
    else if (adr.status && !row.includes(adr.status)) report.error('ADR-5', `${ADR_DIR}/README.md`, null, `索引の ADR-${n} の状態が ${adr.status} になっていない`);
  }
} else if (adrs.size > 0) {
  report.error('ADR-5', `${ADR_DIR}/README.md`, null, '索引が無い');
}

// コードと文書からの参照。置き換え済みの判断を根拠にしたコメントを残さない。
const refFiles = [
  ...walk('backend/packages', (f) => /\.hs$/.test(f)),
  ...walk('frontend/packages', (f) => /\.purs$/.test(f)),
];
for (const file of refFiles) {
  const name = rel(file);
  readText(file).split('\n').forEach((text, i) => {
    for (const m of text.matchAll(/\bADR-(\d{4})\b/g)) {
      const adr = adrs.get(m[1]);
      if (!adr) report.error('ADR-6', name, i + 1, `ADR-${m[1]} は存在しない`);
      else if (adr.supersededBy) report.error('ADR-6', name, i + 1, `ADR-${m[1]} は ADR-${adr.supersededBy} に置き換えられている`);
    }
  });
}

// Accepted の本文は不変。基準版の Accepted を起点に、番号で現在のファイルと対応づける(ADR-7)。
// WHY NOT: 現在のファイルのパスで基準版を引かない。改名や削除をした ADR が検査から漏れる。
if (args.base && isGitRepo()) {
  const baseFiles = git(['ls-tree', '-r', '--name-only', '-z', args.base, '--', ADR_DIR]).split('\0').filter(Boolean);
  const strip = (t) => t.split('\n').filter((l) => !/^- Status:/.test(l)).join('\n').trimEnd();
  for (const file of baseFiles) {
    const matched = FILE_RE.exec(path.basename(file));
    if (!matched) continue;
    const before = git(['show', `${args.base}:${file}`]);
    if (!/^- Status:\s*Accepted\s*$/m.test(before)) continue;
    const current = adrs.get(matched[1]);
    if (!current) {
      report.error('ADR-7', file, null, `Accepted の ADR-${matched[1]} は削除できない。Deprecated または Superseded にする`);
      continue;
    }
    if (current.status && !/^(Accepted|Deprecated|Superseded)/.test(current.status)) {
      report.error('ADR-3', current.name, null, `Accepted の ADR-${matched[1]} を ${current.status} へ戻せない`);
    }
    if (strip(before) !== strip(current.text)) {
      report.error('ADR-7', current.name, null, `Accepted の ADR-${matched[1]} は本文を変更できない。新しい ADR で置き換える`);
    }
  }
}

report.finish(`${adrs.size} 件`);
