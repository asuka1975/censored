import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkProjectLicense, spdxAllowed } from '../lib/license.mjs';

const allowed = new Set(['MIT', 'BSD-3-Clause', 'Apache-2.0', 'CC0-1.0']);

describe('SPDX 式の判定', () => {
  it('単独の許可ライセンスを受理する', () => {
    assert.equal(spdxAllowed('MIT', allowed), true);
  });

  it('許可リストにないライセンスを拒否する', () => {
    assert.equal(spdxAllowed('GPL-3.0-only', allowed), false);
  });

  it('OR は片方が許可されていれば受理する', () => {
    assert.equal(spdxAllowed('(MIT OR GPL-3.0-only)', allowed), true);
  });

  it('AND は両方の許可を要求する', () => {
    assert.equal(spdxAllowed('MIT AND GPL-3.0-only', allowed), false);
    assert.equal(spdxAllowed('MIT AND Apache-2.0', allowed), true);
  });

  it('括弧の外の AND を括弧の中の OR で打ち消さない', () => {
    assert.equal(spdxAllowed('(MIT OR GPL-3.0-only) AND GPL-3.0-only', allowed), false);
  });

  it('AND を OR より強く結合する', () => {
    assert.equal(spdxAllowed('MIT OR GPL-3.0-only AND LGPL-3.0-only', allowed), true);
    assert.equal(spdxAllowed('GPL-3.0-only OR MIT AND LGPL-3.0-only', allowed), false);
  });

  it('入れ子の括弧を解釈する', () => {
    assert.equal(spdxAllowed('((MIT AND Apache-2.0) OR GPL-3.0-only)', allowed), true);
  });

  it('WITH 付きの式は許可しない', () => {
    assert.equal(spdxAllowed('Apache-2.0 WITH LLVM-exception', allowed), false);
  });

  it('解釈できない式を許可しない', () => {
    for (const expr of ['', '(MIT', 'MIT)', 'MIT OR', 'SEE LICENSE IN LICENSE.txt', 'MIT MIT']) {
      assert.equal(spdxAllowed(expr, allowed), false, expr);
    }
    assert.equal(spdxAllowed(undefined, allowed), false);
  });
});

describe('プロジェクトのライセンス', () => {
  const approved = { MIT: 'Permission is hereby granted, free of charge', 'AGPL-3.0-or-later': 'GNU AFFERO GENERAL PUBLIC LICENSE' };
  const levels = (args) => checkProjectLicense({ approved, hasCode: true, ...args }).map((r) => r.level);

  it('未決定でコードがなければ警告にとどめる', () => {
    assert.deepEqual(levels({ text: null, declared: null, hasCode: false }), ['warn']);
  });

  it('未決定のままコードを追加したら失敗する', () => {
    assert.deepEqual(levels({ text: null, declared: null }), ['error']);
  });

  it('OSS でない本文を拒否する', () => {
    assert.deepEqual(levels({ text: 'All rights reserved.', declared: null }), ['error']);
    assert.deepEqual(levels({ text: 'All rights reserved.', declared: 'MIT' }), ['error']);
  });

  it('宣言と異なるライセンスの本文を拒否する', () => {
    assert.deepEqual(levels({ text: 'Permission is hereby granted, free of charge', declared: 'AGPL-3.0-or-later' }), ['error']);
  });

  it('一覧にないライセンスの宣言を拒否する', () => {
    assert.deepEqual(levels({ text: 'x', declared: 'BSL-1.1' }), ['error']);
  });

  it('本文のない宣言を拒否する', () => {
    assert.deepEqual(levels({ text: null, declared: 'MIT' }), ['error']);
  });

  it('宣言と本文が対応すれば受理する。改行の位置に依存しない', () => {
    assert.deepEqual(levels({ text: 'Permission is hereby\ngranted, free of\n  charge, to any person', declared: 'MIT' }), []);
  });
});
