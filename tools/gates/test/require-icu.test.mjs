// tools/require-icu.sh: ICU の開発ファイルが無いまま進めず、導入方法を示して止まる(ADR-0009)。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = path.join(ROOT, 'tools/require-icu.sh');

// 本物の pkg-config の代わりに、`--exists "icu-i18n >= N"` を FAKE_ICU_VERSION と比べるだけの偽物。
const FAKE_PKG_CONFIG = `#!/bin/sh
[ "$1" = "--exists" ] || exit 2
set -- $2
[ "$1" = "icu-i18n" ] || exit 1
[ -n "$FAKE_ICU_VERSION" ] || exit 1
lowest=$(printf '%s\\n%s\\n' "$3" "$FAKE_ICU_VERSION" | sort -V | head -n 1)
[ "$lowest" = "$3" ]
`;

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

/** pkg-config が PATH にあるか、ICU がどの版かを指定して実行する。bash は絶対パスで起動するので PATH に左右されない。 */
function run({ icuVersion, hasPkgConfig = true }) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'require-icu-'));
  dirs.push(bin);
  if (hasPkgConfig) fs.writeFileSync(path.join(bin, 'pkg-config'), FAKE_PKG_CONFIG, { mode: 0o755 });
  // 偽物が sort と head を使うので、pkg-config がある場合だけ標準の場所も PATH に入れる。
  const PATH = hasPkgConfig ? `${bin}:/usr/bin:/bin` : bin;
  const env = icuVersion ? { PATH, FAKE_ICU_VERSION: icuVersion } : { PATH };
  return spawnSync('/bin/bash', [SCRIPT], { env, encoding: 'utf8' });
}

describe('ICU の開発ファイルの確認', () => {
  it('下限ちょうどの ICU 62.1 があるとき成功する', () => {
    assert.equal(run({ icuVersion: '62.1' }).status, 0);
  });

  it('下限を超える ICU 74.2 があるとき成功する', () => {
    assert.equal(run({ icuVersion: '74.2' }).status, 0);
  });

  it('下限に満たない ICU 62.0 のとき失敗する', () => {
    assert.equal(run({ icuVersion: '62.0' }).status, 1);
  });

  it('ICU の開発ファイルが無いとき失敗し、導入するパッケージを示す', () => {
    const result = run({});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /libicu-dev/);
    assert.match(result.stderr, /pkg-config/);
  });

  it('pkg-config が無いとき失敗し、導入するパッケージを示す', () => {
    const result = run({ icuVersion: '74.2', hasPkgConfig: false });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /libicu-dev/);
    assert.match(result.stderr, /pkg-config/);
  });
});
