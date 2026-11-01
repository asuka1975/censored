#!/usr/bin/env node
// NODE_V8_COVERAGE の生データと purs のソースマップから、PureScript 行単位の LCOV を作る。
// WHY NOT: c8 / v8-to-istanbul は使わない。purs の疎なソースマップでは未実行の関数を含むファイルが
// 100% と報告された(ADR-0005)。誤って合格するカバレッジはゲートにならない。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, parseArgs, readText, rel, walk } from './lib/common.mjs';
import { decodeMappings } from './lib/sourcemap.mjs';

/** 実行回数を行へ射影する。モジュール読み込み時に評価されるだけの範囲(宣言)は分母に入れない。 */
export function lineHits(jsText, map, ranges) {
  const lineOffsets = [0];
  for (let i = 0; i < jsText.length; i++) if (jsText[i] === '\n') lineOffsets.push(i + 1);
  // 広い範囲から順に上書きし、最も内側の範囲の実行回数を採用する。
  const sorted = [...ranges].sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));
  const root = sorted[0];
  const decoded = decodeMappings(map.mappings);
  const out = new Map();
  decoded.forEach((segments, genLine) => {
    for (const seg of segments) {
      if (seg.src === null) continue;
      const offset = lineOffsets[genLine] + seg.genCol;
      let inner = null;
      for (const r of sorted) if (r.startOffset <= offset && offset < r.endOffset) inner = r;
      if (!inner || inner === root) continue;
      const lines = out.get(seg.src) ?? new Map();
      lines.set(seg.line, Math.max(lines.get(seg.line) ?? 0, inner.count));
      out.set(seg.src, lines);
    }
  });
  return out;
}

/**
 * purs の出力に実行されるコードがあるか。型だけのモジュールや再エクスポートには無く、
 * 参照されても読み込まれないので、V8 のデータには現れない。
 */
export function hasRuntimeCode(js) {
  const code = js
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/^\s*import\s[^;]*;/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}(\s*from\s*"[^"]*")?\s*;/gm, '')
    .trim();
  return code.length > 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.v8 || !args.out) {
    console.error('usage: ps-coverage --v8 <dir> --out <lcov> [--output <purs output dir>]');
    process.exit(2);
  }
  const outputDir = path.resolve(args.output ?? path.join(ROOT, 'frontend/output'));
  const isProductSource = (s) => s.startsWith('frontend/packages/') && s.includes('/src/');
  const hits = new Map();
  for (const file of fs.readdirSync(args.v8)) {
    if (!file.endsWith('.json')) continue;
    const report = JSON.parse(fs.readFileSync(path.join(args.v8, file), 'utf8'));
    for (const script of report.result) {
      if (!script.url.startsWith('file://')) continue;
      const jsPath = new URL(script.url).pathname;
      if (!jsPath.startsWith(`${outputDir}/`) || !jsPath.endsWith('/index.js')) continue;
      const mapPath = `${jsPath}.map`;
      if (!fs.existsSync(mapPath)) continue;
      const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
      const sources = map.sources.map((s) => rel(path.resolve(path.dirname(jsPath), s)));
      // WHY NOT: 実行行の有無で読み込みの有無を判断しない。定数だけのモジュールは実行行が 0 でも読み込まれている。
      for (const source of sources) {
        if (isProductSource(source) && !hits.has(source)) hits.set(source, new Map());
      }
      const ranges = script.functions.flatMap((f) => f.ranges);
      for (const [srcIndex, lines] of lineHits(fs.readFileSync(jsPath, 'utf8'), map, ranges)) {
        const source = sources[srcIndex];
        if (!isProductSource(source)) continue;
        const merged = hits.get(source);
        for (const [line, count] of lines) merged.set(line, (merged.get(line) ?? 0) + count);
      }
    }
  }

  for (const file of walk('frontend/packages', (f) => f.endsWith('.purs'))) {
    const source = rel(file);
    if (!isProductSource(source) || hits.has(source)) continue;
    const moduleName = /^module\s+([\w.]+)/m.exec(readText(file))?.[1];
    const js = moduleName ? path.join(outputDir, moduleName, 'index.js') : null;
    if (js && fs.existsSync(js) && !hasRuntimeCode(fs.readFileSync(js, 'utf8'))) hits.set(source, new Map());
  }

  let lcov = '';
  for (const [source, lines] of [...hits].sort((a, b) => a[0].localeCompare(b[0]))) {
    lcov += `TN:\nSF:${source}\n`;
    const sorted = [...lines].sort((a, b) => a[0] - b[0]);
    for (const [line, count] of sorted) lcov += `DA:${line},${count}\n`;
    lcov += `LF:${sorted.length}\nLH:${sorted.filter(([, c]) => c > 0).length}\nend_of_record\n`;
  }
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, lcov);
  console.log(`ps-coverage: ${hits.size} モジュール → ${args.out}`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main();
