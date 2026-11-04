// 計測ハーネスの純粋な部分。ブラウザと Node の両方で動く(DOM に触れない)。

export const MAX_GRAPHEMES = 140;
export const CANDIDATE_COUNT = 3;
export const DEFAULT_MAX_TOKENS = 640;

/**
 * 計測の構成。docs/architecture/browser-llm-evaluation.md の表の # と対応する。
 * WHY NOT: リポジトリ名は推測を含む。確認できたのは onnx-community/Qwen3-0.6B-ONNX だけ(transformers.js の例)。
 * 存在しなければ読み込みが失敗し、結果に記録される。repo= と file= で差し替える。
 */
export const PRESETS = {
  1: { runtime: 'transformersjs', model: 'Qwen3-0.6B', repo: 'onnx-community/Qwen3-0.6B-ONNX', noThink: true },
  2: { runtime: 'transformersjs', model: 'Qwen3-1.7B', repo: 'onnx-community/Qwen3-1.7B-ONNX', noThink: true },
  3: { runtime: 'transformersjs', model: 'LFM3-1.7B', repo: 'onnx-community/LFM3-1.7B-ONNX', noThink: false },
  4: { runtime: 'wllama', model: 'Qwen3-0.6B', repo: 'unsloth/Qwen3-0.6B-GGUF', quant: 'Q4_K_M', noThink: true },
  5: { runtime: 'wllama', model: 'Qwen3-1.7B', repo: 'unsloth/Qwen3-1.7B-GGUF', quant: 'Q4_K_M', noThink: true },
  6: { runtime: 'wllama', model: 'LFM3-1.7B', repo: 'LiquidAI/LFM3-1.7B-GGUF', quant: 'Q4_K_M', noThink: false },
};

const BACKENDS = ['webgpu', 'wasm'];
const CACHE_STATES = ['cold', 'warm', 'unknown'];

const toNumber = (text) => (text === null || text.trim() === '' ? NaN : Number(text));

/** 検索文字列(?config=1&backend=webgpu&...)を構成に直す。解釈できない値は黙って既定にせず、エラーにする。 */
export function parseConfig(search, topicIds) {
  const q = new URLSearchParams(search);
  const errors = [];
  const preset = PRESETS[q.get('config')];
  if (!preset) errors.push(`config は ${Object.keys(PRESETS).join(', ')} のどれか(受け取った値: ${q.get('config')})`);
  const backend = q.get('backend');
  if (!BACKENDS.includes(backend)) errors.push(`backend は ${BACKENDS.join(' か ')}(受け取った値: ${backend})`);
  const cache = q.get('cache') ?? 'unknown';
  if (!CACHE_STATES.includes(cache)) errors.push(`cache は ${CACHE_STATES.join(', ')} のどれか(受け取った値: ${cache})`);

  const integer = (name, fallback, min, max) => {
    const raw = q.get(name);
    if (raw === null) return fallback;
    const n = toNumber(raw);
    if (!Number.isInteger(n) || n < min || n > max) errors.push(`${name} は ${min} 以上 ${max} 以下の整数(受け取った値: ${raw})`);
    return n;
  };
  const decimal = (name, fallback) => {
    const raw = q.get(name);
    if (raw === null) return fallback;
    const n = toNumber(raw);
    if (!Number.isFinite(n) || n < 0) errors.push(`${name} は 0 以上の数(受け取った値: ${raw})`);
    return n;
  };

  const reps = integer('reps', 1, 1, 10);
  const maxTokens = integer('max_tokens', DEFAULT_MAX_TOKENS, 16, 4096);
  const temperature = decimal('temperature', 0);
  const topP = decimal('top_p', undefined);
  const topK = integer('top_k', undefined, 1, 1000);
  const threads = integer('threads', undefined, 1, 64);

  const topicsParam = q.get('topics') ?? 'all';
  let topics = topicIds;
  if (topicsParam !== 'all') {
    topics = topicsParam.split(',').map((s) => Number(s));
    const unknown = topics.filter((id) => !topicIds.includes(id));
    if (unknown.length > 0 || topics.length === 0) errors.push(`topics は all か、${topicIds.join(',')} のうちのカンマ区切り(受け取った値: ${topicsParam})`);
  }

  const flag = (name) => {
    const raw = q.get(name);
    if (raw !== null && raw !== '0' && raw !== '1') errors.push(`${name} は 0 か 1(受け取った値: ${raw})`);
    return raw;
  };
  const noThinkParam = flag('no_think');
  const jinjaParam = flag('jinja');
  const chatTemplate = q.get('chat_template');
  if (chatTemplate === '') errors.push('chat_template が空');

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    config: {
      id: Number(q.get('config')),
      runtime: preset.runtime,
      model: preset.model,
      repo: q.get('repo') ?? preset.repo,
      file: q.get('file') ?? undefined,
      quant: q.get('quant') ?? preset.quant,
      dtype: q.get('dtype') ?? 'q4',
      backend,
      cache,
      topics,
      reps,
      maxTokens,
      temperature,
      topP,
      topK,
      threads,
      jinja: jinjaParam === null ? undefined : Boolean(Number(jinjaParam)),
      chatTemplate: chatTemplate ?? undefined,
      noThink: noThinkParam === null ? preset.noThink : Boolean(Number(noThinkParam)),
    },
  };
}

export function graphemeCount(text, segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' })) {
  let n = 0;
  for (const _ of segmenter.segment(text)) n += 1;
  return n;
}

/** 思考の過程(<think>…</think>)を取り除く。閉じていない <think> は、そこから後ろをすべて捨てる(出力の途中で打ち切られた場合)。 */
export function stripThinking(raw) {
  const closed = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  const open = closed.indexOf('<think>');
  const text = open === -1 ? closed : closed.slice(0, open);
  return { text: text.trim(), hadThinking: raw.includes('<think>') };
}

/** コードフェンスや前置きがあっても、最初の [ から最後の ] までを JSON の配列として取り出す。 */
export function extractJsonArray(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  return start === -1 || end < start ? null : text.slice(start, end + 1);
}

/**
 * 出力が使えるかを判定する。使える条件は、JSON の配列で、文字列がちょうど 3 つで、
 * 各々が空白だけでなく、140 書記素以内であること(サーバーの本文の検査と同じ)。
 */
export function validateOutput(raw, { max = MAX_GRAPHEMES, count = CANDIDATE_COUNT, counter = graphemeCount } = {}) {
  const { text, hadThinking } = stripThinking(raw);
  const reasons = [];
  const json = extractJsonArray(text);
  let candidates = null;
  if (json === null) {
    reasons.push('JSON の配列が無い');
  } else {
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) reasons.push('JSON が配列ではない');
      else candidates = parsed;
    } catch {
      reasons.push('JSON として解釈できない');
    }
  }
  if (candidates !== null) {
    if (candidates.length !== count) reasons.push(`候補が ${candidates.length} 個(${count} 個が必要)`);
    candidates.forEach((c, i) => {
      if (typeof c !== 'string') reasons.push(`候補 ${i + 1} が文字列ではない`);
      else if (c.trim() === '') reasons.push(`候補 ${i + 1} が空`);
      else if (counter(c) > max) reasons.push(`候補 ${i + 1} が ${counter(c)} 書記素(上限 ${max})`);
    });
  }
  const strings = candidates === null ? [] : candidates.filter((c) => typeof c === 'string');
  return {
    valid: reasons.length === 0,
    reasons,
    candidates: reasons.length === 0 ? candidates : strings,
    hadThinking,
    duplicates: new Set(strings).size < strings.length,
  };
}

/** 攻撃的な語が候補に残っているかの目安。採点の代わりではなく、人間が見る順番の手がかり。 */
export const FLAG_TERMS = ['バカ', '馬鹿', '無能', '消えろ', '死ね', 'クズ', 'アホ', 'ふざけるな', 'むかつく', 'ムカつく', 'うざい', 'ウザい'];

export function leakedTerms(candidates) {
  const joined = candidates.join('\n');
  return FLAG_TERMS.filter((t) => joined.includes(t));
}

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const average = (values) => {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
};

export const MAX_CONSECUTIVE_FAILURES = 3;

/** 末尾で連続している、生成の例外で失敗した実行の数。クラッシュした後に空回りを続けないために使う。 */
export function trailingFailures(runs) {
  let n = 0;
  for (let i = runs.length - 1; i >= 0 && runs[i].failed === true; i -= 1) n += 1;
  return n;
}

export const RATING_AXES = ['moderation', 'meaning', 'naturalness', 'variety'];

/** runs: { topicId, valid, ttftMs, totalMs, tokens, truncated, leaked, ratings? } の配列(実行した順)。 */
export function summarizeRuns(runs) {
  const topicIds = [...new Set(runs.map((r) => r.topicId))];
  const stable = topicIds.filter((id) => runs.filter((r) => r.topicId === id).every((r) => r.valid));
  // WHY NOT: 最初の実行は別に報告する。WebGPU はシェーダーのコンパイルで、最初の生成だけが遅い。
  const rest = runs.length > 1 ? runs.slice(1) : runs;
  const seconds = (ms) => (ms === null ? null : ms / 1000);
  const ratings = {};
  for (const axis of RATING_AXES) ratings[axis] = average(runs.map((r) => r.ratings?.[axis] ?? NaN));
  return {
    runs: runs.length,
    topics: topicIds.length,
    validRuns: runs.filter((r) => r.valid).length,
    validTopics: stable.length,
    truncatedRuns: runs.filter((r) => r.truncated).length,
    flaggedRuns: runs.filter((r) => r.leaked.length > 0).length,
    firstRunSeconds: runs.length === 0 ? null : seconds(runs[0].totalMs),
    medianTtftSeconds: seconds(median(rest.map((r) => r.ttftMs))),
    medianTotalSeconds: seconds(median(rest.map((r) => r.totalMs))),
    medianTokensPerSecond: median(rest.map((r) => (r.tokens > 1 && r.totalMs > r.ttftMs ? ((r.tokens - 1) * 1000) / (r.totalMs - r.ttftMs) : NaN))),
    ratings,
  };
}
