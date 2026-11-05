// 端末の診断。ライブラリを使わず、モデルを読み込む前提の能力を 1 つずつ試し、どこで失敗するかを残す。
// 計測の道具と同じく使い捨て。確保した領域は、試したあとにすべて解放する。
const MIB = 1024 * 1024;
const q = new URLSearchParams(location.search);
const list = (name, fallback) => (q.get(name) ?? fallback).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
const SIZES = { opfs: list('opfs_mib', '64,256,512'), mem: list('mem_mib', '256,512,1024,2048'), gpu: list('gpu_mib', '256,512,1024') };
const HF_REPO = q.get('repo') ?? 'unsloth/Qwen3-0.6B-GGUF';
const HF_FILE = q.get('file') ?? 'Qwen3-0.6B-Q4_K_M.gguf';

const result = { schema: 'censored-llm-probe/1', startedAt: new Date().toISOString(), userAgent: navigator.userAgent, sizes: SIZES, steps: {} };
const $ = (id) => document.getElementById(id);
const describe = (e) => `${e?.name ?? 'Error'}: ${e?.message ?? e}`;
const render = () => { $('out').value = JSON.stringify(result, null, 2); };

async function step(name, fn) {
  $('status').textContent = `試している: ${name}`;
  const t = performance.now();
  try {
    result.steps[name] = { ok: true, ...(await fn()), ms: Math.round(performance.now() - t) };
  } catch (e) {
    result.steps[name] = { ok: false, error: describe(e), ms: Math.round(performance.now() - t) };
  }
  render();
}

// 大きさを小さい方から試し、最初に失敗した大きさとその理由を返す。
async function ladder(sizes, attempt) {
  const reached = [];
  for (const mib of sizes) {
    try {
      await attempt(mib);
      reached.push(mib);
    } catch (e) {
      return { reachedMiB: reached, failedAtMiB: mib, error: describe(e) };
    }
  }
  return { reachedMiB: reached, failedAtMiB: null };
}

const OPFS_WORKER = `
onmessage = async (e) => {
  const { mib } = e.data;
  let handle = null;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('probe', { create: true });
    const file = await dir.getFileHandle('probe.bin', { create: true });
    handle = await file.createSyncAccessHandle();
    handle.truncate(0);
    const chunk = new Uint8Array(8 * 1024 * 1024);
    let written = 0;
    const t = performance.now();
    while (written < mib * 1024 * 1024) { handle.write(chunk, { at: written }); written += chunk.byteLength; }
    handle.flush();
    postMessage({ ok: true, writtenMiB: written / 1048576, seconds: (performance.now() - t) / 1000 });
  } catch (err) {
    postMessage({ ok: false, error: (err && err.name) + ': ' + (err && err.message) });
  } finally {
    try { handle && handle.close(); } catch {}
    try { const root = await navigator.storage.getDirectory(); await root.removeEntry('probe', { recursive: true }); } catch {}
  }
};`;

// WHY NOT: メモリの確保をページで続けて試さない。解放を GC に任せると試行が積み上がり、小さい大きさで失敗したように見える。
// 64 KiB が 1 ページ。ワーカーを終えれば、確保した領域は確実に手放される。
const MEMORY_WORKER = `
onmessage = (e) => {
  try {
    const memory = new WebAssembly.Memory({ initial: e.data.mib * 16 });
    postMessage({ ok: memory.buffer.byteLength === e.data.mib * 1048576, error: 'ok=false: 確保した大きさが違う' });
  } catch (err) {
    postMessage({ ok: false, error: (err && err.name) + ': ' + (err && err.message) });
  }
};`;

const inWorker = (code, message) => new Promise((resolve, reject) => {
  const worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), { type: 'module' });
  worker.onmessage = (e) => { worker.terminate(); resolve(e.data); };
  worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'ワーカーのエラー')); };
  worker.postMessage(message);
});

async function run() {
  $('start').disabled = true;
  await step('環境', async () => {
    let mem64 = false;
    try { new WebAssembly.Memory({ address: 'i64', initial: 1n }); mem64 = true; } catch { /* 未対応 */ }
    return {
      crossOriginIsolated: self.crossOriginIsolated, sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      jspi: !!WebAssembly.Suspending, memory64: mem64, hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGB: navigator.deviceMemory ?? null, secureContext: self.isSecureContext,
    };
  });
  await step('ストレージの見積り', async () => {
    const e = await navigator.storage.estimate();
    return { usageMiB: Math.round(e.usage / MIB), quotaMiB: Math.round(e.quota / MIB), persisted: await navigator.storage.persisted?.() ?? null };
  });
  await step('取得先への接続(API)', async () => {
    const r = await fetch(`https://huggingface.co/api/models/${HF_REPO}`);
    return { status: r.status };
  });
  await step('取得先への接続(ファイルの先頭 1 MiB)', async () => {
    const r = await fetch(`https://huggingface.co/${HF_REPO}/resolve/main/${HF_FILE}`, { headers: { Range: 'bytes=0-1048575' } });
    const body = await r.arrayBuffer();
    return { status: r.status, readBytes: body.byteLength };
  });
  await step('モジュールのワーカー', async () => ({ reply: await inWorker('onmessage = (e) => postMessage(e.data + 1);', 41) }));
  await step('OPFS(ワーカーで書き込み)', () => ladder(SIZES.opfs, async (mib) => {
    const r = await inWorker(OPFS_WORKER, { mib });
    if (!r.ok) throw new Error(r.error);
  }));
  await step('WebAssembly のメモリ(試行ごとにワーカーを作って終える)', () => ladder(SIZES.mem, async (mib) => {
    const r = await inWorker(MEMORY_WORKER, { mib });
    if (!r.ok) throw new Error(r.error);
  }));
  await step('WebGPU', async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error('アダプターを取得できない');
    const limits = { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize };
    const device = await adapter.requestDevice({ requiredLimits: limits });
    try {
      const buffers = await ladder(SIZES.gpu, async (mib) => {
        device.pushErrorScope('out-of-memory');
        const buffer = device.createBuffer({ size: mib * MIB, usage: GPUBufferUsage.STORAGE });
        const oom = await device.popErrorScope();
        buffer.destroy();
        if (oom) throw new Error(`out-of-memory: ${oom.message}`);
      });
      return { shaderF16: adapter.features.has('shader-f16'), limits, buffers };
    } finally {
      device.destroy();
    }
  });
  $('status').textContent = '終わった。下の結果を貼る。';
  $('start').disabled = false;
}

$('start').addEventListener('click', () => { void run(); });
$('copy').addEventListener('click', async () => { await navigator.clipboard.writeText($('out').value); $('status').textContent = 'コピーした'; });
render();
