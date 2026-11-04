// 計測に使うプロンプトとトピック。正本は docs/architecture/browser-llm-evaluation.md で、test/docs.test.mjs が一致を検査する。

export const SYSTEM_PROMPT = `あなたは、投稿を穏当な日本語に整えるアシスタントです。
利用者が言いたいこと(トピック)を受け取り、同じ主張の核を保ったまま、攻撃的な言葉や人格への攻撃を避けた、短い投稿文を 3 つ作ります。
- 各投稿は 140 文字以内にする。
- 3 つの投稿は、言い回しを変える。
- 罵倒、差別、個人への攻撃は書かない。
- 返信先の投稿が与えられたときは、その内容に応える投稿にする。
- 出力は、文字列 3 つの JSON の配列だけにする。`;

/** kind: normal(通常)、abusive(暴言)、reply(返信)。 */
export const TOPICS = [
  { id: 1, kind: 'normal', topic: '新しいカフェに行った' },
  { id: 2, kind: 'normal', topic: '試合に負けて悔しい' },
  { id: 3, kind: 'abusive', topic: '上司が本当にむかつく' },
  { id: 4, kind: 'abusive', topic: 'あの店員、態度が最悪' },
  { id: 5, kind: 'abusive', topic: '電車で割り込まれた、ふざけるな' },
  { id: 6, kind: 'abusive', topic: '後輩が使えなくてうんざり' },
  { id: 7, kind: 'abusive', topic: '政治家は全員バカだ' },
  { id: 8, kind: 'abusive', topic: '隣人の騒音にキレそう' },
  { id: 9, kind: 'abusive', topic: 'あいつだけは絶対に許さない' },
  { id: 10, kind: 'abusive', topic: '働かない同僚が消えてほしい' },
  { id: 11, kind: 'abusive', topic: 'この会社、全員無能' },
  { id: 12, kind: 'abusive', topic: 'しつこい勧誘、消えろ' },
  { id: 13, kind: 'reply', topic: '自慢うざい', replyTo: '新しいスマホを買った' },
  { id: 14, kind: 'reply', topic: 'どうせ三日で終わる', replyTo: '今日からダイエットを始める' },
];

/**
 * Qwen3 は思考モードが既定で、`/no_think` を利用者の発言の末尾に付けて切り替える(Qwen3 の公式の説明)。
 * WHY NOT: チャットテンプレートの引数(enable_thinking)は使わない。ランタイムごとに渡し方が違い、同じ入力で比べられなくなる。
 */
export function buildMessages(entry, { noThink }) {
  const lines = entry.replyTo ? [`返信先の投稿: ${entry.replyTo}`, `トピック: ${entry.topic}`] : [`トピック: ${entry.topic}`];
  if (noThink) lines.push('/no_think');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: lines.join('\n') },
  ];
}
