import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkMessage, isHumanAuthored } from '../check-commits.mjs';

const GATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../check-commits.mjs');

const rules = (msg, opts) => checkMessage(msg, opts).map((p) => p.rule);

describe('コミットログ', () => {
  it('件名と Why を持つメッセージを受理する', () => {
    const msg = 'fix(domain): 投稿本文の上限判定を修正\n\nWhy: 500 文字ちょうどの投稿が拒否され、仕様と食い違っていたため。\n\nRefs: #12\n';
    assert.deepEqual(rules(msg), []);
  });

  it('Why のないメッセージを拒否する', () => {
    assert.deepEqual(rules('fix(domain): 上限判定を修正\n\n境界値を直した\n'), ['COM-2']);
  });

  it('本文のないメッセージを拒否する', () => {
    assert.deepEqual(rules('feat: 投稿機能を追加\n'), ['COM-2']);
  });

  it('短すぎる Why を拒否する', () => {
    assert.deepEqual(rules('fix: 上限判定を修正\n\nWhy: バグだから\n'), ['COM-2']);
  });

  it('複数行にわたる Why を受理する', () => {
    const msg = 'fix: 上限判定を修正\n\nWhy: 利用者から\n500 文字の投稿が拒否されると報告があったため。\n';
    assert.deepEqual(rules(msg), []);
  });

  it('Why の直後のトレーラーを理由に含めない', () => {
    assert.deepEqual(rules('fix: 上限判定を修正\n\nWhy:\nRefs: #1234567890123456\n'), ['COM-2']);
  });

  it('形式に沿わない件名を拒否する', () => {
    assert.deepEqual(rules('上限判定を修正\n\nWhy: 500 文字の投稿が拒否されていたため。\n'), ['COM-1']);
  });

  it('件名の直後に空行がなければ拒否する', () => {
    assert.deepEqual(rules('fix: 修正\nWhy: 500 文字の投稿が拒否されていたため。\n').includes('COM-1'), true);
  });

  it('破壊的変更には移行方法を要求する', () => {
    assert.deepEqual(rules('feat(contract)!: 投稿 API を変更\n\nWhy: 添付を複数持てるようにする要望に応えるため。\n'), ['COM-4']);
  });

  it('移行方法のある破壊的変更を受理する', () => {
    const msg = 'feat(contract)!: 投稿 API を変更\n\nWhy: 添付を複数持てるようにする要望に応えるため。\n\nBREAKING CHANGE: media_id を media_ids へ置き換える\n';
    assert.deepEqual(rules(msg), []);
  });

  it('形式の誤った ADR トレーラーを拒否する', () => {
    const msg = 'feat: 配信方式を変更\n\nWhy: 書き込み時の負荷が上限に達したため。\n\nADR: 7\n';
    assert.deepEqual(rules(msg), ['COM-5']);
  });

  it('PR の範囲検査では fixup コミットを拒否する', () => {
    assert.deepEqual(rules('fixup! fix: 上限判定を修正\n', { inRange: true }), ['COM-6']);
  });

  it('件名が Merge で始まるだけのコミットを対象外にしない', () => {
    assert.deepEqual(rules('Merge whatever\n'), ['COM-1', 'COM-2']);
  });

  it('手元での fixup コミットは許す', () => {
    assert.deepEqual(rules('fixup! fix: 上限判定を修正\n'), []);
  });

  it('git のコメント行を本文として数えない', () => {
    assert.deepEqual(rules('fix: 修正\n\n# Why: コメントアウトされた理由の行です\n'), ['COM-2']);
  });
});

describe('人間による ADR の状態の書き換えのコミット(COM-9)', () => {
  const humans = ['39215088+asuka1975@users.noreply.github.com'];
  const human = { authorEmail: '39215088+asuka1975@users.noreply.github.com', message: 'Update 0010.md\n' };

  it('登録された人間の作者を受理する', () => {
    assert.equal(isHumanAuthored(human, humans), true);
  });

  it('作者のメールアドレスの大文字小文字を区別しない', () => {
    assert.equal(isHumanAuthored({ ...human, authorEmail: '39215088+ASUKA1975@users.noreply.github.com' }, humans), true);
  });

  it('登録されていない作者を受理しない', () => {
    assert.equal(isHumanAuthored({ ...human, authorEmail: 'noreply@anthropic.com' }, humans), false);
  });

  it('作者が分からないコミットを受理しない', () => {
    assert.equal(isHumanAuthored({ ...human, authorEmail: '' }, humans), false);
  });

  it('メールアドレスの一部が一致するだけの作者を受理しない', () => {
    assert.equal(isHumanAuthored({ ...human, authorEmail: 'x39215088+asuka1975@users.noreply.github.com.evil.example' }, humans), false);
  });

  it('Co-Authored-By のあるコミットは、作者が人間でも受理しない', () => {
    const message = 'Update 0010.md\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n';
    assert.equal(isHumanAuthored({ ...human, message }, humans), false);
  });

  it('Claude-Session のあるコミットは、作者が人間でも受理しない', () => {
    const message = 'Update 0010.md\n\nClaude-Session: https://claude.ai/code/session_x\n';
    assert.equal(isHumanAuthored({ ...human, message }, humans), false);
  });

  it('人間の登録が空なら誰も受理しない', () => {
    assert.equal(isHumanAuthored(human, []), false);
  });

  it('対象外と判定されたコミットは Why が無くても受理する', () => {
    assert.deepEqual(rules('Update 0010.md\n', { exempt: true }), []);
  });

  it('対象外と判定されても、PR の範囲検査では fixup コミットを拒否する', () => {
    assert.deepEqual(rules('fixup! docs(adr): 承認する\n', { inRange: true, exempt: true }), ['COM-6']);
  });
});

describe('人間による ADR の状態の書き換えのコミットの検査', () => {
  const HUMAN = '39215088+asuka1975@users.noreply.github.com';
  const AI = 'noreply@anthropic.com';
  const adr = (status, decision = '決定') => `# ADR-0010: 判断\n\n- Status: ${status}\n- Date: 2026-11-02\n\n## 決定\n\n${decision}\n`;
  const index = (status) => `| 番号 | タイトル | 状態 |\n| --- | --- | --- |\n| [0010](0010-x.md) | 判断 | ${status} |\n`;
  const POLICY = JSON.stringify({ humanAuthors: [HUMAN] });
  let dir;

  const git = (args, env = {}) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', env: { ...cleanEnv(), ...env } });
  const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const put = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  const commitAs = (email, message) => {
    git(['add', '-A']);
    git(['commit', '-q', '-m', message, `--author=A <${email}>`]);
  };
  const run = (args, env = {}) => {
    const r = spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8', env: { ...cleanEnv(), GATE_ROOT: dir, ...env } });
    return { status: r.status, output: r.stdout + r.stderr };
  };
  const range = () => run(['--range', 'main..feat']);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-commits-'));
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'cfg@example.com']);
    git(['config', 'user.name', 'cfg']);
    put('tools/policy/commits.json', POLICY);
    put('docs/adr/0010-x.md', adr('Proposed'));
    put('docs/adr/README.md', index('Proposed'));
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'chore: 初期化\n\nWhy: テストの土台にするため、最初のコミットを作った。']);
    git(['checkout', '-q', '-b', 'feat']);
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('人間が ADR の状態だけを書き換えたコミットは、Why が無くても受理する', () => {
    put('docs/adr/0010-x.md', adr('Accepted'));
    put('docs/adr/README.md', index('Accepted'));
    commitAs(HUMAN, 'Update 0010-x.md');
    const r = range();
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /COM-9/);
  });

  it('AI が ADR の状態だけを書き換えたコミットは、Why が無ければ拒否する', () => {
    put('docs/adr/0010-x.md', adr('Accepted'));
    commitAs(AI, 'Update 0010-x.md');
    const r = range();
    assert.equal(r.status, 1);
    assert.match(r.output, /\[COM-1\]/);
    assert.match(r.output, /\[COM-2\]/);
  });

  it('人間が ADR の状態と本文を一緒に書き換えたコミットは、Why が無ければ拒否する', () => {
    put('docs/adr/0010-x.md', adr('Accepted', '変えた決定'));
    commitAs(HUMAN, 'Update 0010-x.md');
    const r = range();
    assert.equal(r.status, 1);
    assert.match(r.output, /\[COM-2\]/);
  });

  it('人間が ADR 以外のファイルも書き換えたコミットは、Why が無ければ拒否する', () => {
    put('docs/adr/0010-x.md', adr('Accepted'));
    put('docs/notes.md', 'メモ\n');
    commitAs(HUMAN, 'Update 0010-x.md');
    assert.equal(range().status, 1);
  });

  it('人間が Rejected に書き換えたコミットは、Why が無ければ拒否する', () => {
    put('docs/adr/0010-x.md', adr('Rejected'));
    commitAs(HUMAN, 'Update 0010-x.md');
    assert.equal(range().status, 1);
  });

  it('Co-Authored-By のあるコミットは、作者が人間でも Why が無ければ拒否する', () => {
    put('docs/adr/0010-x.md', adr('Accepted'));
    commitAs(HUMAN, 'Update 0010-x.md\n\nCo-Authored-By: Claude <noreply@anthropic.com>');
    assert.equal(range().status, 1);
  });

  it('人間の登録ファイルが無ければ、人間のコミットでも Why が無ければ拒否する', () => {
    fs.rmSync(path.join(dir, 'tools/policy/commits.json'));
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'chore: 登録を消す\n\nWhy: 登録が無い場合の動きを確かめるため、登録ファイルを消した。']);
    put('docs/adr/0010-x.md', adr('Accepted'));
    commitAs(HUMAN, 'Update 0010-x.md');
    assert.equal(range().status, 1);
  });

  it('人間の登録ファイルが解釈できなければ、失敗にして原因を示す', () => {
    put('tools/policy/commits.json', JSON.stringify({ humanAuthors: HUMAN }));
    put('docs/adr/0010-x.md', adr('Accepted'));
    commitAs(HUMAN, 'Update 0010-x.md');
    const r = range();
    assert.equal(r.status, 1);
    assert.match(r.output, /commits\.json \[COM-9\]/);
  });

  it('人間の作者の fixup コミットは、状態の書き換えだけでも PR の範囲検査で拒否する', () => {
    put('docs/adr/0010-x.md', adr('Accepted'));
    commitAs(HUMAN, 'fixup! docs(adr): 承認する');
    const r = range();
    assert.equal(r.status, 1);
    assert.match(r.output, /\[COM-6\]/);
  });

  describe('コミット時のフック', () => {
    const msgFile = () => {
      const file = path.join(dir, 'MSG');
      fs.writeFileSync(file, 'Update 0010-x.md\n');
      return file;
    };

    it('人間が ADR の状態だけをステージしたコミットは、Why が無くても受理する', () => {
      put('docs/adr/0010-x.md', adr('Accepted'));
      git(['add', '-A']);
      const r = run(['--file', msgFile()], { GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: HUMAN });
      assert.equal(r.status, 0, r.output);
    });

    it('AI が ADR の状態だけをステージしたコミットは、Why が無ければ拒否する', () => {
      put('docs/adr/0010-x.md', adr('Accepted'));
      git(['add', '-A']);
      const r = run(['--file', msgFile()], { GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: AI });
      assert.equal(r.status, 1);
    });

    it('何もステージしていないコミットは、人間の作者でも Why が無ければ拒否する', () => {
      const r = run(['--file', msgFile()], { GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: HUMAN });
      assert.equal(r.status, 1);
    });
  });
});
