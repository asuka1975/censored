// 計測ページの制御。純粋な判定は lib.mjs に置き、ここは DOM とブラウザ API だけを扱う。
import { createEngine } from './engines.mjs';
import { leakedTerms, MAX_CONSECUTIVE_FAILURES, parseConfig, RATING_AXES, summarizeRuns, trailingFailures, validateOutput } from './lib.mjs';
import { buildMessages, TOPICS } from './topics.mjs';

const $ = (id) => document.getElementById(id);
const parsed = parseConfig(location.search, TOPICS.map((t) => t.id));
const runs = [];
let stopRequested = false;
let result = null;

const setStatus = (text) => { $('status').textContent = text; };

async function collectEnv() {
  const env = {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGB: navigator.deviceMemory ?? null,
    crossOriginIsolated: self.crossOriginIsolated,
    webgpu: 'gpu' in navigator,
    adapter: null,
  };
  if (env.webgpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        env.adapter = {
          vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, device: adapter.info?.device,
          description: adapter.info?.description, shaderF16: adapter.features.has('shader-f16'),
          maxBufferSize: adapter.limits.maxBufferSize,
        };
      }
    } catch (e) {
      env.adapter = { error: String(e) };
    }
  }
  return env;
}

// WHY NOT: GPU とネイティブのメモリは JavaScript から取れない。取れる値と、人が読むタスクマネージャーの値を分けて記録する。
async function memorySnapshot() {
  const out = {};
  if (self.crossOriginIsolated && performance.measureUserAgentSpecificMemory) {
    try { out.userAgentSpecificBytes = (await performance.measureUserAgentSpecificMemory()).bytes; } catch (e) { out.userAgentSpecificError = String(e); }
  }
  if (performance.memory) out.jsHeapUsedBytes = performance.memory.usedJSHeapSize;
  return out;
}

const storageUsage = async () => (navigator.storage?.estimate ? (await navigator.storage.estimate()).usage ?? null : null);

function renderConfig(config) {
  $('config').innerHTML = '';
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(config, null, 2);
  $('config').append('この設定で測る(URL の検索文字列で変える):', pre);
}

function addRow(index, entry, run) {
  const tr = document.createElement('tr');
  const cell = (content, cls) => {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    if (content instanceof Node) td.append(content); else td.textContent = content;
    tr.append(td);
    return td;
  };
  cell(String(index + 1));
  cell(entry.replyTo ? `${entry.topic}(返信先: ${entry.replyTo})` : entry.topic);
  const list = document.createElement('div');
  list.textContent = run.candidates.length > 0 ? run.candidates.map((c, i) => `${i + 1}. ${c}`).join('\n') : run.raw;
  list.style.whiteSpace = 'pre-wrap';
  cell(list);
  const verdict = run.valid ? '有効' : `無効: ${run.reasons.join('、')}`;
  cell(`${verdict}${run.leaked.length > 0 ? ` / 攻撃的な語が残る可能性: ${run.leaked.join(' ')}` : ''}${run.truncated ? ' / 途中で打ち切り' : ''}`, run.valid ? 'good' : 'bad');
  cell(run.totalMs === null ? '-' : (run.totalMs / 1000).toFixed(1));
  for (const axis of RATING_AXES) {
    const input = document.createElement('input');
    input.type = 'number'; input.min = '1'; input.max = '5'; input.step = '1';
    input.addEventListener('input', () => {
      const n = Number(input.value);
      run.ratings = { ...run.ratings, [axis]: Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined };
    });
    cell(input, 'num');
  }
  $('runs').tBodies[0].append(tr);
}

async function runBench(config) {
  $('start').disabled = true;
  $('stop').disabled = false;
  const env = await collectEnv();
  if (config.backend === 'webgpu' && !env.adapter) {
    setStatus('WebGPU のアダプターを取得できない。この端末では webgpu の経路を測れない(wasm で測り直す)。');
    $('start').disabled = false;
    return;
  }
  const progress = $('progress');
  progress.hidden = false;
  const bytes = { loaded: 0, total: 0 };
  const storageBefore = await storageUsage();
  setStatus('モデルを読み込んでいる…');
  const loadStart = performance.now();
  let load = { error: null };
  let engine = null;
  try {
    engine = await createEngine(config, ({ loaded, total }) => {
      bytes.loaded = loaded; bytes.total = total;
      if (total > 0) progress.value = loaded / total;
    });
    await engine.load();
  } catch (e) {
    load = { error: String(e?.stack ?? e) };
  }
  const loadMs = performance.now() - loadStart;
  progress.hidden = true;
  const storageAfter = await storageUsage();
  load = { ...load, cache: config.cache, loadSeconds: loadMs / 1000, downloadedBytes: bytes.loaded, totalBytes: bytes.total,
    storageDeltaBytes: storageBefore === null || storageAfter === null ? null : storageAfter - storageBefore };
  const memory = { afterLoad: await memorySnapshot() };

  let aborted = null;
  if (load.error === null) {
    const plan = Array.from({ length: config.reps }, () => TOPICS.filter((t) => config.topics.includes(t.id))).flat();
    for (const [i, entry] of plan.entries()) {
      if (stopRequested) break;
      setStatus(`生成している… ${i + 1}/${plan.length}(${entry.topic})`);
      const base = { topicId: entry.id };
      let run;
      try {
        const out = await engine.generate(buildMessages(entry, { noThink: config.noThink }));
        const verdict = validateOutput(out.text);
        run = { ...base, raw: out.text, ...verdict, leaked: leakedTerms(verdict.candidates), ttftMs: out.ttftMs, totalMs: out.totalMs, tokens: out.tokens, truncated: out.truncated, ratings: {} };
      } catch (e) {
        run = { ...base, raw: String(e?.stack ?? e), valid: false, reasons: ['生成が例外で失敗'], failed: true, candidates: [], leaked: [], ttftMs: null, totalMs: null, tokens: 0, truncated: false, hadThinking: false, duplicates: false, ratings: {} };
      }
      runs.push(run);
      addRow(runs.length - 1, entry, run);
      // WHY NOT: クラッシュした後も続けない。同じ定型の失敗を並べても情報が増えず、時間を使う。
      if (trailingFailures(runs) >= MAX_CONSECUTIVE_FAILURES) {
        aborted = `生成が ${MAX_CONSECUTIVE_FAILURES} 回続けて例外で失敗したので、${runs.length}/${plan.length} 件で止めた`;
        break;
      }
    }
    memory.afterRuns = await memorySnapshot();
  }
  const engineInfo = engine?.info() ?? null;
  await engine?.close().catch(() => {});
  result = { schema: 'censored-llm-bench/1', finishedAt: new Date().toISOString(), config, engine: engineInfo, env, load, memory, aborted, runs };
  setStatus(load.error === null ? (aborted ?? '終わった。結果を保存して、要約を渡す。') : `読み込みに失敗した: ${load.error.split('\n')[0]}`);
  $('start').disabled = false;
  $('stop').disabled = true;
  $('download').disabled = false;
  $('copy').disabled = false;
  refreshSummary();
}

// 要約は、採点の入力のたびに作り直す(貼り付ける値が最新になる)。
function currentResult() {
  return { ...result, manualMemoryMB: $('manual-memory').value === '' ? null : Number($('manual-memory').value), note: $('note').value, summary: summarizeRuns(runs) };
}

function refreshSummary() {
  if (result === null) return;
  const { runs: _omit, ...rest } = currentResult();
  $('summary').value = JSON.stringify(rest, null, 2);
}

if (!parsed.ok) {
  $('config').textContent = `URL の指定が不正:\n${parsed.errors.join('\n')}`;
  $('config').style.whiteSpace = 'pre-wrap';
  setStatus('例: /?config=1&backend=wasm&cache=cold');
} else {
  renderConfig(parsed.config);
  $('start').disabled = false;
  $('start').addEventListener('click', () => { void runBench(parsed.config); });
  $('stop').addEventListener('click', () => { stopRequested = true; });
  for (const id of ['manual-memory', 'note']) $(id).addEventListener('input', refreshSummary);
  $('runs').addEventListener('input', refreshSummary);
  $('copy').addEventListener('click', async () => { await navigator.clipboard.writeText($('summary').value); setStatus('要約をコピーした'); });
  $('download').addEventListener('click', () => {
    const c = parsed.config;
    const name = `llm-bench-c${c.id}-${c.backend}-${c.cache}-${Date.now()}.json`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(currentResult(), null, 2)], { type: 'application/json' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}
