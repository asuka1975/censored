// 切れても取得済みの位置から再開できる、メモリ上へのダウンロード。ストレージ(OPFS)を使わない。
// 計測したいのは端末の性能で、回線の安定性ではない。モバイル回線では、数百 MB の取得が途中で切れる。

const RETRY_LIMIT_MS = 15000;

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 再試行してよい失敗か。HTTP の状態が無い(ネットワークの失敗)、または一時的な状態だけ。404 などは再試行しても変わらない。 */
const isRetryable = (error) => error.status === undefined || error.status >= 500 || error.status === 429 || error.status === 408;

/**
 * url を取得して Blob にする。途中で切れたら、取得済みの位置から Range で再開する。
 * failures は呼び出し側が持つ配列で、失敗のたびに { atBytes, error } を足す(例外で終わっても、記録が残る)。
 * WHY NOT: 範囲指定を無視されたとき(200 が返る)、つなげない。取得済みを捨てて、最初からやり直す。
 */
export async function fetchToBlob(url, { onProgress = () => {}, failures = [], fetchImpl = fetch, maxRetries = 30, sleep = sleepFor } = {}) {
  let chunks = [];
  let loaded = 0;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetchImpl(url, loaded > 0 ? { headers: { Range: `bytes=${loaded}-` } } : undefined);
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
      if (loaded > 0 && response.status !== 206) {
        chunks = [];
        loaded = 0;
      }
      // 206 の content-length は残りの大きさ。
      const total = loaded + Number(response.headers.get('content-length') ?? 0);
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        onProgress({ loaded, total });
      }
      if (loaded < total) throw new Error(`応答が短い: ${loaded}/${total}`);
      return new Blob(chunks);
    } catch (error) {
      failures.push({ atBytes: loaded, error: `${error?.name ?? 'Error'}: ${error?.message ?? error}` });
      if (!isRetryable(error) || failures.length > maxRetries) throw error;
      await sleep(Math.min(1000 * 2 ** Math.min(attempt, 4), RETRY_LIMIT_MS));
    }
  }
}
