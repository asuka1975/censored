// .cabal / spago.yaml の依存宣言を読む。解釈できない記述は unsupported に積み、呼び出し側が不合格にする(GATE-1)。
import YAML from 'yaml';

const STANZA = /^(library|executable|test-suite|benchmark|common|foreign-library)(?:\s+(\S+))?\s*$/i;
const OTHER_TOP_LEVEL = /^(source-repository|custom-setup)\b/i;
const CONDITIONAL = /^(if|elif)\s|^else\s*$/i;
const MUTATION_FLAG = /^if\s+flag\(mutation\)\s*$/i;

function addField(stanza, field, value, inFlag) {
  if (field === 'build-depends') {
    const names = value.replace(/:\{[^}]*\}/g, '').split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => /^([A-Za-z0-9-]+)/.exec(s)?.[1]).filter(Boolean);
    (inFlag ? stanza.flagDeps : stanza.deps).push(...names);
  } else if (field === 'build-tool-depends') {
    // WHY NOT: mutation フラグの中でも分けない。ビルド時に実行されるツールなので、計器の例外を認めない。
    const names = value.split(',').map((s) => s.trim()).filter(Boolean).map((s) => /^([A-Za-z0-9-]+)/.exec(s)?.[1]).filter(Boolean);
    stanza.toolDeps.push(...names);
  } else if (field === 'ghc-options' || field === 'ghc-prof-options' || field === 'ghc-shared-options') {
    const opts = value.split(/\s+/).filter(Boolean);
    (inFlag ? stanza.flagGhcOptions : stanza.ghcOptions).push(...opts);
  } else if (field === 'import') {
    stanza.imports.push(...value.split(',').map((s) => s.trim()).filter(Boolean));
  }
}

/** common stanza の内容を import 元へ展開する。 */
function resolveImports(result) {
  const commons = new Map(result.stanzas.filter((s) => s.kind === 'common').map((s) => [s.name, s]));
  const merge = (target, name, seen) => {
    if (seen.has(name)) return;
    seen.add(name);
    const common = commons.get(name);
    if (!common) {
      result.unsupported.push(`未定義の common stanza: ${name}`);
      return;
    }
    target.deps.push(...common.deps);
    target.flagDeps.push(...common.flagDeps);
    target.toolDeps.push(...common.toolDeps);
    target.ghcOptions.push(...common.ghcOptions);
    target.flagGhcOptions.push(...common.flagGhcOptions);
    for (const next of common.imports) merge(target, next, seen);
  };
  for (const stanza of result.stanzas) {
    if (stanza.kind === 'common') continue;
    const seen = new Set();
    for (const name of stanza.imports) merge(stanza, name, seen);
  }
}

/**
 * インデントの入れ子で読む。条件節は両方の分岐を依存に含める(どの条件でも層の規則を守らせるため)。
 * `if flag(mutation)` の中だけは計器なので分けて返す。
 * @returns {{name:string|null, flags:string[], unsupported:string[],
 *   stanzas:Array<{kind:string, name:string, imports:string[], deps:string[], flagDeps:string[], toolDeps:string[], ghcOptions:string[], flagGhcOptions:string[]}>}}
 *   toolDeps は build-tool-depends のパッケージ名(`pkg:exe` の pkg)
 */
export function parseCabal(text) {
  const result = { name: null, stanzas: [], flags: [], unsupported: [] };
  let stanza = null;
  let field = null;
  const blocks = [];

  text.split('\n').forEach((raw, index) => {
    const lineNo = index + 1;
    if (raw.trim() === '' || /^\s*--/.test(raw)) return;
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (raw.slice(0, indent).includes('\t') || /\{\s*$/.test(trimmed) || /^\}/.test(trimmed)) {
      result.unsupported.push(`${lineNo} 行目: タブや波括弧のレイアウトは解析できない`);
      return;
    }

    if (indent === 0) {
      field = null;
      blocks.length = 0;
      stanza = null;
      const name = /^name\s*:\s*(\S+)/i.exec(trimmed);
      const flag = /^flag\s+(\S+)/i.exec(trimmed);
      const st = STANZA.exec(trimmed);
      if (name) result.name = name[1];
      else if (flag) result.flags.push(flag[1]);
      else if (st) {
        stanza = {
          kind: st[1].toLowerCase(), name: st[2] ?? '', imports: [],
          deps: [], flagDeps: [], toolDeps: [], ghcOptions: [], flagGhcOptions: [],
        };
        result.stanzas.push(stanza);
      } else if (!OTHER_TOP_LEVEL.test(trimmed) && !/^[A-Za-z][A-Za-z0-9-]*\s*:/.test(trimmed)) {
        result.unsupported.push(`${lineNo} 行目: 解析できない行: ${trimmed}`);
      }
      return;
    }
    if (!stanza) return;

    while (blocks.length > 0 && indent <= blocks[blocks.length - 1].indent) blocks.pop();
    const inFlag = blocks.some((b) => b.mutation);

    if (field && indent > field.indent && !CONDITIONAL.test(trimmed)) {
      addField(stanza, field.name, trimmed, inFlag);
      return;
    }
    field = null;

    if (CONDITIONAL.test(trimmed)) {
      blocks.push({ indent, mutation: MUTATION_FLAG.test(trimmed) });
      return;
    }
    const f = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(trimmed);
    if (!f) {
      result.unsupported.push(`${lineNo} 行目: 解析できない行: ${trimmed}`);
      return;
    }
    field = { name: f[1].toLowerCase(), indent };
    addField(stanza, field.name, f[2], inFlag);
  });

  resolveImports(result);
  return result;
}

function dependencyNames(value, label, out) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    out.unsupported.push(`${label} は配列で書く`);
    return [];
  }
  const names = [];
  for (const item of value) {
    if (typeof item === 'string') names.push(item);
    else if (item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 1) names.push(Object.keys(item)[0]);
    else out.unsupported.push(`${label} の要素を解析できない: ${JSON.stringify(item)}`);
  }
  return names;
}

/**
 * spago.yaml を読む。
 * WHY NOT: 行単位の自作パーサに戻さない。`dependencies: [a, b]` のような通常の YAML 表記で依存が空と判定され、
 * 層と台帳の検査を迂回できた。YAML の解釈は専用のライブラリに任せ、ここでは形だけを検証する。
 */
export function parseSpago(text) {
  const out = {
    name: null, deps: [], testDeps: [], testMain: null, strict: false, pedantic: false,
    testStrict: false, testPedantic: false, extraPackages: [], unsupported: [],
  };
  let doc;
  try {
    doc = YAML.parse(text, { merge: true }) ?? {};
  } catch (e) {
    out.unsupported.push(`YAML として解析できない: ${e.message.split('\n')[0]}`);
    return out;
  }
  const pkg = doc.package ?? {};
  out.name = pkg.name ?? null;
  out.deps = dependencyNames(pkg.dependencies, 'package.dependencies', out);
  out.testDeps = dependencyNames(pkg.test?.dependencies, 'package.test.dependencies', out);
  out.testMain = pkg.test?.main ?? null;
  out.strict = pkg.build?.strict === true;
  out.pedantic = pkg.build?.pedanticPackages === true;
  out.testStrict = pkg.test?.strict === true;
  out.testPedantic = pkg.test?.pedanticPackages === true;
  out.extraPackages = Object.keys(doc.workspace?.extraPackages ?? {});
  return out;
}
