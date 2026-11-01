import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { warningSuppressions } from '../lib/ghc-options.mjs';
import { parseCabal, parseSpago } from '../lib/manifests.mjs';

const CABAL = `cabal-version: 3.8
name: censored-domain
version: 0.1.0.0

flag mutation
  default: False
  manual: True

library
  hs-source-dirs: src
  exposed-modules: Censored.Domain.Post
  -- コメント行は無視する
  build-depends:
      base >=4.20 && <5
    , text ^>=2.1
    , containers
  ghc-options: -Wno-orphans
  if flag(mutation)
    build-depends: sydtest-mutation-plugin, sydtest-mutation-runtime
    ghc-options: -fplugin=Test.Syd.Mutation.Plugin

test-suite censored-domain-spec
  type: exitcode-stdio-1.0
  main-is: Main.hs
  build-depends: base, censored-domain, sydtest
`;

describe('.cabal の解析', () => {
  const parsed = parseCabal(CABAL);
  const lib = parsed.stanzas.find((s) => s.kind === 'library');
  const test = parsed.stanzas.find((s) => s.kind === 'test-suite');

  it('パッケージ名とフラグを読む', () => {
    assert.equal(parsed.name, 'censored-domain');
    assert.deepEqual(parsed.flags, ['mutation']);
  });

  it('複数行の依存からバージョン制約を除いて読む', () => {
    assert.deepEqual(lib.deps, ['base', 'text', 'containers']);
  });

  it('mutation フラグの中の依存を本来の依存と分ける', () => {
    assert.deepEqual(lib.flagDeps, ['sydtest-mutation-plugin', 'sydtest-mutation-runtime']);
  });

  it('警告抑止の検出のために ghc-options を分けて読む', () => {
    assert.deepEqual(lib.ghcOptions, ['-Wno-orphans']);
    assert.deepEqual(lib.flagGhcOptions, ['-fplugin=Test.Syd.Mutation.Plugin']);
  });

  it('テストスイートの名前と依存を読む', () => {
    assert.equal(test.name, 'censored-domain-spec');
    assert.deepEqual(test.deps, ['base', 'censored-domain', 'sydtest']);
  });
});

describe('.cabal の共通 stanza と条件節', () => {
  const libOf = (text) => parseCabal(`name: censored-domain\n${text}`).stanzas.find((s) => s.kind === 'library');

  it('common stanza の依存を import 先へ展開する', () => {
    const lib = libOf('common shared\n  build-depends: hedgehog\n\nlibrary\n  import: shared\n  build-depends: base\n');
    assert.deepEqual(lib.deps.sort(), ['base', 'hedgehog']);
  });

  it('common stanza の入れ子を展開する', () => {
    const lib = libOf('common a\n  build-depends: x\ncommon b\n  import: a\n  build-depends: y\nlibrary\n  import: b\n');
    assert.deepEqual(lib.deps.sort(), ['x', 'y']);
  });

  it('common stanza の警告抑止を展開する', () => {
    const lib = libOf('common a\n  ghc-options: -Wno-orphans\nlibrary\n  import: a\n');
    assert.deepEqual(lib.ghcOptions, ['-Wno-orphans']);
  });

  it('未定義の common stanza を合格にしない', () => {
    const parsed = parseCabal('name: x\nlibrary\n  import: missing\n');
    assert.equal(parsed.unsupported.length, 1);
  });

  it('循環した import で止まらない', () => {
    const lib = libOf('common a\n  import: b\n  build-depends: x\ncommon b\n  import: a\nlibrary\n  import: a\n');
    assert.deepEqual(lib.deps, ['x']);
  });

  it('前のフィールドの直後の条件節の依存を見落とさない', () => {
    const lib = libOf('library\n  hs-source-dirs: src\n  if os(linux)\n    build-depends: censored-application\n    ghc-options: -Wno-orphans\n');
    assert.deepEqual(lib.deps, ['censored-application']);
    assert.deepEqual(lib.ghcOptions, ['-Wno-orphans']);
  });

  it('条件節の両方の分岐を依存に含める', () => {
    const lib = libOf('library\n  if os(linux)\n    build-depends: a\n  else\n    build-depends: b\n');
    assert.deepEqual(lib.deps.sort(), ['a', 'b']);
  });

  it('mutation フラグの否定を計器として扱わない', () => {
    const lib = libOf('library\n  if !flag(mutation)\n    build-depends: censored-infra\n');
    assert.deepEqual(lib.deps, ['censored-infra']);
    assert.deepEqual(lib.flagDeps, []);
  });

  it('mutation フラグの else を計器として扱わない', () => {
    const lib = libOf('library\n  if flag(mutation)\n    build-depends: sydtest-mutation-runtime\n  else\n    build-depends: censored-infra\n');
    assert.deepEqual(lib.deps, ['censored-infra']);
    assert.deepEqual(lib.flagDeps, ['sydtest-mutation-runtime']);
  });

  it('他の条件と組み合わせた mutation フラグを計器として扱わない', () => {
    const lib = libOf('library\n  if flag(mutation) || os(linux)\n    build-depends: censored-infra\n');
    assert.deepEqual(lib.deps, ['censored-infra']);
  });

  it('条件節の後に戻ったフィールドを通常の依存として読む', () => {
    const lib = libOf('library\n  if flag(mutation)\n    build-depends: sydtest-mutation-runtime\n  build-depends: base\n');
    assert.deepEqual(lib.deps, ['base']);
  });

  it('波括弧のレイアウトを合格にしない', () => {
    assert.ok(parseCabal('name: x\nlibrary {\n  build-depends: censored-infra\n}\n').unsupported.length > 0);
  });

  it('サブライブラリ指定の依存を分割しない', () => {
    assert.deepEqual(libOf('library\n  build-depends: censored-domain:{a,b}, text\n').deps, ['censored-domain', 'text']);
  });

  it('実行ファイルの依存を読む', () => {
    const parsed = parseCabal('name: x\nexecutable srv\n  build-depends: censored-infra\n');
    assert.deepEqual(parsed.stanzas[0].deps, ['censored-infra']);
  });
});

describe('警告抑止の検出', () => {
  it('警告を抑止するオプションを検出する', () => {
    const options = ['-w', '-Wwarn', '-Wwarn=deprecations', '-Wno-orphans', '-Wno-error=deprecations', '-fno-warn-orphans', '-fdefer-type-errors'];
    assert.deepEqual(warningSuppressions(options), options);
  });

  it('警告に関係のないオプションを巻き込まない', () => {
    assert.deepEqual(warningSuppressions(['-threaded', '-rtsopts', '-with-rtsopts=-N', '-Wall', '-Werror']), []);
  });
});

const SPAGO = `package:
  name: censored-core
  dependencies:
    - either
    - prelude: ">=6.0.0 <7.0.0"
    - strings
  build:
    strict: true
    pedanticPackages: true
  test:
    main: Test.Censored.Core.Main
    strict: true
    pedanticPackages: true
    dependencies:
      - effect
      - spec
`;

describe('spago.yaml の解析', () => {
  const parsed = parseSpago(SPAGO);

  it('本体の依存とテストの依存を分けて読む', () => {
    assert.deepEqual(parsed.deps, ['either', 'prelude', 'strings']);
    assert.deepEqual(parsed.testDeps, ['effect', 'spec']);
  });

  it('厳格ビルドの設定とテストの起点を読む', () => {
    assert.equal(parsed.strict, true);
    assert.equal(parsed.pedantic, true);
    assert.equal(parsed.testStrict, true);
    assert.equal(parsed.testPedantic, true);
    assert.equal(parsed.testMain, 'Test.Censored.Core.Main');
  });

  it('未指定の厳格設定を false として読む', () => {
    assert.equal(parseSpago('package:\n  name: x\n').strict, false);
  });

  it('ワークスペースの extraPackages を検出する', () => {
    const w = parseSpago('workspace:\n  extraPackages:\n    foo:\n      git: https://example.com\n');
    assert.deepEqual(w.extraPackages, ['foo']);
  });

  it('フロー形式の依存を読む', () => {
    assert.deepEqual(parseSpago('package:\n  name: censored-core\n  dependencies: [prelude, effect, censored-app]\n').deps, ['prelude', 'effect', 'censored-app']);
  });

  it('引用符つきの依存を読む', () => {
    assert.deepEqual(parseSpago('package:\n  dependencies:\n    - "effect"\n    - \'censored-app\'\n').deps, ['effect', 'censored-app']);
  });

  it('インラインのマッピングの依存を読む', () => {
    assert.deepEqual(parseSpago('package:\n  dependencies:\n    - { effect: ">=4.0.0" }\n').deps, ['effect']);
  });

  it('フロー形式のパッケージ定義を読む', () => {
    const parsed = parseSpago('package: {name: censored-core, dependencies: [effect], build: {strict: true}}\n');
    assert.deepEqual(parsed.deps, ['effect']);
    assert.equal(parsed.strict, true);
  });

  it('アンカーと参照を解決する', () => {
    const parsed = parseSpago('package:\n  dependencies: &d\n    - effect\n  test:\n    dependencies: *d\n');
    assert.deepEqual(parsed.testDeps, ['effect']);
  });

  it('文字列の true を厳格設定として扱わない', () => {
    assert.equal(parseSpago('package:\n  build:\n    strict: "true"\n').strict, false);
  });

  it('壊れた YAML を空の依存として合格にしない', () => {
    assert.equal(parseSpago('package:\n  dependencies: [a\n').unsupported.length, 1);
  });

  it('配列でない依存を合格にしない', () => {
    assert.equal(parseSpago('package:\n  dependencies: effect\n').unsupported.length, 1);
  });

  it('解釈できない要素を合格にしない', () => {
    assert.equal(parseSpago('package:\n  dependencies:\n    - [effect]\n').unsupported.length, 1);
  });
});
