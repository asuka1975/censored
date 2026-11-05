import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchToBlob } from '../download.mjs';

const SIZE = 1000;
const DATA = Uint8Array.from({ length: SIZE }, (_, i) => i % 251);

/** from 以降を 100 バイトずつ返す本文。dropAt(絶対位置)に達すると、ネットワークの失敗に似た例外で切れる。end で静かに終わる。 */
function body(from, dropAt = Infinity, end = SIZE) {
  let at = from;
  return new ReadableStream({
    pull(controller) {
      if (at >= dropAt) return controller.error(new TypeError('Load failed'));
      if (at >= end) return controller.close();
      const next = Math.min(at + 100, end);
      controller.enqueue(DATA.slice(at, next));
      at = next;
    },
  });
}

/** 呼び出しごとに、順番に決めた応答を返す偽の fetch。呼び出しの記録(Range)も残す。 */
function fakeFetch(plan) {
  const calls = [];
  const impl = async (url, init) => {
    const range = init?.headers?.Range ?? null;
    calls.push(range);
    const step = plan[Math.min(calls.length - 1, plan.length - 1)];
    if (step.status && step.status >= 400) return new Response('x', { status: step.status });
    const from = range === null ? 0 : Number(/bytes=(\d+)-/.exec(range)[1]);
    const honored = range !== null && step.ignoreRange !== true;
    const start = honored ? from : 0;
    return new Response(body(start, step.dropAt, SIZE - (step.shortBy ?? 0)), {
      status: honored ? 206 : 200,
      headers: { 'content-length': String(SIZE - start) },
    });
  };
  return { impl, calls };
}

const noSleep = () => {
  const waits = [];
  return { sleep: async (ms) => { waits.push(ms); }, waits };
};
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

test('ダウンロード: 切れなければ 1 回で取得し、進捗は増えていき、失敗は記録されない', async () => {
  const { impl, calls } = fakeFetch([{}]);
  const progress = [];
  const failures = [];
  const blob = await fetchToBlob('u', { fetchImpl: impl, onProgress: (p) => progress.push(p), failures, ...noSleep() });
  assert.deepEqual(await bytesOf(blob), DATA);
  assert.deepEqual(calls, [null]);
  assert.deepEqual(failures, []);
  assert.equal(progress.at(-1).loaded, SIZE);
  assert.ok(progress.every((p) => p.total === SIZE));
  assert.ok(progress.every((p, i) => i === 0 || p.loaded > progress[i - 1].loaded));
});

test('ダウンロード: 途中で切れたら、取得済みの位置から Range で再開し、同じ内容になる', async () => {
  const { impl, calls } = fakeFetch([{ dropAt: 400 }, {}]);
  const failures = [];
  const blob = await fetchToBlob('u', { fetchImpl: impl, failures, ...noSleep() });
  assert.deepEqual(await bytesOf(blob), DATA);
  assert.deepEqual(calls, [null, 'bytes=400-']);
  assert.deepEqual(failures, [{ atBytes: 400, error: 'TypeError: Load failed' }]);
});

test('ダウンロード: 再開の応答の total は、取得済みと残りの合計になる', async () => {
  const { impl } = fakeFetch([{ dropAt: 300 }, {}]);
  const progress = [];
  await fetchToBlob('u', { fetchImpl: impl, onProgress: (p) => progress.push(p), ...noSleep() });
  assert.ok(progress.every((p) => p.total === SIZE), JSON.stringify(progress.at(-1)));
});

test('ダウンロード: 範囲指定を無視されたら(200)、取得済みを捨てて最初からやり直す', async () => {
  const { impl, calls } = fakeFetch([{ dropAt: 300 }, { ignoreRange: true }]);
  const progress = [];
  const blob = await fetchToBlob('u', { fetchImpl: impl, onProgress: (p) => progress.push(p), ...noSleep() });
  assert.equal(blob.size, SIZE);
  assert.deepEqual(progress.at(-1), { loaded: SIZE, total: SIZE });
  assert.deepEqual(await bytesOf(blob), DATA);
  assert.deepEqual(calls, [null, 'bytes=300-']);
});

test('ダウンロード: 応答が約束より短く終わったら、失敗として再開する', async () => {
  const { impl, calls } = fakeFetch([{ shortBy: 200 }, {}]);
  const failures = [];
  const blob = await fetchToBlob('u', { fetchImpl: impl, failures, ...noSleep() });
  assert.deepEqual(await bytesOf(blob), DATA);
  assert.equal(calls.length, 2);
  assert.match(failures[0].error, /応答が短い: 800\/1000/);
});

test('ダウンロード: 約束より 1 バイトだけ短くても、失敗として再開する', async () => {
  const { impl, calls } = fakeFetch([{ shortBy: 1 }, {}]);
  const blob = await fetchToBlob('u', { fetchImpl: impl, ...noSleep() });
  assert.deepEqual(await bytesOf(blob), DATA);
  assert.deepEqual(calls, [null, 'bytes=999-']);
});

test('ダウンロード: 404 などは再試行せず、すぐ失敗する', async () => {
  for (const status of [400, 403, 404]) {
    const { impl, calls } = fakeFetch([{ status }]);
    const failures = [];
    await assert.rejects(fetchToBlob('u', { fetchImpl: impl, failures, ...noSleep() }), new RegExp(`HTTP ${status}`));
    assert.equal(calls.length, 1, String(status));
    assert.equal(failures.length, 1);
  }
});

test('ダウンロード: 500 台、429、408 は再試行して成功する', async () => {
  for (const status of [500, 503, 429, 408]) {
    const { impl, calls } = fakeFetch([{ status }, {}]);
    const blob = await fetchToBlob('u', { fetchImpl: impl, ...noSleep() });
    assert.equal(blob.size, SIZE, String(status));
    assert.equal(calls.length, 2);
  }
});

test('ダウンロード: 再試行の上限を超えたら失敗し、すべての失敗の位置が記録に残る', async () => {
  const { impl, calls } = fakeFetch([{ dropAt: 200 }, { dropAt: 300 }, { dropAt: 400 }]);
  const failures = [];
  await assert.rejects(fetchToBlob('u', { fetchImpl: impl, failures, maxRetries: 2, ...noSleep() }), /Load failed/);
  assert.equal(calls.length, 3);
  assert.deepEqual(failures.map((f) => f.atBytes), [200, 300, 400]);
});

test('ダウンロード: 待ち時間は 1、2、4、8 秒と倍になり、15 秒で頭打ちになる', async () => {
  const { impl } = fakeFetch([{ status: 503 }]);
  const { sleep, waits } = noSleep();
  await assert.rejects(fetchToBlob('u', { fetchImpl: impl, maxRetries: 6, sleep }), /HTTP 503/);
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 15000, 15000]);
});
