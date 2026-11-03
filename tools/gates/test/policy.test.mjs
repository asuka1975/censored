// 実際のポリシーファイルと CI 定義に対する検査。設定の退行で偽の合格が生まれないことを確かめる。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { layerViolations } from '../lib/plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const policy = JSON.parse(read('tools/policy/pr.json'));
const isProtected = (f) => policy.protectedPaths.some((p) => new RegExp(p).test(f));
const isProduct = (f) => policy.productPaths.some((p) => new RegExp(p).test(f));

/** CODEOWNERS の所有者を返す。GitHub と同じく最後に一致した行が勝ち、所有者なしの行は指定を外す。 */
function ownersOf(file) {
  let owners = [];
  for (const line of read('.github/CODEOWNERS').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [pattern, ...rest] = line.trim().split(/\s+/);
    const body = pattern.replace(/^\//, '');
    const hit = body.endsWith('/') ? file.startsWith(body)
      : body.endsWith('*') ? file.startsWith(body.slice(0, -1))
        : file === body;
    if (hit) owners = rest;
  }
  return owners;
}

// 検査の実行内容、ツールの取得、インストールの許可、AI への指示を変更できるファイル。
const GATE_CONTROL = [
  'tools/gates/check-pr.mjs', 'tools/gates/check-commits.mjs', 'tools/gates/lib/adr-status.mjs',
  'tools/policy/commits.json', 'tools/policy/coverage.json', 'tools/policy/layers.json', 'tools/policy/licenses.json',
  'tools/setup-toolchain.sh', 'tools/versions.env', 'frontend/tools/run-tests.mjs', 'frontend/stryker.config.json',
  'frontend/spago.yaml', 'backend/.hlint.yaml', 'backend/fourmolu.yaml', 'backend/weeder.toml',
  'backend/cabal.project', 'backend/cabal.project.mutation', 'backend/cabal.project.local',
  '.github/workflows/ci.yml', '.github/CODEOWNERS', 'lefthook.yml', '.lefthookrc', 'Makefile',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'osv-scanner.toml',
  '.markdownlint-cli2.jsonc', '.gitattributes', '.gitignore',
  '.claude/settings.json', '.claude/agents/nfr-reviewer.md', 'AGENTS.md', 'CLAUDE.md', 'docs/conventions/05-test-quality-gate.md',
];

describe('ゲート設定の保護', () => {
  for (const file of GATE_CONTROL) {
    it(`${file} は製品コードと同時に変更できない`, () => {
      assert.equal(isProtected(file), true);
    });

    it(`${file} は Code Owners の承認を要する`, () => {
      assert.notDeepEqual(ownersOf(file), []);
    });
  }

  it('製品コードと一緒に変わるファイルは同じ PR で変更できる', () => {
    for (const file of ['tools/policy/dependencies.json', 'backend/cabal.project.freeze', 'frontend/spago.lock',
      'backend/packages/domain/censored-domain.cabal', 'frontend/packages/core/spago.yaml', 'docs/adr/0009-x.md']) {
      assert.equal(isProtected(file), false, file);
    }
  });

  it('依存の固定ファイルは Code Owners の対象にしない', () => {
    assert.deepEqual(ownersOf('backend/cabal.project.freeze'), []);
  });

  it('製品コードの判定とゲート設定の判定が重ならない', () => {
    for (const file of GATE_CONTROL) assert.equal(isProduct(file), false, file);
  });
});

describe('CI の起動条件', () => {
  const workflow = (name) => YAML.parse(read(`.github/workflows/${name}`));

  it('PR 本文の編集で PR 検査が再実行される', () => {
    assert.ok(workflow('pr-policy.yml').on.pull_request.types.includes('edited'));
  });

  it('PR 検査がコミットの追加でも実行される', () => {
    assert.ok(workflow('pr-policy.yml').on.pull_request.types.includes('synchronize'));
  });

  it('本文の編集でビルドとテストのジョブをスキップで上書きしない', () => {
    assert.equal(workflow('ci.yml').on.pull_request?.types?.includes('edited') ?? false, false);
    assert.doesNotMatch(read('.github/workflows/ci.yml'), /event\.action/);
  });
});

describe('依存の導入なしで動く検査', () => {
  /** import を辿り、外部パッケージの指定を集める。 */
  function externalImports(entry, seen = new Set()) {
    if (seen.has(entry)) return [];
    seen.add(entry);
    const found = [];
    for (const m of fs.readFileSync(entry, 'utf8').matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      if (m[1].startsWith('.')) found.push(...externalImports(path.resolve(path.dirname(entry), m[1]), seen));
      else if (!m[1].startsWith('node:')) found.push(m[1]);
    }
    return found;
  }

  // pr-policy は pnpm install をしない。Git フックの check-source と check-commits も依存の状態に左右されない。
  for (const gate of ['check-pr.mjs', 'check-commits.mjs', 'check-source.mjs', 'check-docs.mjs']) {
    it(`${gate} は外部パッケージを読み込まない`, () => {
      assert.deepEqual(externalImports(path.join(ROOT, 'tools/gates', gate)), []);
    });
  }
});

describe('書記素の分割に使う ICU(ADR-0009)', () => {
  const backend = JSON.parse(read('tools/policy/layers.json')).backend;
  const unit = (id, name, style, component, depends = []) => ({
    id, 'pkg-name': name, style, 'component-name': component, depends,
  });
  const planWith = (...deps) => [
    unit('base', 'base', 'global', 'lib'),
    unit('text', 'text', 'global', 'lib'),
    unit('icu', 'text-icu', 'global', 'lib'),
    unit('aeson', 'aeson', 'global', 'lib'),
    unit('dom', 'censored-domain', 'local', 'lib', deps),
  ];

  it('domain は text-icu に依存できる', () => {
    assert.deepEqual(layerViolations(planWith('base', 'text', 'icu'), backend), []);
  });

  it('domain は許可リストにない外部パッケージには依存できない', () => {
    assert.equal(layerViolations(planWith('base', 'aeson'), backend).length, 1);
  });

  const stepIndex = (steps, text) => steps.findIndex((s) => typeof s.run === 'string' && s.run.includes(text));

  for (const [file, job] of [['ci.yml', 'backend'], ['nightly.yml', 'mutation-full']]) {
    it(`${file} の ${job} ジョブは、セットアップの前に ICU の開発ファイルと pkg-config を導入する`, () => {
      const steps = YAML.parse(read(`.github/workflows/${file}`)).jobs[job].steps;
      const icu = stepIndex(steps, 'libicu-dev');
      const setup = stepIndex(steps, 'tools/setup-toolchain.sh');
      assert.notEqual(setup, -1);
      assert.ok(icu !== -1 && icu < setup, `libicu-dev の導入(${icu})がセットアップ(${setup})より前にない`);
      assert.match(steps[icu].run, /pkg-config/);
      assert.match(steps[icu].run, /apt-get update.*apt-get install/, '索引を更新してから導入する');
      assert.equal(steps[icu].if, undefined, 'ICU の導入を条件で無効にしない');
      assert.equal(steps[icu]['continue-on-error'], undefined, 'ICU の導入の失敗を無視しない');
    });
  }
});

describe('Git フックの実行環境', () => {
  it('フックがツールの導入先を PATH に入れる', () => {
    // sh の `.` はスラッシュのないパスを PATH から探すので、相対パスを明示しないと読み込みに失敗する。
    assert.equal(YAML.parse(read('lefthook.yml')).rc, './.lefthookrc');
    assert.match(read('.lefthookrc'), /\.tools\/bin/);
  });
});

describe('人間の作者の登録(COM-9)', () => {
  const { humanAuthors } = JSON.parse(read('tools/policy/commits.json'));

  it('1 人以上の人間のメールアドレスを登録している', () => {
    assert.equal(Array.isArray(humanAuthors) && humanAuthors.length > 0, true);
  });

  it('このリポジトリで AI が使う作者を人間として登録していない', () => {
    for (const email of humanAuthors) assert.doesNotMatch(email, /anthropic\.com$/i);
  });

  it('CODEOWNERS の所有者の GitHub アカウントのメールアドレスだけを登録している', () => {
    const owners = ownersOf('docs/adr/0001-x.md').map((o) => o.replace(/^@/, '').toLowerCase());
    for (const email of humanAuthors) {
      const login = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(email)?.[1]?.toLowerCase();
      assert.equal(owners.includes(login), true, email);
    }
  });
});
