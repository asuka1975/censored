#!/usr/bin/env node
// パッケージの依存方向と命名を検査する。import の制限はコンパイラ(パッケージ境界)に任せ、
// ここではその境界自体が勝手に書き換えられていないことを見る。
//   --plan <plan.json> : ビルド後に、条件節を解決した実際の依存でも検査する
import fs from 'node:fs';
import path from 'node:path';
import { Report, exists, parseArgs, readJson, readText, ROOT } from './lib/common.mjs';
import { warningSuppressions } from './lib/ghc-options.mjs';
import { parseCabal, parseSpago } from './lib/manifests.mjs';
import { layerViolations } from './lib/plan.mjs';

const args = parseArgs(process.argv.slice(2));
const policy = readJson('tools/policy/layers.json');
const report = new Report('check-layers');
const dirs = (p) => (exists(p) ? fs.readdirSync(path.join(ROOT, p), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []);

const PRODUCT_STANZAS = new Set(['library', 'executable', 'foreign-library']);
const INSTRUMENT = /^sydtest-mutation-/;
const HS_PREFIX = policy.backend.prefix;

for (const layer of dirs(policy.backend.root)) {
  const file = `${policy.backend.root}/${layer}/${HS_PREFIX}${layer}.cabal`;
  const rule = policy.backend.layers[layer];
  if (!rule) {
    report.error('DIR-2', `${policy.backend.root}/${layer}`, null, '未定義の層。追加するなら tools/policy/layers.json と ADR を先に更新する');
    continue;
  }
  if (!exists(file)) {
    report.error('DIR-2', file, null, `.cabal は ${HS_PREFIX}${layer}.cabal という名前にする`);
    continue;
  }
  const cabal = parseCabal(readText(file));
  for (const problem of cabal.unsupported) report.error('GATE-1', file, null, problem);
  if (cabal.name !== `${HS_PREFIX}${layer}`) {
    report.error('DIR-2', file, null, `name は ${HS_PREFIX}${layer} にする`);
  }
  for (const s of cabal.stanzas) {
    if (s.kind === 'common') continue;
    if (PRODUCT_STANZAS.has(s.kind)) {
      const internal = s.deps.filter((d) => d.startsWith(HS_PREFIX)).map((d) => d.slice(HS_PREFIX.length));
      for (const dep of internal) {
        if (dep !== layer && !rule.internal.includes(dep)) {
          report.error('DIR-3', file, null, `${layer} は ${dep} に依存できない(許可: ${rule.internal.join(', ') || 'なし'})`);
        }
      }
      if (rule.externalAllow) {
        for (const dep of s.deps.filter((d) => !d.startsWith(HS_PREFIX))) {
          if (!rule.externalAllow.includes(dep)) {
            report.error('DIR-3', file, null, `${layer} の ${s.kind} は外部パッケージ ${dep} に依存できない(tools/policy/layers.json)`);
          }
        }
      }
      for (const dep of s.deps) {
        if (policy.testOnlyPackages.some((p) => new RegExp(p).test(dep))) {
          report.error('DEP-7', file, null, `${dep} はテスト専用ライセンスの条件があるので ${s.kind} から使わない`);
        }
      }
    }
    for (const dep of s.flagDeps) {
      if (!INSTRUMENT.test(dep)) {
        report.error('DIR-3', file, null, `if flag(mutation) の中に置けるのは計器(sydtest-mutation-*)だけ: ${dep}`);
      }
    }
    const bad = warningSuppressions([...s.ghcOptions, ...s.flagGhcOptions]);
    if (bad.length > 0) {
      report.error('LINT-H2', file, null, `警告の抑止はパッケージ単位で行わない: ${bad.join(' ')}`);
    }
    if (s.kind === 'test-suite' && s.name !== `${HS_PREFIX}${layer}-spec`) {
      // WHY NOT: spec のような短い名前を許さない。sydtest-mutation-driver が複数パッケージで同名のスイートを
      // 受け付けず DuplicateSuiteName で落ちる。
      report.error('DIR-4', file, null, `test-suite は ${HS_PREFIX}${layer}-spec という名前にする(現在: ${s.name})`);
    }
    if (s.kind === 'library' && !cabal.flags.includes('mutation')) {
      report.error('TQ-M8', file, null, 'flag mutation を定義する(ミューテーション計測の前提)');
    }
  }
}

for (const name of dirs(policy.frontend.root)) {
  const file = `${policy.frontend.root}/${name}/spago.yaml`;
  const rule = policy.frontend.layers[name];
  if (!rule) {
    report.error('DIR-2', `${policy.frontend.root}/${name}`, null, '未定義の層。追加するなら tools/policy/layers.json と ADR を先に更新する');
    continue;
  }
  if (!exists(file)) {
    report.error('DIR-2', file, null, 'spago.yaml が無い');
    continue;
  }
  const spago = parseSpago(readText(file));
  for (const problem of spago.unsupported) report.error('GATE-1', file, null, problem);
  if (spago.name !== `${policy.frontend.prefix}${name}`) {
    report.error('DIR-2', file, null, `package.name は ${policy.frontend.prefix}${name} にする`);
  }
  for (const dep of spago.deps.filter((d) => d.startsWith(policy.frontend.prefix))) {
    const target = dep.slice(policy.frontend.prefix.length);
    if (!rule.internal.includes(target)) {
      report.error('DIR-3', file, null, `${name} は ${target} に依存できない(許可: ${rule.internal.join(', ') || 'なし'})`);
    }
  }
  if (rule.externalDeny) {
    for (const dep of spago.deps) {
      if (rule.externalDeny.some((p) => new RegExp(p).test(dep))) {
        report.error('DIR-3', file, null, `${name} の外部依存 ${dep} は禁止(tools/policy/layers.json)`);
      }
    }
  }
  for (const [flag, label] of [
    [spago.strict, 'package.build.strict'], [spago.pedantic, 'package.build.pedanticPackages'],
    [spago.testStrict, 'package.test.strict'], [spago.testPedantic, 'package.test.pedanticPackages'],
  ]) {
    if (!flag) report.error('LINT-P2', file, null, `${label}: true を設定する`);
  }
  const suffix = name.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');
  if (spago.testMain !== `Test.Censored.${suffix}.Main`) {
    report.error('DIR-4', file, null, `package.test.main は Test.Censored.${suffix}.Main にする`);
  }
}

if (args.plan) {
  if (!exists(args.plan)) {
    report.error('GATE-1', args.plan, null, 'ビルド計画が無い。cabal build を先に実行する');
  } else {
    const plan = JSON.parse(readText(args.plan));
    for (const problem of layerViolations(plan['install-plan'], policy.backend)) {
      report.error('DIR-3', args.plan, null, problem);
    }
  }
}

report.finish();
