#!/usr/bin/env node
// 依存パッケージ規約の検査。直接依存は台帳に登録する。固定漏れと台帳の腐敗を検出する。
import path from 'node:path';
import { Report, exists, readJson, readText, rel, walk } from './lib/common.mjs';
import { parseCabal, parseSpago } from './lib/manifests.mjs';

const report = new Report('check-deps');
const registry = readJson('tools/policy/dependencies.json');
const INTERNAL = /^censored-/;

const used = { hackage: new Map(), purescript: new Map(), npm: new Map() };
const note = (eco, name, where) => {
  if (!used[eco].has(name)) used[eco].set(name, where);
};

const cabalFiles = walk('backend/packages', (f) => f.endsWith('.cabal'));
for (const file of cabalFiles) {
  const cabal = parseCabal(readText(file));
  for (const problem of cabal.unsupported) report.error('GATE-1', rel(file), null, problem);
  for (const s of cabal.stanzas) {
    for (const d of [...s.deps, ...s.flagDeps]) if (!INTERNAL.test(d)) note('hackage', d, rel(file));
  }
}

const spagoFiles = walk('frontend/packages', (f) => path.basename(f) === 'spago.yaml');
for (const file of spagoFiles) {
  const spago = parseSpago(readText(file));
  for (const problem of spago.unsupported) report.error('GATE-1', rel(file), null, problem);
  for (const d of [...spago.deps, ...spago.testDeps]) if (!INTERNAL.test(d)) note('purescript', d, rel(file));
}

const pkg = readJson('package.json');
for (const field of ['dependencies', 'devDependencies']) {
  for (const [name, version] of Object.entries(pkg[field] ?? {})) {
    note('npm', name, 'package.json');
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      report.error('DEP-3', 'package.json', null, `${name}: バージョンは完全固定する(現在: ${version})`);
    }
  }
}

for (const eco of Object.keys(used)) {
  const entries = registry[eco] ?? {};
  for (const [name, where] of used[eco]) {
    const entry = entries[name];
    if (!entry) {
      report.error('DEP-1', where, null, `${eco}:${name} が台帳 tools/policy/dependencies.json に無い(docs/conventions/09-dependencies.md の手順で登録する)`);
      continue;
    }
    for (const field of ['purpose', 'tier', 'reviewed']) {
      if (!entry[field]) report.error('DEP-1', 'tools/policy/dependencies.json', null, `${eco}:${name} に ${field} が無い`);
    }
    if (entry.tier === 'foundation' && !entry.adr) {
      report.error('DEP-2', 'tools/policy/dependencies.json', null, `${eco}:${name} は foundation なので adr が必要`);
    }
    if (entry.adr && !walk('docs/adr', (f) => path.basename(f).startsWith(entry.adr.replace('ADR-', ''))).length) {
      report.error('DEP-2', 'tools/policy/dependencies.json', null, `${eco}:${name} の ${entry.adr} が存在しない`);
    }
  }
  for (const name of Object.keys(entries)) {
    if (entries[name].planned) continue;
    if (!used[eco].has(name)) {
      report.error('DEP-4', 'tools/policy/dependencies.json', null, `${eco}:${name} はどこからも使われていない。台帳から消すか planned: true にする`);
    }
  }
}

// 固定の抜け穴を塞ぐ。
const hasBackend = cabalFiles.length > 0;
const hasFrontend = spagoFiles.length > 0;
if (exists('backend/cabal.project')) {
  const project = readText('backend/cabal.project');
  if (!/^index-state:\s*\d{4}-/m.test(project)) report.error('DEP-3', 'backend/cabal.project', null, 'index-state を固定する');
  if (!/^with-compiler:\s*ghc-/m.test(project)) report.error('DEP-3', 'backend/cabal.project', null, 'with-compiler を固定する');
  if (/^source-repository-package/m.test(project)) {
    report.error('DEP-5', 'backend/cabal.project', null, 'source-repository-package は使わない(必要なら ADR で例外にしてから台帳に理由を書く)');
  }
}
if (hasBackend && !exists('backend/cabal.project.freeze')) {
  report.error('DEP-3', 'backend/cabal.project.freeze', null, 'cabal freeze の結果をコミットする');
}
if (hasFrontend && !exists('frontend/spago.lock')) {
  report.error('DEP-3', 'frontend/spago.lock', null, 'spago.lock をコミットする');
}
if (exists('frontend/spago.yaml')) {
  const spago = parseSpago(readText('frontend/spago.yaml'));
  for (const problem of spago.unsupported) report.error('GATE-1', 'frontend/spago.yaml', null, problem);
  if (spago.extraPackages.length > 0) {
    report.error('DEP-5', 'frontend/spago.yaml', null, `extraPackages は使わない: ${spago.extraPackages.join(', ')}`);
  }
}
if (!exists('pnpm-lock.yaml')) report.error('DEP-3', 'pnpm-lock.yaml', null, 'pnpm-lock.yaml をコミットする');

for (const file of walk('.github/workflows', (f) => /\.ya?ml$/.test(f))) {
  readText(file).split('\n').forEach((line, i) => {
    const m = /^\s*(?:-\s*)?uses:\s*([^\s#]+)/.exec(line);
    if (m && !m[1].startsWith('./') && !/@[0-9a-f]{40}$/.test(m[1])) {
      report.error('DEP-6', rel(file), i + 1, `GitHub Actions はコミット SHA で固定する: ${m[1]}`);
    }
  });
}

report.finish(`hackage ${used.hackage.size} / purescript ${used.purescript.size} / npm ${used.npm.size}`);
