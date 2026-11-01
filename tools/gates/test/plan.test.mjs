import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectLicenses, layerViolations, productClosure } from '../lib/plan.mjs';

const unit = (id, name, style, component, depends = []) => ({
  id, 'pkg-name': name, style, 'component-name': component, depends,
});

describe('製品の依存グラフ', () => {
  const plan = [
    unit('dom', 'censored-domain', 'local', 'lib', ['text', 'base']),
    unit('dom-test', 'censored-domain', 'local', 'test:censored-domain-spec', ['dom', 'sydtest']),
    unit('text', 'text', 'global', 'lib', ['base']),
    unit('base', 'base', 'global', 'lib'),
    unit('sydtest', 'sydtest', 'global', 'lib', ['opt-env-conf']),
    unit('opt-env-conf', 'opt-env-conf', 'global', 'lib'),
  ];

  it('library から推移的に到達できるパッケージを返す', () => {
    assert.deepEqual([...productClosure(plan)].sort(), ['base', 'text']);
  });

  it('テストスイートの依存を製品に含めない', () => {
    const names = productClosure(plan);
    assert.equal(names.has('sydtest'), false);
    assert.equal(names.has('opt-env-conf'), false);
  });

  it('library がテスト専用パッケージに依存したら検出する', () => {
    const leaked = [
      ...plan.filter((u) => u.id !== 'dom'),
      unit('dom', 'censored-domain', 'local', 'lib', ['sydtest']),
    ];
    assert.equal(productClosure(leaked).has('opt-env-conf'), true);
  });

  it('実行ファイルも起点にする', () => {
    const withExe = [...plan, unit('srv', 'censored-server', 'local', 'exe:censored-server', ['sydtest'])];
    assert.equal(productClosure(withExe).has('sydtest'), true);
  });
});

describe('解決後の依存による層の検査', () => {
  const policy = {
    prefix: 'censored-',
    layers: {
      domain: { internal: [], externalAllow: ['base', 'text'] },
      application: { internal: ['domain'] },
      server: { internal: ['domain', 'application'] },
    },
  };
  const base = [
    unit('base', 'base', 'global', 'lib'),
    unit('text', 'text', 'global', 'lib'),
    unit('aeson', 'aeson', 'global', 'lib'),
    unit('dom', 'censored-domain', 'local', 'lib', ['base', 'text']),
    unit('app', 'censored-application', 'local', 'lib', ['base', 'dom', 'aeson']),
  ];

  it('規則どおりの依存を受理する', () => {
    assert.deepEqual(layerViolations(base, policy), []);
  });

  it('条件節を解決した結果の層の違反を検出する', () => {
    const plan = [...base.filter((u) => u.id !== 'dom'), unit('dom', 'censored-domain', 'local', 'lib', ['base', 'app'])];
    assert.equal(layerViolations(plan, policy).length, 1);
  });

  it('許可リスト外の外部依存を検出する', () => {
    const plan = [...base.filter((u) => u.id !== 'dom'), unit('dom', 'censored-domain', 'local', 'lib', ['aeson'])];
    assert.equal(layerViolations(plan, policy).length, 1);
  });

  it('実行ファイルの依存も検査する', () => {
    const plan = [...base, unit('exe', 'censored-domain', 'local', 'exe:x', ['app'])];
    assert.equal(layerViolations(plan, policy).length, 1);
  });

  it('テストスイートの依存を製品として扱わない', () => {
    const plan = [...base, unit('t', 'censored-domain', 'local', 'test:censored-domain-spec', ['app', 'aeson'])];
    assert.deepEqual(layerViolations(plan, policy), []);
  });

  it('自分自身の library への依存を違反にしない', () => {
    const plan = [...base, unit('exe', 'censored-application', 'local', 'exe:x', ['app'])];
    assert.deepEqual(layerViolations(plan, policy), []);
  });

  it('解決できない依存を合格にしない', () => {
    const plan = [...base, unit('exe', 'censored-application', 'local', 'exe:x', ['unknown'])];
    assert.equal(layerViolations(plan, policy).length, 1);
  });
});

describe('ライセンス情報の収集', () => {
  const read = (known) => (id) => known[id] ?? null;
  const root = (...deps) => unit('root', 'censored-domain', 'local', 'lib', deps);

  it('library のライセンスを読む', () => {
    const r = collectLicenses([root('a'), unit('a', 'a', 'global', 'lib')], read({ a: 'MIT' }));
    assert.deepEqual(r, { found: [{ name: 'a', license: 'MIT' }], missing: [] });
  });

  it('到達できる library の情報が見つからなければ欠落として報告する', () => {
    assert.deepEqual(collectLicenses([root('a'), unit('a', 'a', 'global', 'lib')], read({})).missing, ['a']);
  });

  it('推移的に到達できる library の欠落を見逃さない', () => {
    const plan = [root('a'), unit('a', 'a', 'global', 'lib', ['b']), unit('b', 'b', 'global', 'lib')];
    assert.deepEqual(collectLicenses(plan, read({ a: 'MIT' })).missing, ['b']);
  });

  it('テストスイートの依存も対象にする', () => {
    const plan = [unit('t', 'censored-domain', 'local', 'test:censored-domain-spec', ['a']), unit('a', 'a', 'global', 'lib')];
    assert.deepEqual(collectLicenses(plan, read({})).missing, ['a']);
  });

  it('ビルドツールの library も対象にする', () => {
    const tool = { ...unit('t', 't', 'global', 'exe:t', ['lib-of-tool']) };
    const plan = [{ ...root(), 'exe-depends': ['t'] }, tool, unit('lib-of-tool', 'lib-of-tool', 'global', 'lib')];
    assert.deepEqual(collectLicenses(plan, read({})).missing, ['lib-of-tool']);
  });

  it('ローカルから到達しないユニットを欠落として扱わない', () => {
    const plan = [root(), unit('tasty', 'tasty', 'global', 'lib')];
    assert.deepEqual(collectLicenses(plan, read({})), { found: [], missing: [] });
  });

  it('実行ファイルだけのユニットは欠落として扱わない', () => {
    assert.deepEqual(collectLicenses([root('a'), unit('a', 'a', 'global', 'exe:a')], read({})).missing, []);
  });

  it('パッケージ単位のユニットは library の有無で判定する', () => {
    const lib = { id: 'a', 'pkg-name': 'a', style: 'global', components: { lib: {} } };
    const exe = { id: 'b', 'pkg-name': 'b', style: 'global', components: { 'exe:b': {} } };
    assert.deepEqual(collectLicenses([root('a', 'b'), lib, exe], read({})).missing, ['a']);
  });

  it('パッケージ単位のユニットの依存を辿る', () => {
    const custom = { id: 'a', 'pkg-name': 'a', style: 'global', components: { lib: { depends: ['b'] } } };
    assert.deepEqual(collectLicenses([root('a'), custom, unit('b', 'b', 'global', 'lib')], read({ a: 'MIT' })).missing, ['b']);
  });

  it('GHC 同梱のパッケージとローカルのパッケージを対象にしない', () => {
    const plan = [root('b'), { id: 'b', 'pkg-name': 'base', type: 'pre-existing' }];
    assert.deepEqual(collectLicenses(plan, read({})), { found: [], missing: [] });
  });
});

describe('パッケージ単位のユニット(build-type: Custom)', () => {
  const custom = (id, name, style, components) => ({ id, 'pkg-name': name, style, components });

  it('製品の依存グラフが library の依存を辿る', () => {
    const plan = [custom('d', 'censored-domain', 'local', { lib: { depends: ['s'] } }), unit('s', 'sydtest', 'global', 'lib')];
    assert.equal(productClosure(plan).has('sydtest'), true);
  });

  it('製品の依存グラフにテストスイートの依存を含めない', () => {
    const plan = [custom('d', 'censored-domain', 'local', { 'test:spec': { depends: ['s'] } }), unit('s', 'sydtest', 'global', 'lib')];
    assert.equal(productClosure(plan).has('sydtest'), false);
  });

  it('層の違反を検出する', () => {
    const policy = { prefix: 'censored-', layers: { domain: { internal: [] }, infra: { internal: [] } } };
    const plan = [
      custom('d', 'censored-domain', 'local', { lib: { depends: ['i'] } }),
      unit('i', 'censored-infra', 'local', 'lib'),
    ];
    assert.equal(layerViolations(plan, policy).length, 1);
  });
});
