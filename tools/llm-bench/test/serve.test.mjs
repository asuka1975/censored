import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, isolationHeaders } from '../serve.mjs';

async function withServer(isolation, fn) {
  const server = createServer({ isolation });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('配信: isolation=off では COOP と COEP を付けない', () => {
  assert.deepEqual(isolationHeaders('off'), {});
});

test('配信: require-corp と credentialless は、COOP と COEP の両方を付ける', () => {
  assert.deepEqual(isolationHeaders('require-corp'), { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
  assert.equal(isolationHeaders('credentialless')['Cross-Origin-Embedder-Policy'], 'credentialless');
});

test('配信: 未知の isolation は拒否する', () => {
  assert.throws(() => isolationHeaders('on'), /isolation は/);
  assert.throws(() => createServer({ isolation: 'x' }), /isolation は/);
});

test('配信: ページと 4 つのモジュールを、種類に合った型で返す', async () => {
  await withServer('off', async (base) => {
    for (const [p, type] of [['/', 'text/html'], ['/index.html', 'text/html'], ['/bench.mjs', 'text/javascript'], ['/engines.mjs', 'text/javascript'], ['/lib.mjs', 'text/javascript'], ['/topics.mjs', 'text/javascript']]) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, p);
      assert.ok(res.headers.get('content-type').startsWith(type), p);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(res.headers.get('cross-origin-opener-policy'), null);
      assert.ok((await res.text()).length > 0, p);
    }
  });
});

test('配信: isolation を指定すると、すべての応答にヘッダーが付く', async () => {
  await withServer('require-corp', async (base) => {
    const res = await fetch(`${base}/lib.mjs`);
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(res.headers.get('cross-origin-embedder-policy'), 'require-corp');
  });
});

test('配信: 許可していないパスと、パスをさかのぼる指定は 404', async () => {
  await withServer('off', async (base) => {
    for (const p of ['/serve.mjs', '/test/lib.test.mjs', '/%2e%2e/%2e%2e/package.json', '/..%2fserve.mjs', '/nothing']) {
      assert.equal((await fetch(base + p)).status, 404, p);
    }
    assert.equal((await fetch(`${base}/lib.mjs`, { method: 'POST' })).status, 404);
  });
});
