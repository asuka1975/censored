// LCOV の DA 行だけを読む。カバレッジの判定単位は「行」に統一する(hs / purs 共通)。

/** @returns {Map<string, Map<number, number>>} ファイル → 行 → 実行回数 */
export function parseLcov(text) {
  const out = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      const file = line.slice(3).trim();
      current = out.get(file) ?? new Map();
      out.set(file, current);
    } else if (line.startsWith('DA:') && current) {
      const [ln, count] = line.slice(3).split(',');
      const n = Number(ln);
      current.set(n, Math.max(current.get(n) ?? 0, Number(count)));
    } else if (line.startsWith('end_of_record')) {
      current = null;
    }
  }
  return out;
}

/** coverage.json の除外行に当たる行を分母から外す。 */
export function filterLines(lines, sourceText, ignoreLinePatterns) {
  const src = sourceText.split('\n');
  const res = ignoreLinePatterns.map((p) => new RegExp(p));
  const out = new Map();
  for (const [n, c] of lines) {
    const text = src[n - 1] ?? '';
    if (!res.some((r) => r.test(text))) out.set(n, c);
  }
  return out;
}

export function percent(hit, total) {
  return total === 0 ? 100 : (hit / total) * 100;
}
