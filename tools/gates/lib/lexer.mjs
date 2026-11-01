// Haskell / PureScript のコメントと文字列を切り出す最小の字句解析器。
// 文字列内の `--` や QuasiQuote 内の SQL コメントを誤検知しないことだけを目的とする。

const isSymbol = (c) => c !== undefined && '!#$%&*+./<=>?@\\^|~:-'.includes(c);

function countNewlines(s) {
  let n = 0;
  for (const c of s) if (c === '\n') n++;
  return n;
}

/**
 * @returns {{comments: Array<{kind:'line'|'block'|'pragma', line:number, endLine:number, text:string, standalone:boolean}>,
 *            strings: Array<{start:number, end:number, line:number, value:string}>,
 *            spans: Array<{start:number, end:number}>}}
 */
export function lex(src, lang) {
  const comments = [];
  const strings = [];
  const spans = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const n = src.length;

  const standaloneAt = (idx) => src.slice(lineStart, idx).trim() === '';
  const advanceTo = (end) => {
    for (let k = i; k < end; k++) {
      if (src[k] === '\n') { line++; lineStart = k + 1; }
    }
    i = end;
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') { advanceTo(i + 1); continue; }

    if (c === '"') {
      const start = i;
      const startLine = line;
      if (lang === 'purs' && src.startsWith('"""', i)) {
        const close = src.indexOf('"""', i + 3);
        const end = close < 0 ? n : close + 3;
        strings.push({ start, end, line: startLine, value: src.slice(i + 3, close < 0 ? n : close) });
        spans.push({ start, end });
        advanceTo(end);
        continue;
      }
      let j = i + 1;
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\') j += 2;
        else if (src[j] === '\n') break;
        else j++;
      }
      const end = Math.min(j + 1, n);
      strings.push({ start, end, line: startLine, value: src.slice(start + 1, j) });
      spans.push({ start, end });
      advanceTo(end);
      continue;
    }

    if (c === "'") {
      const prev = src[i - 1];
      if (prev !== undefined && /[\p{L}\p{N}_']/u.test(prev)) { advanceTo(i + 1); continue; }
      if (src[i + 1] === '\\') {
        let j = i + 2;
        if (src[j] === "'" || src[j] === '\\') j++;
        while (j < n && src[j] !== "'" && src[j] !== '\n') j++;
        spans.push({ start: i, end: j + 1 });
        advanceTo(Math.min(j + 1, n));
        continue;
      }
      const cp = src.codePointAt(i + 1);
      const width = cp !== undefined && cp > 0xffff ? 2 : 1;
      if (src[i + 1 + width] === "'") {
        spans.push({ start: i, end: i + 2 + width });
        advanceTo(i + 2 + width);
        continue;
      }
      advanceTo(i + 1);
      continue;
    }

    if (lang === 'hs' && c === '[') {
      const m = /^\[[a-zA-Z_][\w.']*\|/.exec(src.slice(i, i + 80));
      if (m) {
        const close = src.indexOf('|]', i + m[0].length);
        if (close >= 0) {
          spans.push({ start: i, end: close + 2 });
          advanceTo(close + 2);
          continue;
        }
      }
    }

    if (src.startsWith('{-', i)) {
      const startLine = line;
      const standalone = standaloneAt(i);
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (src.startsWith('{-', j)) { depth++; j += 2; }
        else if (src.startsWith('-}', j)) { depth--; j += 2; }
        else j++;
      }
      const raw = src.slice(i, j);
      const kind = raw.startsWith('{-#') ? 'pragma' : 'block';
      comments.push({
        kind, line: startLine, endLine: startLine + countNewlines(raw), standalone,
        text: raw.replace(/^\{-#?/, '').replace(/#?-\}$/, '').trim(),
      });
      spans.push({ start: i, end: j });
      advanceTo(j);
      continue;
    }

    if (src.startsWith('--', i) && !isSymbol(src[i - 1])) {
      let j = i;
      while (src[j] === '-') j++;
      if (j >= n || !isSymbol(src[j])) {
        let e = src.indexOf('\n', j);
        if (e < 0) e = n;
        comments.push({
          kind: 'line', line, endLine: line, standalone: standaloneAt(i),
          text: src.slice(j, e).trim(),
        });
        spans.push({ start: i, end: e });
        advanceTo(e);
        continue;
      }
    }

    advanceTo(i + 1);
  }
  return { comments, strings, spans };
}

/** コメント(と任意で文字列)を空白に置換する。改行は保持するので行番号は変わらない。 */
export function mask(src, lexed, { strings = false } = {}) {
  const chars = src.split('');
  const blank = (s, e) => {
    for (let k = s; k < e && k < chars.length; k++) if (chars[k] !== '\n') chars[k] = ' ';
  };
  const isString = new Set(lexed.strings.map((s) => s.start));
  for (const sp of lexed.spans) {
    if (!strings && isString.has(sp.start)) continue;
    blank(sp.start, sp.end);
  }
  return chars.join('');
}

/** 隣接する単独行コメントを 1 ブロックにまとめる(タグは先頭行だけに要求するため)。 */
export function commentBlocks(comments) {
  const blocks = [];
  for (const c of comments) {
    if (c.kind === 'pragma') continue;
    const last = blocks[blocks.length - 1];
    if (c.kind === 'line' && c.standalone && last && last.kind === 'line' && last.standalone
        && last.endLine + 1 === c.line) {
      last.endLine = c.line;
      last.lines.push(c.text);
    } else {
      blocks.push({ ...c, lines: c.text.split('\n').map((s) => s.trim()) });
    }
  }
  return blocks;
}
