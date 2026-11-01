// ソースコードの機械検査ルール。ルール ID は docs/conventions の表と一致させる。
import { warningSuppressions } from './ghc-options.mjs';
import { commentBlocks, lex, mask } from './lexer.mjs';

const TAG = /^(WHY NOT|SAFETY|TODO\(#\d+\)|FIXME\(#\d+\)):\s*(\S.*)?$/;
const HADDOCK = /^(\||\^|\$\s*\w*|\*+\s)/;
const MIN_REASON_CHARS = 8;

/** 検査を黙らせるプラグマか。HLint は HLINT プラグマと ANN の両方の書き方を持つ。 */
function isSuppression(pragma) {
  if (/\bHLINT\s+ignore\b|\bHLint:\s*ignore\b/i.test(pragma) || /DisableMutation/.test(pragma)) return true;
  const options = /^OPTIONS_GHC\b\s*([\s\S]*)$/i.exec(pragma);
  return options ? warningSuppressions(options[1].split(/\s+/)).length > 0 : false;
}

const lineOfIndex = (src, idx) => src.slice(0, idx).split('\n').length;

function isHaddock(text) { return HADDOCK.test(text); }

/** line の直上に、指定タグで始まるコメントブロックが接しているか。 */
function hasTagAbove(blocks, line, tagPrefix) {
  return blocks.some((b) => b.endLine === line - 1 && b.lines[0].startsWith(tagPrefix));
}

export function checkComments(src, lang) {
  const out = [];
  const lexed = lex(src, lang);
  const blocks = commentBlocks(lexed.comments);

  for (const b of blocks) {
    const first = b.lines[0];
    if (isHaddock(first)) continue;
    const m = TAG.exec(first);
    if (m) {
      const reason = (m[2] ?? '').trim();
      const continuation = b.lines.slice(1).join(' ').trim();
      if ([...`${reason}${continuation}`].length < MIN_REASON_CHARS) {
        out.push({ rule: 'CMT-2', line: b.line, message: `${m[1]}: の理由が短すぎる(${MIN_REASON_CHARS}文字以上)` });
      }
      continue;
    }
    if (/^(TODO|FIXME|XXX|HACK)\b/.test(first)) {
      out.push({ rule: 'CMT-3', line: b.line, message: '課題コメントは TODO(#123): / FIXME(#123): の形で Issue に紐づける' });
    } else {
      out.push({
        rule: 'CMT-1', line: b.line,
        message: 'コメントは WHY NOT: / SAFETY: / TODO(#n): / FIXME(#n): で始める。HOW はコード、WHAT はテスト、WHY はコミットログへ',
      });
    }
  }

  for (const c of lexed.comments) {
    if (c.kind !== 'pragma') continue;
    if (isSuppression(c.text) && !hasTagAbove(blocks, c.line, 'WHY NOT:')) {
      out.push({ rule: 'CMT-4', line: c.line, message: '検査の抑止(HLint の ignore / 警告を弱める OPTIONS_GHC / DisableMutation)には直上に WHY NOT: が必要' });
    }
  }
  return out;
}

export function checkModuleHeader(src, lang) {
  const lexed = lex(src, lang);
  const code = mask(src, lexed, { strings: true });
  const m = /^module\s/m.exec(code);
  if (!m) return [];
  const moduleLine = lineOfIndex(code, m.index);
  const hasDoc = lexed.comments.some((c) => c.kind !== 'pragma' && c.line < moduleLine && isHaddock(c.text));
  return hasDoc ? [] : [{ rule: 'CMT-5', line: moduleLine, message: 'モジュール直前に `-- |` で責務を 1〜3 行書く' }];
}

export function checkForeignImports(src) {
  const lexed = lex(src, 'purs');
  const blocks = commentBlocks(lexed.comments);
  const code = mask(src, lexed, { strings: true });
  const out = [];
  code.split('\n').forEach((text, i) => {
    if (/^foreign\s+import\b/.test(text) && !hasTagAbove(blocks, i + 1, 'SAFETY:')) {
      out.push({ rule: 'CMT-6', line: i + 1, message: 'foreign import には直上に SAFETY: で JS 側の前提を書く' });
    }
  });
  return out;
}

const VAGUE_EXACT = /^(tests?\s*\d*|works?|ok|success|fail(s|ed|ure)?|normal|basic|example|sample|happy path|正常系?\d*|異常系?\d*|動く|動作する|テスト\d*|成功|失敗|ケース\d*)$/i;
const VAGUE_PART = /(正しく動|うまく|問題なく|should work|works? (correctly|properly|fine)|as expected|期待通り|いい感じ)/i;
export const TEST_NAME = /\b(?:it|specify|itWithOuter|itWithBoth|itWithAll)\s+"((?:[^"\\\n]|\\.)*)"/g;
const hasCjk = (s) => /[぀-ヿ㐀-鿿]/.test(s);

export function checkTestName(name) {
  const trimmed = name.trim();
  if (VAGUE_EXACT.test(trimmed) || VAGUE_PART.test(trimmed)) return `振る舞いを述べていないテスト名: "${name}"`;
  if (hasCjk(trimmed)) {
    if ([...trimmed].length < 6) return `テスト名が短すぎる(条件と結果を書く): "${name}"`;
  } else if (trimmed.split(/\s+/).length < 3) {
    return `テスト名が短すぎる(3語以上で条件と結果を書く): "${name}"`;
  }
  return null;
}

const BANNED_TEST_FUNCS = [
  ['xit', 'TQ-M2'], ['xdescribe', 'TQ-M2'], ['xspecify', 'TQ-M2'], ['pending', 'TQ-M2'], ["pending'", 'TQ-M2'],
  ['itOnly', 'TQ-M2'], ['describeOnly', 'TQ-M2'], ['focus', 'TQ-M2'], ['fit', 'TQ-M2'], ['fdescribe', 'TQ-M2'],
  ['flaky', 'TQ-M3'],
];

/** テストフレームワークを指す修飾子(import の別名とモジュール名)。 */
function testFrameworkQualifiers(code) {
  const out = new Set();
  for (const line of code.split('\n')) {
    const m = /^import\s+(?:qualified\s+)?(Test\.(?:Syd|Spec)[\w.]*)/.exec(line);
    if (!m) continue;
    out.add(m[1]);
    const alias = /\bas\s+([A-Z][\w.]*)/.exec(line);
    if (alias) out.add(alias[1]);
  }
  return out;
}

export function checkTestCode(src, lang) {
  const out = [];
  const lexed = lex(src, lang);
  const blocks = commentBlocks(lexed.comments);
  const noComments = mask(src, lexed);
  const code = mask(src, lexed, { strings: true });
  const qualifiers = testFrameworkQualifiers(code);

  const seen = new Map();
  for (const m of noComments.matchAll(TEST_NAME)) {
    const line = lineOfIndex(noComments, m.index);
    const problem = checkTestName(m[1]);
    if (problem) out.push({ rule: 'TQ-M1', line, message: problem });
    if (seen.has(m[1])) out.push({ rule: 'TQ-M4', line, message: `同じテスト名が重複している(${seen.get(m[1])} 行目): "${m[1]}"` });
    else seen.set(m[1], line);
  }

  code.split('\n').forEach((text, i) => {
    for (const [fn, rule] of BANNED_TEST_FUNCS) {
      const name = fn.replace("'", "\\'");
      // WHY NOT: `.` の前置をすべて禁止語として扱わない。PureScript の state.pending や他モジュールの
      // Layout.fit まで誤検出する。修飾はテストフレームワークの別名のときだけ検出する。
      const bare = new RegExp(`(^|[^\\w'.])${name}(?![\\w'])`).test(text);
      const qualified = new RegExp(`([A-Z][\\w.']*)\\.${name}(?![\\w'])`).exec(text);
      if (bare || (qualified && qualifiers.has(qualified[1]))) {
        out.push({ rule, line: i + 1, message: `${fn} は禁止。無効化ではなく修正するか、pendingWith "#123 ..." で Issue に紐づける` });
      }
    }
    if (/\b(threadDelay|delay)\b/.test(text) && !hasTagAbove(blocks, i + 1, 'WHY NOT:')) {
      out.push({ rule: 'TQ-M5', line: i + 1, message: 'テストでの待機は禁止(時計を注入する)。不可避なら直上に WHY NOT:' });
    }
    if (/\b(getCurrentTime|nowDateTime|nowDate)\b/.test(text) && !hasTagAbove(blocks, i + 1, 'WHY NOT:')) {
      out.push({ rule: 'TQ-M5', line: i + 1, message: 'テストで実時刻を読まない(時計を注入する)。不可避なら直上に WHY NOT:' });
    }
  });

  for (const m of noComments.matchAll(/\bpendingWith\s+"[^"\n]*"\s+"((?:[^"\\\n]|\\.)*)"/g)) {
    if (!/#\d+/.test(m[1])) {
      out.push({ rule: 'TQ-M2', line: lineOfIndex(noComments, m.index), message: 'pendingWith の理由には Issue 番号(#123)を含める' });
    }
  }
  return out;
}

const PURS_BANNED_IMPORTS = ['Unsafe.Coerce', 'Partial.Unsafe', 'Effect.Unsafe', 'Unsafe.Reference'];

export function checkPursImports(src) {
  const lexed = lex(src, 'purs');
  const blocks = commentBlocks(lexed.comments);
  const code = mask(src, lexed, { strings: true });
  const out = [];
  code.split('\n').forEach((text, i) => {
    const m = /^import\s+([A-Z][\w.]*)/.exec(text);
    if (m && PURS_BANNED_IMPORTS.includes(m[1]) && !hasTagAbove(blocks, i + 1, 'SAFETY:')) {
      out.push({ rule: 'LINT-P1', line: i + 1, message: `${m[1]} は禁止。不可避なら直上に SAFETY: で成立条件を書く` });
    }
  });
  return out;
}

/** 純粋層で副作用を持ち込んでいないか。パッケージ依存で防げない base の IO を対象にする。 */
export function checkPurity(src, lang) {
  const lexed = lex(src, lang);
  const code = mask(src, lexed, { strings: true });
  const out = [];
  code.split('\n').forEach((text, i) => {
    if (lang === 'hs') {
      if (/\bIO\b/.test(text) || /^import\s+(qualified\s+)?(System\.IO|Control\.Concurrent|Data\.IORef|Control\.Monad\.ST\.Unsafe)\b/.test(text)) {
        out.push({ rule: 'DIR-3', line: i + 1, message: 'domain 層は純粋に保つ(IO は application の Port 経由)' });
      }
    } else if (/^import\s+(Effect|Web|Fetch)(\.|\s|$)/.test(text)) {
      out.push({ rule: 'DIR-3', line: i + 1, message: 'core 層は純粋に保つ(Effect / Web は ui・api-client へ)' });
    }
  });
  return out;
}
