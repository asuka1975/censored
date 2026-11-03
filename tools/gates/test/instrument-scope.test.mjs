// ミューテーションの計測対象外の層の変更を、黙って「対象なし」にせず通知する(TQ-M10)。
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { uninstrumentedChanges } from '../lib/instrument-scope.mjs';

const GATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = { backend: { instrument: ['domain', 'application'] }, frontend: { instrument: ['core'] } };

describe('計測対象外の層の変更の集計', () => {
  it('計測対象外の層のソースの変更を、層ごとに集める', () => {
    const file = 'backend/packages/infra/src/Censored/Infra/Grapheme.hs';
    assert.deepEqual(uninstrumentedChanges([file], policy), [{ side: 'backend', layer: 'infra', files: [file] }]);
  });

  it('計測対象の層の変更は含めない', () => {
    const files = [
      'backend/packages/domain/src/Censored/Domain/Post.hs',
      'backend/packages/application/src/Censored/Application/Post.hs',
      'frontend/packages/core/src/Censored/Core/PostBody.purs',
    ];
    assert.deepEqual(uninstrumentedChanges(files, policy), []);
  });

  it('テスト、.cabal、生成コード、文書の変更は含めない', () => {
    const files = [
      'backend/packages/infra/test/Censored/Infra/GraphemeSpec.hs',
      'backend/packages/infra/censored-infra.cabal',
      'backend/packages/infra/src/Censored/Infra/Generated/Schema.hs',
      'frontend/packages/ui/test/Test/Censored/Ui/Main.purs',
      'docs/adr/0010-grapheme-counting-in-infra.md',
      'backend/packages/infra/src/Censored/Infra/notes.md',
    ];
    assert.deepEqual(uninstrumentedChanges(files, policy), []);
  });

  it('PureScript の計測対象外の層のソースも集める', () => {
    const file = 'frontend/packages/ui/src/Censored/Ui/Button.purs';
    assert.deepEqual(uninstrumentedChanges([file], policy), [{ side: 'frontend', layer: 'ui', files: [file] }]);
  });

  it('同じ層のファイルをまとめ、バックエンドとフロントエンドを区別して並べる', () => {
    const files = [
      'frontend/packages/ui/src/A.purs',
      'backend/packages/infra/src/B.hs',
      'backend/packages/infra/src/A.hs',
      'backend/packages/server/src/Main.hs',
    ];
    assert.deepEqual(uninstrumentedChanges(files, policy), [
      { side: 'backend', layer: 'infra', files: ['backend/packages/infra/src/B.hs', 'backend/packages/infra/src/A.hs'] },
      { side: 'backend', layer: 'server', files: ['backend/packages/server/src/Main.hs'] },
      { side: 'frontend', layer: 'ui', files: ['frontend/packages/ui/src/A.purs'] },
    ]);
  });

  it('変更が無ければ空を返す', () => {
    assert.deepEqual(uninstrumentedChanges([], policy), []);
  });

  it('側を指定すると、その側の変更だけを返す', () => {
    const files = ['backend/packages/infra/src/A.hs', 'frontend/packages/ui/src/A.purs'];
    assert.deepEqual(uninstrumentedChanges(files, policy, 'frontend').map((c) => c.layer), ['ui']);
    assert.deepEqual(uninstrumentedChanges(files, policy, 'backend').map((c) => c.layer), ['infra']);
  });
});

describe('ミューテーションのゲートの通知', () => {
  let dir;
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  const put = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  const commit = () => { git('add', '-A'); git('commit', '-qm', 'x'); };
  const run = (script) => {
    const r = spawnSync(process.execPath, [path.join(GATES, script), '--mode', 'diff', '--base', 'main'], {
      encoding: 'utf8', env: { ...process.env, GATE_ROOT: dir },
    });
    return { status: r.status, output: r.stdout + r.stderr };
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'instrument-scope-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'a@example.com');
    git('config', 'user.name', 'a');
    put('tools/policy/mutation.json', JSON.stringify({
      backend: { instrument: ['domain', 'application'], fullMinScore: 80 },
      frontend: { instrument: ['core'], fullMinScore: 70 },
    }));
    put('backend/packages/infra/censored-infra.cabal', 'name: censored-infra\n');
    put('backend/packages/infra/src/Grapheme.hs', 'module Grapheme where\n');
    put('backend/packages/infra/test/GraphemeSpec.hs', 'module GraphemeSpec where\n');
    put('frontend/packages/ui/src/Button.purs', 'module Button where\n');
    commit();
    git('checkout', '-q', '-b', 'feat');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('hs-mutation は、計測対象外の層のソースを変更した PR を通知して、終了コード 0 で終わる', () => {
    put('backend/packages/infra/src/Grapheme.hs', 'module Grapheme where\n-- changed\n');
    commit();
    const r = run('hs-mutation.mjs');
    assert.equal(r.status, 0);
    assert.match(r.output, /計測対象外の層の変更: backend\/infra\(1 ファイル\)/);
    assert.match(r.output, /TQ-M10/);
  });

  it('hs-mutation は、計測対象外の層のテストだけを変更したときは通知しない', () => {
    put('backend/packages/infra/test/GraphemeSpec.hs', 'module GraphemeSpec where\n-- changed\n');
    commit();
    const r = run('hs-mutation.mjs');
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.output, /計測対象外/);
  });

  it('hs-mutation は、変更が無いときは通知しない', () => {
    const r = run('hs-mutation.mjs');
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.output, /計測対象外/);
  });

  it('ps-mutation は、計測対象外の層のソースを変更した PR を通知して、終了コード 0 で終わる', () => {
    put('frontend/packages/ui/src/Button.purs', 'module Button where\n-- changed\n');
    commit();
    const r = run('ps-mutation.mjs');
    assert.equal(r.status, 0);
    assert.match(r.output, /計測対象外の層の変更: frontend\/ui\(1 ファイル\)/);
    assert.match(r.output, /TQ-M10/);
  });

  it('hs-mutation は、フロントエンドの計測対象外の層の変更を通知しない(ps-mutation と重複させない)', () => {
    put('backend/packages/infra/src/Grapheme.hs', 'module Grapheme where\n-- changed\n');
    put('frontend/packages/ui/src/Button.purs', 'module Button where\n-- changed\n');
    commit();
    const r = run('hs-mutation.mjs');
    assert.match(r.output, /backend\/infra/);
    assert.doesNotMatch(r.output, /frontend\/ui/);
  });

  it('ps-mutation は、バックエンドの計測対象外の層の変更を通知しない(hs-mutation と重複させない)', () => {
    put('backend/packages/infra/src/Grapheme.hs', 'module Grapheme where\n-- changed\n');
    put('frontend/packages/ui/src/Button.purs', 'module Button where\n-- changed\n');
    commit();
    const r = run('ps-mutation.mjs');
    assert.match(r.output, /frontend\/ui/);
    assert.doesNotMatch(r.output, /backend\/infra/);
  });

  it('ps-mutation は、変更が無いときは通知しない', () => {
    const r = run('ps-mutation.mjs');
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.output, /計測対象外/);
  });
});
