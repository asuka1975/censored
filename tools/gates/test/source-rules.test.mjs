import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkComments, checkForeignImports, checkModuleHeader, checkPurity, checkPursImports, checkTestCode, checkTestName,
} from '../lib/source-rules.mjs';

const rules = (results) => results.map((r) => r.rule);

describe('コメント規約', () => {
  it('タグのない説明コメントを拒否する', () => {
    assert.deepEqual(rules(checkComments('x = 1 -- 1 を代入する\n', 'hs')), ['CMT-1']);
  });

  it('WHY NOT タグ付きのコメントを受理する', () => {
    assert.deepEqual(checkComments('-- WHY NOT: Map だと順序保持ができないので使わない\nx = 1\n', 'hs'), []);
  });

  it('複数行コメントは先頭行のタグだけで受理する', () => {
    const src = '-- WHY NOT: 再帰にしないのはスタックを\n-- 消費する入力が現実に存在するため\nx = 1\n';
    assert.deepEqual(checkComments(src, 'hs'), []);
  });

  it('理由が短すぎる WHY NOT を拒否する', () => {
    assert.deepEqual(rules(checkComments('-- WHY NOT: 遅い\nx = 1\n', 'hs')), ['CMT-2']);
  });

  it('続きの行まで含めて理由の長さを判定する', () => {
    assert.deepEqual(checkComments('-- WHY NOT: 遅い\n-- 計測では 3 倍の差があった\nx = 1\n', 'hs'), []);
  });

  it('Issue のない TODO を拒否する', () => {
    assert.deepEqual(rules(checkComments('-- TODO: あとで直す\nx = 1\n', 'hs')), ['CMT-3']);
  });

  it('Issue 付きの TODO を受理する', () => {
    assert.deepEqual(checkComments('-- TODO(#12): ページングを追加する予定\nx = 1\n', 'hs'), []);
  });

  it('Haddock は API 文書として受理する', () => {
    const src = '-- | 投稿を作る\nf :: Int\nf = 1\ng :: Int -- ^ 説明\ng = 2\n-- * 節見出し\n-- $setup\n';
    assert.deepEqual(checkComments(src, 'hs'), []);
  });

  it('コメントアウトされたコードを拒否する', () => {
    assert.deepEqual(rules(checkComments('{- f x = x + 1 -}\nx = 1\n', 'hs')), ['CMT-1']);
  });

  it('文字列の中の -- をコメントとして扱わない', () => {
    assert.deepEqual(checkComments('x = "a -- b"\n', 'hs'), []);
    assert.deepEqual(checkComments('x = """a -- b\n c"""\n', 'purs'), []);
  });

  it('QuasiQuote の中の -- をコメントとして扱わない', () => {
    assert.deepEqual(checkComments('q = [sql| select 1 -- comment\n |]\n', 'hs'), []);
  });

  it('演算子に含まれる -- をコメントとして扱わない', () => {
    assert.deepEqual(checkComments('x = a --> b\ny = a |-- b\n', 'hs'), []);
  });

  it('識別子のプライムを文字リテラルと混同しない', () => {
    assert.deepEqual(rules(checkComments("x' = y' -- 説明\n", 'hs')), ['CMT-1']);
  });

  it('文字リテラルの引用符で文字列状態に入らない', () => {
    assert.deepEqual(checkComments(`x = '"'\ny = 1\n`, 'hs'), []);
  });

  it('WHY NOT のない HLint 抑止を拒否する', () => {
    assert.deepEqual(rules(checkComments('{-# HLINT ignore "Use head" #-}\nx = 1\n', 'hs')), ['CMT-4']);
  });

  it('WHY NOT のあるミューテーション無効化を受理する', () => {
    const src = '-- WHY NOT: ログ文言はテストで固定しない方針のため\n{-# ANN f ("DisableMutationsFor g" :: String) #-}\nf = 1\n';
    assert.deepEqual(checkComments(src, 'hs'), []);
  });

  it('LANGUAGE プラグマはコメント扱いしない', () => {
    assert.deepEqual(checkComments('{-# LANGUAGE LambdaCase #-}\nx = 1\n', 'hs'), []);
  });

  it('理由のない警告の抑止を拒否する', () => {
    for (const opt of ['-Wwarn', '-w', '-Wno-orphans', '-Wno-error=deprecations', '-fno-warn-orphans', '-fdefer-type-errors']) {
      assert.deepEqual(rules(checkComments(`{-# OPTIONS_GHC ${opt} #-}\nx = 1\n`, 'hs')), ['CMT-4'], opt);
    }
  });

  it('警告に関係のない OPTIONS_GHC を拒否しない', () => {
    assert.deepEqual(checkComments('{-# OPTIONS_GHC -F -pgmF sydtest-discover #-}\n', 'hs'), []);
  });

  it('ANN 形式の HLint の抑止に理由を要求する', () => {
    const src = '{-# ANN module ("HLint: ignore Avoid restricted function" :: String) #-}\nx = 1\n';
    assert.deepEqual(rules(checkComments(src, 'hs')), ['CMT-4']);
  });

  it('理由のある ANN 形式の抑止を受理する', () => {
    const src = '-- WHY NOT: 外部の型に合わせるため例外的に許す\n{-# ANN module ("HLint: ignore x" :: String) #-}\nx = 1\n';
    assert.deepEqual(checkComments(src, 'hs'), []);
  });

  it('複数行のブロックコメントをタグで受理する', () => {
    assert.deepEqual(checkComments('{- WHY NOT: 十分な長さの理由を書いた\n理由の続きをここに書く -}\nx = 1\n', 'hs'), []);
  });

  it('タグの次の行から始まるブロックコメントを受理する', () => {
    assert.deepEqual(checkComments('{-\nWHY NOT: 十分な長さの理由を書いた\n-}\nx = 1\n', 'hs'), []);
  });

  it('続きの行を含めて理由の長さを判定する', () => {
    assert.deepEqual(checkComments('{- WHY NOT: 遅い\n計測では 3 倍の差があった -}\nx = 1\n', 'hs'), []);
  });

  it('タグのない複数行のブロックコメントを拒否する', () => {
    assert.deepEqual(rules(checkComments('{- 説明\n続き -}\nx = 1\n', 'hs')), ['CMT-1']);
  });
});

describe('モジュールヘッダ', () => {
  it('Haddock のないモジュールを拒否する', () => {
    assert.deepEqual(rules(checkModuleHeader('module A (x) where\nx = 1\n', 'hs')), ['CMT-5']);
  });

  it('Haddock のあるモジュールを受理する', () => {
    assert.deepEqual(checkModuleHeader('-- | 責務\nmodule A (x) where\nx = 1\n', 'hs'), []);
  });
});

describe('テスト名', () => {
  it('振る舞いを述べない名前を拒否する', () => {
    for (const name of ['test1', 'works', '正常系', 'テスト', 'should work fine', '正しく動く']) {
      assert.ok(checkTestName(name), name);
    }
  });

  it('条件と結果を述べた名前を受理する', () => {
    for (const name of ['501文字の本文を拒否する', 'rejects a body longer than 500 characters']) {
      assert.equal(checkTestName(name), null, name);
    }
  });
});

describe('テストコード', () => {
  it('曖昧なテスト名を報告する', () => {
    assert.deepEqual(rules(checkTestCode('spec = it "works" $ pure ()\n', 'hs')), ['TQ-M1']);
  });

  it('無効化されたテストを拒否する', () => {
    const src = 'spec = do\n  xit "保存に失敗したら再試行する" $ pure ()\n';
    assert.deepEqual(rules(checkTestCode(src, 'hs')), ['TQ-M2']);
  });

  it('Issue のない pendingWith を拒否する', () => {
    const src = 'spec = pendingWith "未読件数を返却する" "あとで"\n';
    assert.deepEqual(rules(checkTestCode(src, 'hs')), ['TQ-M2']);
  });

  it('Issue のある pendingWith を受理する', () => {
    const src = 'spec = pendingWith "未読件数を返却する" "#42 の完了待ち"\n';
    assert.deepEqual(checkTestCode(src, 'hs'), []);
  });

  it('flaky による再試行を拒否する', () => {
    const src = 'spec = flaky 3 $ it "配信キューが順序を保つ" $ pure ()\n';
    assert.deepEqual(rules(checkTestCode(src, 'hs')), ['TQ-M3']);
  });

  it('同じファイル内の重複したテスト名を報告する', () => {
    const src = 'a = it "空の本文を拒否する" x\nb = it "空の本文を拒否する" y\n';
    assert.deepEqual(rules(checkTestCode(src, 'hs')), ['TQ-M4']);
  });

  it('理由のない待機を拒否する', () => {
    const src = 'spec = it "配信が完了するまで待つ" $ threadDelay 100\n';
    assert.deepEqual(rules(checkTestCode(src, 'hs')), ['TQ-M5']);
  });

  it('コメント内の禁止語に反応しない', () => {
    const src = '-- WHY NOT: xit で無効化せず修正する方針のため\nspec = it "空の本文を拒否する" x\n';
    assert.deepEqual(checkTestCode(src, 'hs'), []);
  });

  it('識別子の一部に含まれる禁止語に反応しない', () => {
    assert.deepEqual(checkTestCode('profit = 1\npendingCount = 2\n', 'hs'), []);
  });

  it('修飾した無効化を拒否する', () => {
    const src = 'import Test.Syd qualified as Syd\nspec = Syd.xit "保存に失敗したら再試行する" x\n';
    assert.deepEqual(rules(checkTestCode(src, 'hs')), ['TQ-M2']);
  });

  it('前置の qualified でも修飾した再試行を拒否する', () => {
    const src = 'import qualified Test.Syd as S\nspec = S.flaky 3 x\n';
    assert.deepEqual(rules(checkTestCode(src, 'hs')), ['TQ-M3']);
  });

  it('モジュール名そのもので修飾した無効化を拒否する', () => {
    const src = 'import Test.Syd\nspec = Test.Syd.xit "保存に失敗したら再試行する" x\n';
    assert.deepEqual(rules(checkTestCode(src, 'hs')), ['TQ-M2']);
  });

  it('PureScript の修飾した集中実行を拒否する', () => {
    const src = 'import Test.Spec (describe) as Spec\nmain = Spec.itOnly "保存に失敗したら再試行する" x\n';
    assert.deepEqual(rules(checkTestCode(src, 'purs')), ['TQ-M2']);
  });

  it('他のモジュールの同名の関数を拒否しない', () => {
    assert.deepEqual(checkTestCode('import Layout as L\nx = L.fit 1\n', 'purs'), []);
  });

  it('レコードの同名のフィールドを拒否しない', () => {
    assert.deepEqual(checkTestCode('x = state.pending\ny = form.focus\n', 'purs'), []);
  });
});

describe('PureScript の禁止事項', () => {
  it('理由のない unsafeCoerce の import を拒否する', () => {
    assert.deepEqual(rules(checkPursImports('import Unsafe.Coerce (unsafeCoerce)\n')), ['LINT-P1']);
  });

  it('SAFETY のある unsafeCoerce の import を受理する', () => {
    const src = '-- SAFETY: 同じ実行時表現の newtype 間でのみ使う\nimport Unsafe.Coerce (unsafeCoerce)\n';
    assert.deepEqual(checkPursImports(src), []);
  });

  it('SAFETY のない foreign import を拒否する', () => {
    assert.deepEqual(rules(checkForeignImports('foreign import f :: Int\n')), ['CMT-6']);
  });

  it('SAFETY のある foreign import を受理する', () => {
    assert.deepEqual(checkForeignImports('-- SAFETY: JS 側は例外を投げず数値を返す\nforeign import f :: Int\n'), []);
  });
});

describe('純粋層', () => {
  it('Haskell の domain で IO を拒否する', () => {
    assert.deepEqual(rules(checkPurity('f :: IO ()\nf = pure ()\n', 'hs')), ['DIR-3']);
  });

  it('PureScript の core で Effect を拒否する', () => {
    assert.deepEqual(rules(checkPurity('import Effect (Effect)\n', 'purs')), ['DIR-3']);
  });

  it('識別子やコメント内の IO に反応しない', () => {
    assert.deepEqual(checkPurity('-- WHY NOT: IO を持ち込まないため\nioCount = 1\n', 'hs'), []);
  });
});
