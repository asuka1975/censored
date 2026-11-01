// Git の出力の解析。パスの引用と、差分本文の `+++` を取り違えないことが要点。

const SIMPLE_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/** Git の C 形式の引用(`"b/\346\212\225.hs"`)を解く。引用されていなければそのまま返す。 */
export function unquoteGitPath(raw) {
  if (!raw.startsWith('"')) return raw;
  const chars = [...raw.slice(1, raw.lastIndexOf('"'))];
  const bytes = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '\\') {
      bytes.push(...Buffer.from(chars[i]));
      continue;
    }
    i += 1;
    if (/[0-7]/.test(chars[i])) {
      bytes.push(parseInt(chars.slice(i, i + 3).join(''), 8));
      i += 2;
    } else {
      bytes.push(SIMPLE_ESCAPES[chars[i]] ?? chars[i].charCodeAt(0));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * `git diff --unified=0` から変更後の行番号を取り出す。
 * @returns {Map<string, Set<number>>} リポジトリ相対パス → 行番号
 */
export function parseChangedLines(diff) {
  const out = new Map();
  let file = null;
  // WHY NOT: `+++ ` で始まる行をすべて見出しとして扱わない。Haskell の `++` で始まる継続行を追加すると、
  // 差分上は `+++ "foo"` になり、ファイル見出しと区別できなくなる。見出しの中でだけ受理する。
  let inHeader = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHeader = true;
      file = null;
      continue;
    }
    if (inHeader && line.startsWith('+++ ')) {
      const p = unquoteGitPath(line.slice(4).replace(/\t$/, ''));
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
      if (file && !out.has(file)) out.set(file, new Set());
      continue;
    }
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) {
      inHeader = false;
      if (file) {
        const start = Number(m[1]);
        const count = m[2] === undefined ? 1 : Number(m[2]);
        for (let i = 0; i < count; i++) out.get(file).add(start + i);
      }
    }
  }
  return out;
}

/**
 * `git diff --numstat -z --no-renames` を解析する。
 * WHY NOT: 改行区切りを使わない。パスが引用され、改名は `{a => b}` になるので、製品コードの判定をすり抜ける。
 * @returns {Array<{file: string, added: number, removed: number}>}
 */
export function parseNumstatZ(text) {
  return text.split('\0').filter(Boolean).map((record) => {
    const [added, removed, ...rest] = record.split('\t');
    return {
      file: rest.join('\t'),
      added: added === '-' ? 0 : Number(added),
      removed: removed === '-' ? 0 : Number(removed),
    };
  });
}
