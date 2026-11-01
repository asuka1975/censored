import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkMessage } from '../check-commits.mjs';

const rules = (msg, opts) => checkMessage(msg, opts).map((p) => p.rule);

describe('コミットログ', () => {
  it('件名と Why を持つメッセージを受理する', () => {
    const msg = 'fix(domain): 投稿本文の上限判定を修正\n\nWhy: 500 文字ちょうどの投稿が拒否され、仕様と食い違っていたため。\n\nRefs: #12\n';
    assert.deepEqual(rules(msg), []);
  });

  it('Why のないメッセージを拒否する', () => {
    assert.deepEqual(rules('fix(domain): 上限判定を修正\n\n境界値を直した\n'), ['COM-2']);
  });

  it('本文のないメッセージを拒否する', () => {
    assert.deepEqual(rules('feat: 投稿機能を追加\n'), ['COM-2']);
  });

  it('短すぎる Why を拒否する', () => {
    assert.deepEqual(rules('fix: 上限判定を修正\n\nWhy: バグだから\n'), ['COM-2']);
  });

  it('複数行にわたる Why を受理する', () => {
    const msg = 'fix: 上限判定を修正\n\nWhy: 利用者から\n500 文字の投稿が拒否されると報告があったため。\n';
    assert.deepEqual(rules(msg), []);
  });

  it('Why の直後のトレーラーを理由に含めない', () => {
    assert.deepEqual(rules('fix: 上限判定を修正\n\nWhy:\nRefs: #1234567890123456\n'), ['COM-2']);
  });

  it('形式に沿わない件名を拒否する', () => {
    assert.deepEqual(rules('上限判定を修正\n\nWhy: 500 文字の投稿が拒否されていたため。\n'), ['COM-1']);
  });

  it('件名の直後に空行がなければ拒否する', () => {
    assert.deepEqual(rules('fix: 修正\nWhy: 500 文字の投稿が拒否されていたため。\n').includes('COM-1'), true);
  });

  it('破壊的変更には移行方法を要求する', () => {
    assert.deepEqual(rules('feat(contract)!: 投稿 API を変更\n\nWhy: 添付を複数持てるようにする要望に応えるため。\n'), ['COM-4']);
  });

  it('移行方法のある破壊的変更を受理する', () => {
    const msg = 'feat(contract)!: 投稿 API を変更\n\nWhy: 添付を複数持てるようにする要望に応えるため。\n\nBREAKING CHANGE: media_id を media_ids へ置き換える\n';
    assert.deepEqual(rules(msg), []);
  });

  it('形式の誤った ADR トレーラーを拒否する', () => {
    const msg = 'feat: 配信方式を変更\n\nWhy: 書き込み時の負荷が上限に達したため。\n\nADR: 7\n';
    assert.deepEqual(rules(msg), ['COM-5']);
  });

  it('PR の範囲検査では fixup コミットを拒否する', () => {
    assert.deepEqual(rules('fixup! fix: 上限判定を修正\n', { inRange: true }), ['COM-6']);
  });

  it('件名が Merge で始まるだけのコミットを対象外にしない', () => {
    assert.deepEqual(rules('Merge whatever\n'), ['COM-1', 'COM-2']);
  });

  it('手元での fixup コミットは許す', () => {
    assert.deepEqual(rules('fixup! fix: 上限判定を修正\n'), []);
  });

  it('git のコメント行を本文として数えない', () => {
    assert.deepEqual(rules('fix: 修正\n\n# Why: コメントアウトされた理由の行です\n'), ['COM-2']);
  });
});
