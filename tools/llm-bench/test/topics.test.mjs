import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { graphemeCount } from '../lib.mjs';
import { buildMessages, SYSTEM_PROMPT, TOPICS } from '../topics.mjs';

const DOC = fs.readFileSync(fileURLToPath(new URL('../../../docs/architecture/browser-llm-evaluation.md', import.meta.url)), 'utf8');

const section = (title) => {
  const start = DOC.indexOf(`\n## ${title}\n`);
  assert.notEqual(start, -1, `${title} の節が文書に無い`);
  const next = DOC.indexOf('\n## ', start + 1);
  return DOC.slice(start, next === -1 ? undefined : next);
};

test('トピック: 暴言が 10 件以上、返信が含まれ、すべて 20 書記素以内で、番号が 1 から続く', () => {
  assert.ok(TOPICS.filter((t) => t.kind === 'abusive').length >= 10);
  assert.ok(TOPICS.filter((t) => t.kind === 'reply').length >= 1);
  assert.deepEqual(TOPICS.map((t) => t.id), TOPICS.map((_, i) => i + 1));
  for (const t of TOPICS) assert.ok(graphemeCount(t.topic) <= 20, t.topic);
  for (const t of TOPICS.filter((x) => x.kind === 'reply')) assert.ok(t.replyTo, `${t.topic} に返信先が無い`);
});

test('文書: 計測に使うプロンプトは、文書の草案と一字一句同じ', () => {
  const block = section('プロンプトの草案').match(/```text\n([\s\S]*?)\n```/);
  assert.ok(block, '文書にプロンプトのコードブロックが無い');
  assert.equal(SYSTEM_PROMPT, block[1]);
});

test('文書: 計測に使うトピックは、文書の表と同じ(番号、種類、文言、返信先)', () => {
  const kinds = { 通常: 'normal', '通常(否定的)': 'normal', 暴言: 'abusive', 返信: 'reply' };
  const rows = section('トピックの集合').split('\n')
    .filter((l) => /^\| \d+ \|/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .map(([id, kind, topic, replyTo]) => ({ id: Number(id), kind: kinds[kind], topic, ...(replyTo ? { replyTo } : {}) }));
  assert.deepEqual(TOPICS, rows);
});

test('入力: 返信は返信先の投稿を含み、通常のトピックは含まない', () => {
  const reply = buildMessages(TOPICS[12], { noThink: false });
  assert.equal(reply[1].content, '返信先の投稿: 新しいスマホを買った\nトピック: 自慢うざい');
  assert.equal(buildMessages(TOPICS[0], { noThink: false })[1].content, 'トピック: 新しいカフェに行った');
});

test('入力: システムプロンプトは先頭に置き、noThink のときだけ /no_think を末尾に付ける', () => {
  const plain = buildMessages(TOPICS[0], { noThink: false });
  const soft = buildMessages(TOPICS[0], { noThink: true });
  assert.deepEqual(plain.map((m) => m.role), ['system', 'user']);
  assert.equal(plain[0].content, SYSTEM_PROMPT);
  assert.ok(!plain[1].content.includes('/no_think'));
  assert.ok(soft[1].content.endsWith('\n/no_think'));
});
