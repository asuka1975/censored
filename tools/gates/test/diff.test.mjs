import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseChangedLines, parseNumstatZ, unquoteGitPath } from '../lib/diff.mjs';

describe('Git のパスの引用', () => {
  it('引用されていないパスをそのまま返す', () => {
    assert.equal(unquoteGitPath('b/a.hs'), 'b/a.hs');
  });

  it('8 進数で引用された日本語のパスを復元する', () => {
    assert.equal(unquoteGitPath('"b/\\346\\212\\225\\347\\250\\277.hs"'), 'b/投稿.hs');
  });

  it('タブと引用符の引用を復元する', () => {
    assert.equal(unquoteGitPath('"b/a\\tb\\"c.hs"'), 'b/a\tb"c.hs');
  });

  it('引用の中の生の日本語を壊さない', () => {
    assert.equal(unquoteGitPath('"b/投稿\\t.hs"'), 'b/投稿\t.hs');
  });
});

describe('変更行の解析', () => {
  const header = (file) => `diff --git a/${file} b/${file}\nindex 1..2 100644\n--- a/${file}\n+++ b/${file}\n`;

  it('追加された行の番号を集める', () => {
    const out = parseChangedLines(`${header('a.hs')}@@ -1,0 +2,2 @@\n+x\n+y\n`);
    assert.deepEqual([...out.get('a.hs')], [2, 3]);
  });

  it('引用されたパスを製品コードのパスとして認識する', () => {
    const diff = 'diff --git "a/x" "b/x"\n--- "a/\\346\\212\\225.hs"\n+++ "b/\\346\\212\\225.hs"\n@@ -0,0 +1 @@\n+x\n';
    assert.deepEqual([...parseChangedLines(diff).get('投.hs')], [1]);
  });

  it('++ で始まる追加行をファイル見出しと取り違えない', () => {
    const out = parseChangedLines(`${header('a.hs')}@@ -1,0 +2,3 @@\n+x =\n+++ "foo"\n+++ "bar"\n`);
    assert.deepEqual([...out.keys()], ['a.hs']);
    assert.deepEqual([...out.get('a.hs')], [2, 3, 4]);
  });

  it('次のファイルの変更行を前のファイルに混ぜない', () => {
    const out = parseChangedLines(`${header('a.hs')}@@ -1 +1 @@\n-x\n+y\n${header('b.hs')}@@ -5 +5 @@\n-x\n+y\n`);
    assert.deepEqual([...out.get('a.hs')], [1]);
    assert.deepEqual([...out.get('b.hs')], [5]);
  });

  it('削除されたファイルを変更行に含めない', () => {
    const out = parseChangedLines('diff --git a/a.hs b/a.hs\n--- a/a.hs\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n');
    assert.equal(out.size, 0);
  });
});

describe('numstat の解析', () => {
  it('NUL 区切りのパスと行数を読む', () => {
    assert.deepEqual(parseNumstatZ('3\t1\tbackend/packages/domain/src/投稿.hs\0'), [
      { file: 'backend/packages/domain/src/投稿.hs', added: 3, removed: 1 },
    ]);
  });

  it('バイナリの変更を 0 行として読む', () => {
    assert.deepEqual(parseNumstatZ('-\t-\ta.png\0'), [{ file: 'a.png', added: 0, removed: 0 }]);
  });

  it('タブを含むパスを切り詰めない', () => {
    assert.equal(parseNumstatZ('1\t0\ta\tb.hs\0')[0].file, 'a\tb.hs');
  });
});
