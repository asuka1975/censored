// ADR の状態の行だけを書き換える変更を見分ける(COM-9)。
//
// WHY NOT: 差分の行を読んで判定しない。状態の行に見える本文の行を書き換えた変更を、状態の書き換えと取り違える。
// 変更前後の全文を行ごとに比べ、違う行が「その ADR の最初の状態の行」だけであることを確かめる。

const ADR_FILE = /^docs\/adr\/\d{4}-[a-z0-9-]+\.md$/;
const ADR_INDEX = 'docs/adr/README.md';

const STATUS = '(?:Proposed|Accepted|Rejected|Deprecated|Superseded by ADR-\\d{4})';
const STATUS_LINE = new RegExp(`^- Status: (${STATUS})$`);
const INDEX_ROW = new RegExp(`^(\\| \\[\\d{4}\\]\\([^)]+\\) \\| .+ \\| )(${STATUS})( \\|)$`);

// WHY NOT: Rejected と Deprecated への変更は含めない。却下や廃止の理由を書く場所が ADR の本文には無く、
// コミットログの Why が唯一の置き場になるので、Why を免除すると理由が残らない。
// Accepted は決定が本文にあり、Superseded は置き換える ADR に理由がある。
const WITHOUT_WHY = /^(?:Accepted|Superseded by ADR-\d{4})$/;

/** ADR の本体か索引か。状態の書き換えだけの変更になり得るパス。 */
export const isAdrPath = (file) => file === ADR_INDEX || ADR_FILE.test(file);

function differingLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length !== b.length) return null;
  const at = [];
  a.forEach((line, i) => { if (line !== b[i]) at.push(i); });
  return { before: a, after: b, at };
}

function adrFileChangesOnlyStatus(before, after) {
  const diff = differingLines(before, after);
  if (!diff || diff.at.length !== 1) return false;
  const [i] = diff.at;
  if (diff.before.findIndex((l) => l.startsWith('- Status:')) !== i) return false;
  const was = STATUS_LINE.exec(diff.before[i]);
  const now = STATUS_LINE.exec(diff.after[i]);
  return Boolean(was && now && WITHOUT_WHY.test(now[1]));
}

function indexChangesOnlyStatus(before, after) {
  const diff = differingLines(before, after);
  if (!diff || diff.at.length === 0) return false;
  return diff.at.every((i) => {
    const was = INDEX_ROW.exec(diff.before[i]);
    const now = INDEX_ROW.exec(diff.after[i]);
    return Boolean(was && now && was[1] === now[1] && was[3] === now[3] && WITHOUT_WHY.test(now[2]));
  });
}

/**
 * コミットの変更が、ADR の状態(Accepted または Superseded by ADR-NNNN への変更)の書き換えだけか。
 *
 * 解釈できない入力は false にする。false になっても通常の検査に戻るだけで、合格は生まれない(GATE-1)。
 *
 * @param changes 変更されたファイルごとの { path, change('M' など), before, after }。before と after は全文
 */
export function isStatusOnlyChange(changes) {
  if (!Array.isArray(changes) || changes.length === 0) return false;
  return changes.every(({ path, change, before, after }) => {
    if (change !== 'M' || typeof before !== 'string' || typeof after !== 'string') return false;
    if (path === ADR_INDEX) return indexChangesOnlyStatus(before, after);
    if (ADR_FILE.test(path)) return adrFileChangesOnlyStatus(before, after);
    return false;
  });
}
