// ADR の状態の書き換えだけの変更を見分ける(COM-9)。見分けが甘いと、本文の変更が Why の検査を免れる。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAdrPath, isStatusOnlyChange } from '../lib/adr-status.mjs';

const adr = (status, decision = '決定') => `# ADR-0010: 判断

- Status: ${status}
- Date: 2026-11-02
- Deciders: asuka1975

## 決定

${decision}
`;

const index = (status10, title10 = '書記素の数え方') => `# ADR 一覧

| 番号 | タイトル | 状態 |
| --- | --- | --- |
| [0009](0009-old.md) | 古い判断 | Accepted |
| [0010](0010-grapheme.md) | ${title10} | ${status10} |
`;

const adrChange = (before, after, path = 'docs/adr/0010-grapheme.md') => ({ path, change: 'M', before, after });
const indexChange = (before, after) => ({ path: 'docs/adr/README.md', change: 'M', before, after });

describe('ADR の状態の書き換えだけの変更', () => {
  it('Proposed を Accepted に変えるだけの ADR を受理する', () => {
    assert.equal(isStatusOnlyChange([adrChange(adr('Proposed'), adr('Accepted'))]), true);
  });

  it('Accepted を Superseded by ADR-0011 に変えるだけの ADR を受理する', () => {
    assert.equal(isStatusOnlyChange([adrChange(adr('Accepted'), adr('Superseded by ADR-0011'))]), true);
  });

  it('索引の状態の列だけを Accepted に変える変更を受理する', () => {
    assert.equal(isStatusOnlyChange([indexChange(index('Proposed'), index('Accepted'))]), true);
  });

  it('ADR と索引の状態を一緒に変える変更を受理する', () => {
    const changes = [adrChange(adr('Proposed'), adr('Accepted')), indexChange(index('Proposed'), index('Accepted'))];
    assert.equal(isStatusOnlyChange(changes), true);
  });

  it('Rejected への変更は受理しない(理由を残す場所が Why だけになる)', () => {
    assert.equal(isStatusOnlyChange([adrChange(adr('Proposed'), adr('Rejected'))]), false);
  });

  it('Deprecated への変更は受理しない(理由を残す場所が Why だけになる)', () => {
    assert.equal(isStatusOnlyChange([adrChange(adr('Accepted'), adr('Deprecated'))]), false);
  });

  it('Accepted を Proposed に戻す変更は受理しない', () => {
    assert.equal(isStatusOnlyChange([adrChange(adr('Accepted'), adr('Proposed'))]), false);
  });

  it('状態と一緒に本文を変えた ADR は受理しない', () => {
    assert.equal(isStatusOnlyChange([adrChange(adr('Proposed', '元の決定'), adr('Accepted', '変えた決定'))]), false);
  });

  it('状態を変えず本文だけを変えた ADR は受理しない', () => {
    assert.equal(isStatusOnlyChange([adrChange(adr('Proposed', '元の決定'), adr('Proposed', '変えた決定'))]), false);
  });

  it('状態の行に見える本文の行を書き換えただけの ADR は受理しない', () => {
    const before = adr('Proposed', '- Status: Proposed');
    const after = adr('Proposed', '- Status: Accepted');
    assert.equal(isStatusOnlyChange([adrChange(before, after)]), false);
  });

  it('状態と一緒に日付を変えた ADR は受理しない', () => {
    const after = adr('Accepted').replace('2026-11-02', '2026-11-03');
    assert.equal(isStatusOnlyChange([adrChange(adr('Proposed'), after)]), false);
  });

  it('状態と一緒にタイトルを変えた索引は受理しない', () => {
    assert.equal(isStatusOnlyChange([indexChange(index('Proposed'), index('Accepted', '別のタイトル'))]), false);
  });

  it('行を足した索引は受理しない', () => {
    const after = `${index('Accepted')}| [0011](0011-new.md) | 新しい判断 | Accepted |\n`;
    assert.equal(isStatusOnlyChange([indexChange(index('Proposed'), after)]), false);
  });

  it('表の行ではない行を書き換えた索引は受理しない', () => {
    const after = index('Accepted').replace('# ADR 一覧', '# ADR のリスト');
    assert.equal(isStatusOnlyChange([indexChange(index('Proposed'), after)]), false);
  });

  it('追加された ADR は受理しない', () => {
    assert.equal(isStatusOnlyChange([{ path: 'docs/adr/0011-new.md', change: 'A', before: null, after: adr('Accepted') }]), false);
  });

  it('削除された ADR は受理しない', () => {
    assert.equal(isStatusOnlyChange([{ path: 'docs/adr/0010-grapheme.md', change: 'D', before: adr('Accepted'), after: null }]), false);
  });

  it('ADR 以外のファイルの変更を含むなら受理しない', () => {
    const changes = [adrChange(adr('Proposed'), adr('Accepted')), { path: 'docs/glossary.md', change: 'M', before: 'a\n', after: 'b\n' }];
    assert.equal(isStatusOnlyChange(changes), false);
  });

  it('ADR のテンプレートの変更は受理しない', () => {
    const change = adrChange(adr('Proposed'), adr('Accepted'), 'docs/adr/template.md');
    assert.equal(isStatusOnlyChange([change]), false);
  });

  it('改行が CRLF のファイルは解釈できないので受理しない', () => {
    const crlf = (t) => t.replace(/\n/g, '\r\n');
    assert.equal(isStatusOnlyChange([adrChange(crlf(adr('Proposed')), crlf(adr('Accepted')))]), false);
  });

  it('状態の行が無い ADR は受理しない', () => {
    const noStatus = adr('Proposed').replace('- Status: Proposed\n', '');
    assert.equal(isStatusOnlyChange([adrChange(noStatus, noStatus.replace('決定', '別'))]), false);
  });

  it('変更が空なら受理しない', () => {
    assert.equal(isStatusOnlyChange([]), false);
  });

  it('内容を読めなかった変更は受理しない', () => {
    assert.equal(isStatusOnlyChange([adrChange(null, adr('Accepted'))]), false);
  });
});

describe('ADR のパス', () => {
  it('番号付きの ADR と索引をパスとして認める', () => {
    assert.deepEqual(
      ['docs/adr/0010-grapheme.md', 'docs/adr/README.md', 'docs/adr/template.md', 'docs/adr/sub/0010-x.md', 'docs/glossary.md'].map(isAdrPath),
      [true, true, false, false, false],
    );
  });
});
