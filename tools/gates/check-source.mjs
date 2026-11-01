#!/usr/bin/env node
// コメント規約・テスト名・禁止構文を検査する。引数でファイルを渡すとそれだけを見る(pre-commit 用)。
import path from 'node:path';
import { Report, parseArgs, readText, rel, walk } from './lib/common.mjs';
import {
  checkComments, checkForeignImports, checkModuleHeader, checkPurity, checkPursImports, checkTestCode,
} from './lib/source-rules.mjs';

const args = parseArgs(process.argv.slice(2));
const report = new Report('check-source');
const isSource = (f) => /\.(hs|purs)$/.test(f);
const ROOTS = ['backend/packages', 'frontend/packages'];

const files = args._.length > 0
  ? args._.map((f) => path.resolve(f)).filter(isSource)
    .filter((f) => ROOTS.some((r) => rel(f).startsWith(`${r}/`)))
  : ROOTS.flatMap((r) => walk(r, isSource));

let checked = 0;
for (const file of files) {
  const name = rel(file);
  // 生成コードは人の判断の対象ではない。生成器側を検査する。
  if (name.split('/').includes('Generated')) continue;
  const lang = file.endsWith('.purs') ? 'purs' : 'hs';
  const src = readText(file);
  const isTest = /\/test\//.test(name);
  const results = [...checkComments(src, lang)];
  if (isTest) {
    results.push(...checkTestCode(src, lang));
  } else {
    results.push(...checkModuleHeader(src, lang));
    if (name.startsWith('backend/packages/domain/src/') || name.startsWith('frontend/packages/core/src/')) {
      results.push(...checkPurity(src, lang));
    }
  }
  if (lang === 'purs') {
    results.push(...checkForeignImports(src));
    if (!isTest) results.push(...checkPursImports(src));
  }
  for (const r of results) report.error(r.rule, name, r.line, r.message);
  checked++;
}
report.finish(`${checked} ファイル`);
