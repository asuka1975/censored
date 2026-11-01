// check-adr を一時的な Git リポジトリに対して実行する。
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const GATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../check-adr.mjs');

const adr = (status, decision = '元の決定', number = '0001') => `# ADR-${number}: 判断

- Status: ${status}
- Date: 2026-11-02
- Deciders: a

## 背景

b

## 決定

${decision}

## 検討した代替案

### 案 A

x

### 案 B

**却下理由:** y

## 結果

z

## 再検討の条件

w
`;

describe('Accepted の ADR の不変性', () => {
  let dir;
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  const write = (name, text) => fs.writeFileSync(path.join(dir, 'docs/adr', name), text);
  const index = (name, status) => write('README.md', `| [x](${name}) | x | ${status} |\n`);
  const commit = () => { git('add', '-A'); git('commit', '-qm', 'x'); };
  const run = () => {
    const r = spawnSync(process.execPath, [GATE, '--base', 'main'], { encoding: 'utf8', env: { ...process.env, GATE_ROOT: dir } });
    return { status: r.status, output: r.stdout + r.stderr };
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-adr-'));
    fs.mkdirSync(path.join(dir, 'docs/adr'), { recursive: true });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'a@example.com');
    git('config', 'user.name', 'a');
    write('0001-a.md', adr('Accepted'));
    index('0001-a.md', 'Accepted');
    commit();
    git('checkout', '-q', '-b', 'feat');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('変更がなければ合格する', () => {
    assert.equal(run().status, 0);
  });

  it('本文の変更を拒否する', () => {
    write('0001-a.md', adr('Accepted', '書き換えた決定'));
    commit();
    assert.match(run().output, /ADR-7/);
  });

  it('改名して本文を変更しても拒否する', () => {
    git('mv', 'docs/adr/0001-a.md', 'docs/adr/0001-renamed.md');
    write('0001-renamed.md', adr('Accepted', '書き換えた決定'));
    index('0001-renamed.md', 'Accepted');
    commit();
    assert.match(run().output, /ADR-7/);
  });

  it('本文を変えない改名は許す', () => {
    git('mv', 'docs/adr/0001-a.md', 'docs/adr/0001-renamed.md');
    index('0001-renamed.md', 'Accepted');
    commit();
    assert.equal(run().status, 0);
  });

  it('削除を拒否する', () => {
    fs.rmSync(path.join(dir, 'docs/adr/0001-a.md'));
    write('README.md', '');
    commit();
    assert.match(run().output, /ADR-7/);
  });

  it('Proposed へ戻して本文の検査を逃れることを拒否する', () => {
    write('0001-a.md', adr('Proposed'));
    index('0001-a.md', 'Proposed');
    commit();
    assert.match(run().output, /ADR-3/);
  });

  it('Status 行だけの変更で置き換えを記録できる', () => {
    write('0001-a.md', adr('Superseded by ADR-0002'));
    write('0002-b.md', adr('Accepted', '新しい決定', '0002'));
    write('README.md', '| [x](0001-a.md) | x | Superseded by ADR-0002 |\n| [y](0002-b.md) | y | Accepted |\n');
    commit();
    assert.equal(run().status, 0);
  });

  it('同じ番号の ADR を拒否する', () => {
    write('0001-b.md', adr('Accepted'));
    commit();
    assert.match(run().output, /ADR-1/);
  });

  it('命名に沿わない ADR を無視せず拒否する', () => {
    write('0002-日本語.md', adr('Proposed', '決定', '0002'));
    commit();
    assert.match(run().output, /ADR-2/);
  });
});
