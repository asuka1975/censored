import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractJsonArray, firstFailure, graphemeCount, leakedTerms, median, parseConfig, renderPrompt, storageWarning, stripThinking, summarizeRuns, trailingFailures, validateOutput,
} from '../lib.mjs';

const IDS = [1, 2, 3];
const parse = (search) => parseConfig(search, IDS);
const POST = (n) => 'あ'.repeat(n);
const json = (items) => JSON.stringify(items);

test('構成: config と backend が正しければ、既定値を補って受け取る', () => {
  const r = parse('?config=2&backend=webgpu');
  assert.equal(r.ok, true);
  assert.deepEqual(
    { id: r.config.id, runtime: r.config.runtime, repo: r.config.repo, backend: r.config.backend, cache: r.config.cache, topics: r.config.topics, reps: r.config.reps, temperature: r.config.temperature, dtype: r.config.dtype, noThink: r.config.noThink },
    { id: 2, runtime: 'transformersjs', repo: 'onnx-community/Qwen3-1.7B-ONNX', backend: 'webgpu', cache: 'unknown', topics: IDS, reps: 1, temperature: 0, dtype: 'q4', noThink: true },
  );
});

test('構成: wllama の構成は量子化名を既定で持つ', () => {
  assert.equal(parse('?config=4&backend=wasm').config.quant, 'Q4_K_M');
});

test('構成: LFM3 の構成は /no_think を付けない', () => {
  assert.equal(parse('?config=3&backend=wasm').config.noThink, false);
  assert.equal(parse('?config=6&backend=wasm').config.noThink, false);
});

test('構成: repo、file、quant、dtype、no_think の指定は既定を上書きする', () => {
  const r = parse('?config=4&backend=wasm&repo=a/b&file=x.gguf&quant=Q8_0&dtype=fp16&no_think=0');
  assert.deepEqual(
    { repo: r.config.repo, file: r.config.file, quant: r.config.quant, dtype: r.config.dtype, noThink: r.config.noThink },
    { repo: 'a/b', file: 'x.gguf', quant: 'Q8_0', dtype: 'fp16', noThink: false },
  );
  assert.equal(parse('?config=3&backend=wasm&no_think=1').config.noThink, true);
});

test('構成: topics と reps と sampling の指定を受け取る', () => {
  const r = parse('?config=1&backend=wasm&topics=1,3&reps=3&temperature=0.7&top_p=0.8&top_k=20&threads=4&max_tokens=100&cache=cold');
  assert.deepEqual(
    { topics: r.config.topics, reps: r.config.reps, temperature: r.config.temperature, topP: r.config.topP, topK: r.config.topK, threads: r.config.threads, maxTokens: r.config.maxTokens, cache: r.config.cache },
    { topics: [1, 3], reps: 3, temperature: 0.7, topP: 0.8, topK: 20, threads: 4, maxTokens: 100, cache: 'cold' },
  );
});

test('構成: 解釈できない値は既定に落とさずエラーにする', () => {
  for (const search of [
    '?backend=wasm', '?config=9&backend=wasm', '?config=1', '?config=1&backend=gpu', '?config=1&backend=wasm&cache=hot',
    '?config=1&backend=wasm&reps=0', '?config=1&backend=wasm&reps=11', '?config=1&backend=wasm&reps=x', '?config=1&backend=wasm&reps=',
    '?config=1&backend=wasm&topics=99', '?config=1&backend=wasm&topics=', '?config=1&backend=wasm&temperature=-1',
    '?config=1&backend=wasm&max_tokens=5', '?config=1&backend=wasm&top_k=0', '?config=1&backend=wasm&threads=1.5',
  ]) {
    const r = parse(search);
    assert.equal(r.ok, false, search);
    assert.ok(r.errors.length > 0, search);
  }
});

test('構成: 数値の指定は、範囲の端の値を受け取り、一つ外側は拒否する', () => {
  const cfg = (s) => parse(`?config=1&backend=wasm&${s}`);
  assert.equal(cfg('reps=1').config.reps, 1);
  assert.equal(cfg('reps=10').config.reps, 10);
  assert.equal(cfg('max_tokens=16').config.maxTokens, 16);
  assert.equal(cfg('max_tokens=4096').config.maxTokens, 4096);
  assert.equal(cfg('max_tokens=15').ok, false);
  assert.equal(cfg('max_tokens=4097').ok, false);
  assert.equal(cfg('top_k=1000').config.topK, 1000);
  assert.equal(cfg('top_k=1001').ok, false);
  assert.equal(cfg('threads=64').config.threads, 64);
  assert.equal(cfg('threads=65').ok, false);
  assert.equal(cfg('temperature=0').config.temperature, 0);
});

test('構成: no_think は 0 か 1 だけを受け取る', () => {
  assert.equal(parse('?config=1&backend=wasm&no_think=2').ok, false);
  assert.equal(parse('?config=1&backend=wasm&no_think=').ok, false);
  assert.equal(parse('?config=3&backend=wasm&no_think=1').config.noThink, true);
  assert.equal(parse('?config=1&backend=wasm&no_think=0').config.noThink, false);
});

test('構成: jinja と chat_template は指定したときだけ渡し、指定が無ければ未指定のまま', () => {
  const none = parse('?config=6&backend=wasm').config;
  assert.equal(none.jinja, undefined);
  assert.equal(none.chatTemplate, undefined);
  assert.equal(parse('?config=6&backend=wasm&jinja=0').config.jinja, false);
  assert.equal(parse('?config=6&backend=wasm&jinja=1').config.jinja, true);
  assert.equal(parse('?config=6&backend=wasm&chat_template=chatml').config.chatTemplate, 'chatml');
  assert.equal(parse('?config=6&backend=wasm&jinja=2').ok, false);
  assert.equal(parse('?config=6&backend=wasm&chat_template=').ok, false);
});

test('失敗の連続: 末尾で連続している例外の失敗だけを数え、成功で数え直す', () => {
  const f = { failed: true };
  const ok = { valid: false };
  assert.equal(trailingFailures([]), 0);
  assert.equal(trailingFailures([f, f, ok]), 0);
  assert.equal(trailingFailures([ok, f, f]), 2);
  assert.equal(trailingFailures([f, f, ok, f]), 1);
  assert.equal(trailingFailures([ok, ok]), 0);
});

test('プロンプト形式: 既定は chat で、chatml は wllama の構成でだけ指定できる', () => {
  assert.equal(parse('?config=6&backend=wasm').config.promptFormat, 'chat');
  assert.equal(parse('?config=6&backend=wasm&prompt_format=chatml').config.promptFormat, 'chatml');
  assert.equal(parse('?config=6&backend=wasm&prompt_format=llama').ok, false);
  assert.equal(parse('?config=3&backend=wasm&prompt_format=chatml').ok, false);
  assert.equal(parse('?config=3&backend=wasm&prompt_format=chat').ok, true);
});

test('プロンプト形式: chatml は役割ごとに区切り、最後に assistant の開始を付ける(BOS は含めない)', () => {
  const messages = [{ role: 'system', content: 'S' }, { role: 'user', content: 'U\nx' }];
  assert.equal(renderPrompt(messages, 'chatml'), '<|im_start|>system\nS<|im_end|>\n<|im_start|>user\nU\nx<|im_end|>\n<|im_start|>assistant\n');
  assert.throws(() => renderPrompt(messages, 'chat'), /未対応のプロンプト形式/);
});

test('構成: use_cache は指定したときだけ渡し、0 と 1 だけを受け取る', () => {
  assert.equal(parse('?config=4&backend=wasm').config.useCache, undefined);
  assert.equal(parse('?config=4&backend=wasm&use_cache=0').config.useCache, false);
  assert.equal(parse('?config=4&backend=wasm&use_cache=1').config.useCache, true);
  assert.equal(parse('?config=4&backend=wasm&use_cache=2').ok, false);
});

test('ダウンロード方法: 既定は library で、memory は wllama の構成でだけ指定できる', () => {
  assert.equal(parse('?config=4&backend=wasm').config.download, 'library');
  assert.equal(parse('?config=4&backend=wasm&download=memory').config.download, 'memory');
  assert.equal(parse('?config=4&backend=wasm&download=disk').ok, false);
  assert.equal(parse('?config=1&backend=wasm&download=memory').ok, false);
  assert.equal(parse('?config=1&backend=wasm&download=library').ok, true);
});

test('保存の警告: wllama が OPFS を使えない状態で、download=memory でないときだけ警告する', () => {
  const wllama = { runtime: 'wllama', download: 'library' };
  assert.match(storageWarning(wllama, 'UnknownError: x'), /OPFS が使えない\(UnknownError: x\).*download=memory/);
  assert.equal(storageWarning(wllama, 'ok'), null);
  assert.equal(storageWarning({ ...wllama, download: 'memory' }, 'UnknownError: x'), null);
  assert.equal(storageWarning({ runtime: 'transformersjs', download: 'library' }, 'UnknownError: x'), null);
});

test('最初の失敗: 例外で失敗した最初の実行の本文を返し、無ければ null、長いものは切る', () => {
  assert.equal(firstFailure([]), null);
  assert.equal(firstFailure([{ failed: false, raw: 'a' }]), null);
  assert.equal(firstFailure([{ raw: 'ok' }, { failed: true, raw: 'first' }, { failed: true, raw: 'second' }]), 'first');
  assert.equal(firstFailure([{ failed: true, raw: 'abcdef' }], 3), 'abc');
});

test('構成: 複数の誤りはすべて報告する', () => {
  assert.equal(parse('?config=9&backend=gpu&cache=hot').errors.length, 3);
});

test('書記素: 結合文字と絵文字の連なりを 1 つと数える', () => {
  assert.equal(graphemeCount('あいう'), 3);
  assert.equal(graphemeCount('é'), 1);
  assert.equal(graphemeCount('👨‍👩‍👧'), 1);
  assert.equal(graphemeCount(''), 0);
});

test('思考: 閉じた <think> を取り除き、あったことを記録する', () => {
  assert.deepEqual(stripThinking('<think>\n考え\n</think>\n["a"]'), { text: '["a"]', hadThinking: true });
  assert.deepEqual(stripThinking('<think>\n\n</think>\n\n["a"]'), { text: '["a"]', hadThinking: true });
  assert.deepEqual(stripThinking('["a"]'), { text: '["a"]', hadThinking: false });
});

test('思考: 閉じていない <think> は、そこから後ろを捨てる', () => {
  assert.deepEqual(stripThinking('["a"]<think>途中'), { text: '["a"]', hadThinking: true });
  assert.equal(stripThinking('<think>途中で切れた').text, '');
});

test('JSON の取り出し: 前置きやコードフェンスがあっても配列の部分を返す', () => {
  assert.equal(extractJsonArray('結果:\n```json\n["a","b"]\n```'), '["a","b"]');
  assert.equal(extractJsonArray('なし'), null);
  assert.equal(extractJsonArray('] ['), null);
});

test('判定: 空でない 3 つの文字列で、各 140 書記素以内なら有効', () => {
  const r = validateOutput(json([POST(1), POST(70), POST(140)]));
  assert.equal(r.valid, true);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.candidates.length, 3);
});

test('判定: 141 書記素の候補は無効で、どの候補かを理由に書く', () => {
  const r = validateOutput(json([POST(1), POST(141), POST(2)]));
  assert.equal(r.valid, false);
  assert.deepEqual(r.reasons, ['候補 2 が 141 書記素(上限 140)']);
});

test('判定: 140 を数えるのは文字数ではなく書記素である', () => {
  const family = '👨‍👩‍👧'.repeat(140);
  assert.ok(family.length > 140);
  assert.equal(validateOutput(json([family, 'a', 'b'])).valid, true);
});

test('判定: 候補が 3 個でなければ無効', () => {
  assert.deepEqual(validateOutput(json(['a', 'b'])).reasons, ['候補が 2 個(3 個が必要)']);
  assert.deepEqual(validateOutput(json(['a', 'b', 'c', 'd'])).reasons, ['候補が 4 個(3 個が必要)']);
});

test('判定: 空白だけの候補と文字列でない候補は無効', () => {
  assert.deepEqual(validateOutput(json(['a', ' 　\n', 'c'])).reasons, ['候補 2 が空']);
  assert.deepEqual(validateOutput(json(['a', 1, 'c'])).reasons, ['候補 2 が文字列ではない']);
});

test('判定: JSON でない出力、配列でない JSON は無効で、理由が違う', () => {
  assert.deepEqual(validateOutput('投稿案です').reasons, ['JSON の配列が無い']);
  assert.deepEqual(validateOutput('[a, b, c]').reasons, ['JSON として解釈できない']);
  assert.deepEqual(validateOutput('').reasons, ['JSON の配列が無い']);
});

test('判定: 思考の過程と前置きがあっても、後ろの配列を判定する', () => {
  const r = validateOutput(`<think>\n[1,2]\n</think>\n以下です。\n${json(['a', 'b', 'c'])}`);
  assert.equal(r.valid, true);
  assert.equal(r.hadThinking, true);
});

test('判定: 同じ文が並ぶ出力は有効のまま、重複として印を付ける', () => {
  const r = validateOutput(json(['a', 'a', 'b']));
  assert.equal(r.valid, true);
  assert.equal(r.duplicates, true);
  assert.equal(validateOutput(json(['a', 'b', 'c'])).duplicates, false);
});

test('判定: 上限と個数は引数で変えられる', () => {
  assert.equal(validateOutput(json(['ab', 'ab']), { max: 2, count: 2 }).valid, true);
  assert.equal(validateOutput(json(['abc', 'ab']), { max: 2, count: 2 }).valid, false);
});

test('攻撃的な語: 残っている語を重複なく返し、無ければ空', () => {
  assert.deepEqual(leakedTerms(['上司がバカで', '本当にバカ、むかつく']), ['バカ', 'むかつく']);
  assert.deepEqual(leakedTerms(['落ち着いて話し合いたい']), []);
});

test('中央値: 奇数個は真ん中、偶数個は真ん中 2 つの平均、数でない値は無視する', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([1, null, NaN, 5]), 3);
  assert.equal(median([]), null);
});

const run = (over) => ({ topicId: 1, valid: true, ttftMs: 1000, totalMs: 5000, tokens: 101, truncated: false, leaked: [], ratings: {}, ...over });

test('要約: 最初の実行は別に報告し、中央値には入れない', () => {
  const s = summarizeRuns([run({ totalMs: 30000, ttftMs: 9000 }), run({ topicId: 2, totalMs: 4000 }), run({ topicId: 3, totalMs: 6000 })]);
  assert.equal(s.firstRunSeconds, 30);
  assert.equal(s.medianTotalSeconds, 5);
  assert.equal(s.medianTtftSeconds, 1);
});

test('要約: 実行が 1 回なら、その値を中央値として使う', () => {
  const s = summarizeRuns([run({ totalMs: 8000, ttftMs: 2000 })]);
  assert.equal(s.firstRunSeconds, 8);
  assert.equal(s.medianTotalSeconds, 8);
});

test('要約: 毎秒のトークン数は、最初のトークン以降で数える', () => {
  const s = summarizeRuns([run(), run({ totalMs: 11000, ttftMs: 1000, tokens: 101 })]);
  assert.equal(s.medianTokensPerSecond, 10);
});

test('要約: 有効な実行数と、すべての反復で有効だったトピックの数を分けて数える', () => {
  const s = summarizeRuns([
    run({ topicId: 1 }), run({ topicId: 1, valid: false }), run({ topicId: 2 }), run({ topicId: 2 }),
  ]);
  assert.equal(s.runs, 4);
  assert.equal(s.topics, 2);
  assert.equal(s.validRuns, 3);
  assert.equal(s.validTopics, 1);
});

test('要約: 打ち切りと攻撃的な語の残りを数える', () => {
  const s = summarizeRuns([run({ truncated: true }), run({ leaked: ['バカ'] }), run()]);
  assert.equal(s.truncatedRuns, 1);
  assert.equal(s.flaggedRuns, 1);
});

test('要約: 採点は軸ごとに、入力された値だけの平均を取る', () => {
  const s = summarizeRuns([
    run({ ratings: { moderation: 5, meaning: 3 } }), run({ ratings: { moderation: 3 } }), run(),
  ]);
  assert.equal(s.ratings.moderation, 4);
  assert.equal(s.ratings.meaning, 3);
  assert.equal(s.ratings.naturalness, null);
});

test('要約: 時間が取れなかった実行は、所要時間の中央値に影響しない', () => {
  const s = summarizeRuns([run(), run({ totalMs: null, ttftMs: null, valid: false }), run({ totalMs: 3000 })]);
  assert.equal(s.medianTotalSeconds, 3);
  assert.equal(summarizeRuns([]).firstRunSeconds, null);
  assert.equal(summarizeRuns([]).medianTotalSeconds, null);
});
