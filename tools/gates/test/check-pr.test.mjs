import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { declaredText, evaluate, parseRecords } from '../check-pr.mjs';

const TEMPLATE = fs.readFileSync(new URL('../../../.github/pull_request_template.md', import.meta.url), 'utf8');

const SHA = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const policy = {
  maxChangedLines: 400,
  sizeExclude: ['(^|/)pnpm-lock\\.yaml$'],
  productPaths: ['^backend/packages/'],
  protectedPaths: ['^tools/gates/'],
  requiredReviewGates: ['nfr', 'test-quality'],
};
const passed = (sha = SHA) => `Closes #1\n<!-- gate:nfr sha=${sha} verdict=pass reviewer=nfr-reviewer -->\n<!-- gate:test-quality sha=${sha} verdict=pass reviewer=test-quality-reviewer -->\n`;

function run({ files = ['backend/packages/domain/src/A.hs'], added = 10, removed = 0, body = passed(), testNamesAdded = [], testNamesRemoved = [] } = {}) {
  const addedLines = new Map(files.map((f) => [f, added]));
  const removedLines = new Map(files.map((f) => [f, removed]));
  return evaluate({ files, addedLines, removedLines, body, headSha: SHA, policy, testNamesAdded, testNamesRemoved }).map((p) => p.rule);
}

describe('PR 検査', () => {
  it('記録が揃った小さな PR を受理する', () => {
    assert.deepEqual(run(), []);
  });

  it('レビュー記録のない製品コード変更を拒否する', () => {
    assert.deepEqual(run({ body: 'Closes #1' }), ['AI-5', 'AI-5']);
  });

  it('古いコミットに対するレビュー記録を拒否する', () => {
    assert.deepEqual(run({ body: passed(OLD) }), ['AI-5', 'AI-5']);
  });

  it('不合格のレビュー記録を拒否する', () => {
    const body = passed().replace('gate:nfr sha=' + SHA + ' verdict=pass', 'gate:nfr sha=' + SHA + ' verdict=fail');
    assert.deepEqual(run({ body }), ['AI-5']);
  });

  it('製品コードに触れない PR にはレビュー記録を要求しない', () => {
    assert.deepEqual(run({ files: ['docs/x.md'], body: '' }), []);
  });

  it('課題に紐づかない製品コード変更を拒否する', () => {
    assert.deepEqual(run({ body: passed().replace('Closes #1\n', '') }), ['AI-2']);
  });

  it('上限を超える PR を拒否する', () => {
    assert.deepEqual(run({ added: 401 }), ['AI-6']);
  });

  it('理由を宣言すれば上限超過を許す', () => {
    assert.deepEqual(run({ added: 401, body: `${passed()}Size-Exception: 機械的な改名のみ\n` }), []);
  });

  it('ロックファイルをサイズに数えない', () => {
    const files = ['pnpm-lock.yaml', 'backend/packages/domain/src/A.hs'];
    const addedLines = new Map([['pnpm-lock.yaml', 5000], ['backend/packages/domain/src/A.hs', 1]]);
    const removedLines = new Map();
    const res = evaluate({ files, addedLines, removedLines, body: passed(), headSha: SHA, policy, testNamesAdded: [], testNamesRemoved: [] });
    assert.deepEqual(res, []);
  });

  it('ゲート設定と製品コードの同時変更を拒否する', () => {
    assert.deepEqual(run({ files: ['tools/gates/x.mjs', 'backend/packages/domain/src/A.hs'] }), ['AI-8']);
  });

  it('ゲート設定だけの変更を許す', () => {
    assert.deepEqual(run({ files: ['tools/gates/x.mjs'], body: '' }), []);
  });

  it('宣言のないテスト削除を拒否する', () => {
    assert.deepEqual(run({ testNamesRemoved: ['空の本文を拒否する'] }), ['TQ-M9']);
  });

  it('理由を宣言すればテスト削除を許す', () => {
    assert.deepEqual(run({ testNamesRemoved: ['空の本文を拒否する'], body: `${passed()}Test-Removal: 機能ごと廃止した\n` }), []);
  });

  it('同名で書き直したテストは削除として扱わない', () => {
    assert.deepEqual(run({ testNamesRemoved: ['空の本文を拒否する'], testNamesAdded: ['空の本文を拒否する'] }), []);
  });
});

describe('PR 本文の例外の宣言', () => {
  it('実際のテンプレートをそのまま使っても上限超過を許さない', () => {
    assert.deepEqual(run({ added: 411, body: `${TEMPLATE}\n${passed()}` }), ['AI-6']);
  });

  it('実際のテンプレートをそのまま使ってもテスト削除を許さない', () => {
    assert.deepEqual(run({ testNamesRemoved: ['空の本文を拒否する'], body: `${TEMPLATE}\n${passed()}` }), ['TQ-M9']);
  });

  it('実際のテンプレートの Closes を課題への紐付けとして数えない', () => {
    assert.deepEqual(run({ body: `${TEMPLATE}\n${passed().replace('Closes #1\n', '')}` }), ['AI-2']);
  });

  it('コメントの中の宣言を無視する', () => {
    assert.deepEqual(run({ added: 411, body: `${passed()}<!--\nSize-Exception: 理由\n-->\n` }), ['AI-6']);
  });

  it('閉じていないコメントの中の宣言を無視する', () => {
    assert.deepEqual(run({ added: 411, body: `${passed()}<!--\nSize-Exception: 理由\n` }), ['AI-6']);
  });

  it('コードブロックの中の宣言を無視する', () => {
    assert.deepEqual(run({ added: 411, body: `${passed()}\`\`\`text\nSize-Exception: 理由\n\`\`\`\n` }), ['AI-6']);
  });

  it('コメントの外の宣言を受理する', () => {
    assert.deepEqual(run({ added: 411, body: `${TEMPLATE}\n${passed()}Size-Exception: 機械的な改名のみ\n` }), []);
  });

  it('コメントの中の Issue を紐付けとして数えない', () => {
    assert.match(declaredText('<!-- Closes #1 -->\nなし'), /なし/);
    assert.deepEqual(run({ body: `${passed().replace('Closes #1\n', '')}<!-- Closes #1 -->\n` }), ['AI-2']);
  });
});

describe('レビュー記録の読み取り', () => {
  it('コードブロックの中の例を記録として数えない', () => {
    const body = `\`\`\`markdown\n<!-- gate:nfr sha=${SHA} verdict=pass reviewer=a -->\n\`\`\`\n`;
    assert.equal(parseRecords(body).size, 0);
  });

  it('判定と対象コミットを取り出す', () => {
    const r = parseRecords(passed());
    assert.equal(r.get('nfr').verdict, 'pass');
    assert.equal(r.get('test-quality').sha, SHA);
  });

  it('短縮 SHA の記録を無視する', () => {
    assert.equal(parseRecords('<!-- gate:nfr sha=abc123 verdict=pass reviewer=x -->').size, 0);
  });
});
