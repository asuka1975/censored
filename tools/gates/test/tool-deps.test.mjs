// build-tool-depends の依存を、台帳(check-deps)と層の規則(check-layers)が見落とさない。
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const GATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const cabal = (stanza) => `cabal-version: 3.8
name: censored-domain
version: 0.1.0.0

flag mutation
  default: False
  manual: True

${stanza}
`;

const registry = (hackage) => JSON.stringify({ hackage, purescript: {}, npm: {} });
const entry = (extra = {}) => ({ purpose: '用途', tier: 'test', reviewed: '2026-11-03', ...extra });

describe('build-tool-depends の依存', () => {
  let dir;
  const put = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  const run = (script) => {
    const r = spawnSync(process.execPath, [path.join(GATES, script)], { encoding: 'utf8', env: { ...process.env, GATE_ROOT: dir } });
    return r.stdout + r.stderr;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-deps-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    put('package.json', '{}');
    put('tools/policy/layers.json', JSON.stringify({
      testOnlyPackages: ['^sydtest'],
      backend: {
        root: 'backend/packages',
        prefix: 'censored-',
        layers: {
          domain: { internal: [], externalAllow: ['base', 'text'] },
          infra: { internal: ['domain'] },
        },
      },
      frontend: { root: 'frontend/packages', prefix: 'censored-', layers: {} },
    }));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  describe('台帳(check-deps)', () => {
    const TEST_SUITE = 'test-suite censored-domain-spec\n  type: exitcode-stdio-1.0\n  build-tool-depends: sydtest-discover:sydtest-discover\n';

    it('build-tool-depends だけで使うパッケージが台帳に無ければ DEP-1 にする', () => {
      put('backend/packages/domain/censored-domain.cabal', cabal(TEST_SUITE));
      put('tools/policy/dependencies.json', registry({}));
      assert.match(run('check-deps.mjs'), /\[DEP-1\] hackage:sydtest-discover が台帳/);
    });

    it('build-tool-depends だけで使うパッケージは、planned でなくても DEP-4 にしない', () => {
      put('backend/packages/domain/censored-domain.cabal', cabal(TEST_SUITE));
      put('tools/policy/dependencies.json', registry({ 'sydtest-discover': entry() }));
      assert.doesNotMatch(run('check-deps.mjs'), /\[DEP-4\]/);
    });

    it('どこからも使われず planned でもないパッケージは DEP-4 にする', () => {
      put('backend/packages/domain/censored-domain.cabal', cabal('library\n  build-depends: base\n'));
      put('tools/policy/dependencies.json', registry({ base: entry({ tier: 'standard' }), 'sydtest-discover': entry() }));
      assert.match(run('check-deps.mjs'), /\[DEP-4\] hackage:sydtest-discover はどこからも/);
    });
  });

  describe('層の規則(check-layers)', () => {
    it('domain の library が許可リストにないツールを build-tool-depends で使えば DIR-3 にする', () => {
      put('backend/packages/domain/censored-domain.cabal', cabal('library\n  build-depends: base\n  build-tool-depends: evil-tool:evil-tool\n'));
      assert.match(run('check-layers.mjs'), /\[DIR-3\] domain の library は外部パッケージ evil-tool に依存できない/);
    });

    it('domain の library が上の層の実行ファイルを build-tool-depends で使えば DIR-3 にする', () => {
      put('backend/packages/domain/censored-domain.cabal', cabal('library\n  build-depends: base\n  build-tool-depends: censored-infra:censored-infra\n'));
      assert.match(run('check-layers.mjs'), /\[DIR-3\] domain は infra に依存できない/);
    });

    it('library がテスト専用のツールを build-tool-depends で使えば DEP-7 にする', () => {
      put('backend/packages/domain/censored-domain.cabal', cabal('library\n  build-depends: base\n  build-tool-depends: sydtest-discover:sydtest-discover\n'));
      assert.match(run('check-layers.mjs'), /\[DEP-7\] sydtest-discover はテスト専用/);
    });

    it('test-suite のテスト用ツールは、許可リストになくても受理する', () => {
      put('backend/packages/domain/censored-domain.cabal', cabal(
        'library\n  build-depends: base\n\ntest-suite censored-domain-spec\n  type: exitcode-stdio-1.0\n  build-tool-depends: sydtest-discover:sydtest-discover\n',
      ));
      const output = run('check-layers.mjs');
      assert.doesNotMatch(output, /\[DIR-3\]/);
      assert.doesNotMatch(output, /\[DEP-7\]/);
    });
  });
});
