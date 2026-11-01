#!/usr/bin/env node
// ライセンス検査。プロジェクト自身の LICENSE と、推移依存を含む全パッケージのライセンスを見る。
//   --only npm,purescript,hackage : 検査するエコシステムを絞る(CI のジョブごとに必要なものだけが揃うため)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, Report, exists, parseArgs, readJson, readText, walk } from './lib/common.mjs';
import { checkProjectLicense, spdxAllowed } from './lib/license.mjs';
import { collectLicenses, productClosure } from './lib/plan.mjs';

const args = parseArgs(process.argv.slice(2));
const scope = new Set((args.only ?? 'npm,purescript,hackage').split(','));
const report = new Report('check-licenses');
const policy = readJson('tools/policy/licenses.json');
const hasBackend = walk('backend/packages', (f) => f.endsWith('.cabal')).length > 0;
const hasFrontend = walk('frontend/packages', (f) => f.endsWith('spago.yaml')).length > 0;

// sydtest は「テスト対象が OSI 承認ライセンスの OSS である」ことを利用条件にしている(ADR-0004)。
const licenseFile = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].find(exists);
for (const { level, message } of checkProjectLicense({
  text: licenseFile ? readText(licenseFile) : null,
  declared: policy.project,
  approved: policy.osiApproved,
  hasCode: hasBackend || hasFrontend,
})) {
  if (level === 'error') report.error('DEP-8', licenseFile ?? null, null, message);
  else report.warn('DEP-8', null, null, message);
}

const allowed = new Set(policy.allow);
const exception = (name) => policy.exceptions.find((e) => new RegExp(e.package).test(name));

function check(eco, name, license, where) {
  if (spdxAllowed(license, allowed) || exception(name)) return;
  report.error('DEP-7', where, null, `${eco}:${name} のライセンス ${license ?? '(不明)'} は許可リストに無い(tools/policy/licenses.json)`);
}

let counted = 0;

if (scope.has('npm')) {
  try {
    const out = execFileSync('pnpm', ['licenses', 'list', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
    for (const [license, pkgs] of Object.entries(JSON.parse(out))) {
      for (const p of pkgs) { check('npm', p.name, license, 'pnpm-lock.yaml'); counted++; }
    }
  } catch {
    // WHY NOT: 警告で先へ進めない。確認できなかったものを合格として扱うと、検査が壊れた状態に気づけない。
    report.error('GATE-1', 'pnpm-lock.yaml', null, 'pnpm licenses を実行できなかった。pnpm install を実行し直す');
  }
}

// PureScript: Registry のパッケージは purs.json に SPDX を持つ。
if (scope.has('purescript') && hasFrontend) {
  const spagoStore = path.join(ROOT, 'frontend/.spago/p');
  if (!fs.existsSync(spagoStore)) {
    report.error('GATE-1', 'frontend/.spago', null, 'PureScript の依存が無くライセンスを確認できない。spago build を先に実行する');
  } else {
    for (const dir of fs.readdirSync(spagoStore)) {
      const manifest = path.join(spagoStore, dir, 'purs.json');
      if (!fs.existsSync(manifest)) {
        report.error('GATE-1', `frontend/.spago/p/${dir}`, null, 'purs.json が無くライセンスを判定できない');
        continue;
      }
      const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      check('purescript', m.name ?? dir, m.license, 'frontend/spago.lock');
      counted++;
    }
  }
}

function cabalStoreRoots() {
  const roots = [process.env.CABAL_STORE];
  try {
    const out = execFileSync('cabal', ['path', '--store-dir'], { cwd: path.join(ROOT, 'backend'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    roots.push(out.trim());
  } catch {
    // cabal が無い環境では既定の場所を探す。見つからなければ下で不合格になる。
  }
  roots.push(path.join(os.homedir(), '.local/state/cabal/store'), path.join(os.homedir(), '.cabal/store'));
  return [...new Set(roots.filter(Boolean))].filter((p) => fs.existsSync(p));
}

// Haskell: plan.json の各ユニットを cabal store の .conf と突き合わせる。
if (scope.has('hackage') && hasBackend) {
  const planPath = path.join(ROOT, 'backend/dist-newstyle/cache/plan.json');
  if (!fs.existsSync(planPath)) {
    report.error('GATE-1', 'backend/dist-newstyle/cache/plan.json', null, 'ビルド計画が無くライセンスを確認できない。cabal build を先に実行する');
  } else {
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    const confDirs = cabalStoreRoots().flatMap((s) => fs.readdirSync(s).map((d) => path.join(s, d, 'package.db')).filter((d) => fs.existsSync(d)));
    const readLicense = (id) => {
      const conf = confDirs.map((d) => path.join(d, `${id}.conf`)).find((p) => fs.existsSync(p));
      return conf ? /^license:\s*(.+)$/m.exec(fs.readFileSync(conf, 'utf8'))?.[1]?.trim() ?? null : null;
    };
    const { found, missing } = collectLicenses(plan['install-plan'], readLicense);
    for (const { name, license } of found) { check('hackage', name, license, 'backend/cabal.project.freeze'); counted++; }
    for (const name of missing) {
      report.error('GATE-1', 'backend/cabal.project.freeze', null, `hackage:${name} のライセンス情報を cabal store で見つけられない`);
    }
    // テスト専用の例外が製品に紛れ込んでいないことを、依存グラフで確かめる。
    for (const name of productClosure(plan['install-plan'])) {
      const ex = exception(name);
      if (ex?.testOnly) {
        report.error('DEP-7', 'backend/cabal.project.freeze', null, `${name} はテスト専用の例外(${ex.license})だが、製品の依存に含まれている`);
      }
    }
  }
}

report.finish(`${counted} パッケージ`);
