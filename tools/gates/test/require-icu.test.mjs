// tools/require-icu.sh と、それを呼ぶ tools/setup-toolchain.sh の ICU の確認(ADR-0009)。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// 本物の pkg-config と同じ契約の偽物: `--modversion icu-i18n` で版を出力し、ICU が無ければ 1 で終わる。
// 版の比較はしない。比較はスクリプト側の責務なので、その境界をテストで確かめる。
// FAKE_ICU_VERSION が空文字でも設定されていれば、その空の出力を終了コード 0 で返す(解釈できない出力を表す)。
const FAKE_PKG_CONFIG = `#!/bin/sh
[ "$1" = "--modversion" ] && [ "$2" = "icu-i18n" ] && [ "\${FAKE_ICU_VERSION+set}" = set ] && echo "$FAKE_ICU_VERSION"
`;

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

const systemTool = (name) => ['/usr/bin', '/bin'].map((d) => path.join(d, name)).find((p) => fs.existsSync(p));

/** pkg-config の有無と ICU の版を指定して require-icu.sh を実行する。bash は絶対パスで起動するので PATH に左右されない。 */
function runRequireIcu({ icuVersion, hasPkgConfig = true }) {
  const bin = tempDir('require-icu-');
  if (hasPkgConfig) fs.writeFileSync(path.join(bin, 'pkg-config'), FAKE_PKG_CONFIG, { mode: 0o755 });
  // 版の比較に sort と head を使うので、pkg-config がある場合だけ標準の場所も PATH に入れる。
  const PATH = hasPkgConfig ? `${bin}:/usr/bin:/bin` : bin;
  const env = icuVersion !== undefined ? { PATH, FAKE_ICU_VERSION: icuVersion } : { PATH };
  return spawnSync('/bin/bash', [path.join(ROOT, 'tools/require-icu.sh')], { env, encoding: 'utf8' });
}

/**
 * setup-toolchain.sh を一時ディレクトリへ複製して実行する(実際のリポジトリの .tools には触れない)。
 * PATH には標準の道具と偽の curl だけを置く。curl が呼ばれたら downloads.log に記録する。
 */
function runSetup({ icuVersion }) {
  const root = tempDir('setup-toolchain-');
  fs.mkdirSync(path.join(root, 'tools'));
  for (const f of ['setup-toolchain.sh', 'require-icu.sh', 'versions.env']) {
    fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(root, 'tools', f));
  }
  fs.chmodSync(path.join(root, 'tools/require-icu.sh'), 0o755);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  for (const tool of ['bash', 'mktemp', 'dirname', 'mkdir', 'rm', 'sort', 'head']) {
    fs.symlinkSync(systemTool(tool), path.join(bin, tool));
  }
  const downloads = path.join(root, 'downloads.log');
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh\necho "$@" >> "${downloads}"\nexit 1\n`, { mode: 0o755 });
  if (icuVersion) fs.writeFileSync(path.join(bin, 'pkg-config'), FAKE_PKG_CONFIG, { mode: 0o755 });
  const env = icuVersion !== undefined ? { PATH: bin, FAKE_ICU_VERSION: icuVersion } : { PATH: bin };
  const result = spawnSync('/bin/bash', [path.join(root, 'tools/setup-toolchain.sh')], { env, encoding: 'utf8' });
  return { ...result, downloaded: fs.existsSync(downloads) };
}

describe('ICU の開発ファイルの確認', () => {
  it('下限ちょうどの ICU 62.1 があるとき成功する', () => {
    assert.equal(runRequireIcu({ icuVersion: '62.1' }).status, 0);
  });

  it('下限を超える ICU 74.2 があるとき成功する', () => {
    assert.equal(runRequireIcu({ icuVersion: '74.2' }).status, 0);
  });

  it('下限に満たない ICU 62.0 のとき失敗する', () => {
    assert.equal(runRequireIcu({ icuVersion: '62.0' }).status, 1);
  });

  it('下限より桁数の多い ICU 100.1 があるとき成功する', () => {
    assert.equal(runRequireIcu({ icuVersion: '100.1' }).status, 0);
  });

  it('pkg-config が数字でない版を返すとき失敗する', () => {
    assert.equal(runRequireIcu({ icuVersion: 'abc' }).status, 1);
  });

  it('pkg-config が終了コード 0 で空の出力を返すとき失敗する', () => {
    assert.equal(runRequireIcu({ icuVersion: '' }).status, 1);
  });

  for (const malformed of ['v74.2', '74.2abc', '74..2']) {
    it(`pkg-config が数字の並びでない版 ${malformed} を返すとき失敗する`, () => {
      assert.equal(runRequireIcu({ icuVersion: malformed }).status, 1);
    });
  }

  it('ICU の開発ファイルが無いとき失敗し、導入するパッケージを示す', () => {
    const result = runRequireIcu({});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /libicu-dev/);
    assert.match(result.stderr, /pkg-config/);
  });

  it('pkg-config が無いとき失敗し、導入するパッケージを示す', () => {
    const result = runRequireIcu({ icuVersion: '74.2', hasPkgConfig: false });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /libicu-dev/);
    assert.match(result.stderr, /pkg-config/);
  });
});

describe('make setup の ICU の確認', () => {
  it('ICU の開発ファイルが無いとき終了コード 1 で止まり、何もダウンロードしない', () => {
    const result = runSetup({});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /libicu-dev/);
    assert.doesNotMatch(result.stderr, /GHC \S+ と Cabal \S+ が必要/, 'ICU の確認で止まらず、次の確認に進んでいる');
    assert.equal(result.downloaded, false);
  });

  it('ICU の開発ファイルがあるとき ICU の確認では止まらず、次の GHC の確認に進む', () => {
    const result = runSetup({ icuVersion: '74.2' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GHC \S+ と Cabal \S+ が必要/);
    assert.doesNotMatch(result.stderr, /libicu-dev/);
    assert.equal(result.downloaded, false);
  });
});
