// ライセンスの判定。

/**
 * SPDX 式が許可リストで満たされるかを判定する。AND は OR より強く結合する。
 * 解釈できない式と WITH 付きの式は許可しない(人が確認して例外に載せる)。
 */
export function spdxAllowed(expression, allowed) {
  if (typeof expression !== 'string') return false;
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const peek = () => tokens[i]?.toUpperCase();

  function parseOr() {
    let value = parseAnd();
    while (peek() === 'OR') {
      i += 1;
      const right = parseAnd();
      value = value || right;
    }
    return value;
  }
  function parseAnd() {
    let value = parseFactor();
    while (peek() === 'AND') {
      i += 1;
      const right = parseFactor();
      value = value && right;
    }
    return value;
  }
  function parseFactor() {
    const token = tokens[i];
    if (token === undefined || token === ')' || peek() === 'AND' || peek() === 'OR') throw new Error('unexpected');
    i += 1;
    if (token === '(') {
      const value = parseOr();
      if (tokens[i] !== ')') throw new Error('unbalanced');
      i += 1;
      return value;
    }
    if (peek() === 'WITH') {
      i += 2;
      return false;
    }
    return allowed.has(token);
  }

  try {
    const value = parseOr();
    return i === tokens.length && value;
  } catch {
    return false;
  }
}

const normalize = (text) => text.replace(/\s+/g, ' ');

/**
 * プロジェクト自身のライセンスを判定する。宣言(policy の project)と本文の対応を見る。
 * 本文の全文一致までは見ない。法的な妥当性の判断は人間が ADR で行う。
 * @returns {Array<{level:'error'|'warn', message:string}>}
 */
export function checkProjectLicense({ text, declared, approved, hasCode }) {
  const decide = 'ADR-0006 を決定し、LICENSE と tools/policy/licenses.json の project を設定する';
  if (text === null && declared === null) {
    const message = `LICENSE が無い。sydtest の利用条件(OSI 承認ライセンスでの公開)を満たせない。${decide}`;
    return [{ level: hasCode ? 'error' : 'warn', message }];
  }
  if (declared === null) {
    return [{ level: 'error', message: `LICENSE はあるが、どのライセンスか宣言されていない。${decide}` }];
  }
  if (text === null) {
    return [{ level: 'error', message: `${declared} を宣言しているが LICENSE が無い` }];
  }
  const signature = approved[declared];
  if (!signature) {
    return [{ level: 'error', message: `${declared} は OSI 承認ライセンスの一覧(osiApproved)に無い` }];
  }
  if (!normalize(text).includes(normalize(signature))) {
    return [{ level: 'error', message: `LICENSE の本文が宣言 ${declared} と対応しない(「${signature}」が無い)` }];
  }
  return [];
}
