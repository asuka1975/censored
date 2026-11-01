// ゲート共通部品。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangedLines } from './diff.mjs';

export const ROOT = process.env.GATE_ROOT
  ? path.resolve(process.env.GATE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist-newstyle', 'dist-mutation', '.spago', 'output', '.tools',
  'coverage', 'reports', '.stryker-tmp', '.hie', '.whine',
]);

export const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

export function walk(dir, accept = () => true) {
  const abs = path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...walk(path.join(abs, e.name), accept));
    } else if (e.isFile() && accept(path.join(abs, e.name))) {
      out.push(path.join(abs, e.name));
    }
  }
  return out.sort();
}

export const readText = (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), 'utf8');
export const readJson = (p) => JSON.parse(readText(p));
export const exists = (p) => fs.existsSync(path.isAbsolute(p) ? p : path.join(ROOT, p));

export function git(args, opts = {}) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...opts,
  });
}

export function isGitRepo() {
  try { git(['rev-parse', '--git-dir']); return true; } catch { return false; }
}

/** base...HEAD で変更された行を Map<repo相対パス, Set<行番号>> で返す。 */
export function changedLines(base) {
  return parseChangedLines(git([
    'diff', '--unified=0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/',
    '--diff-filter=ACMR', `${base}...HEAD`,
  ]));
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined) out[k] = v;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

/** 違反を `file:line [RULE] message` で出す。AI が機械的に解釈できる形式を保つ。 */
export class Report {
  constructor(name) { this.name = name; this.errors = []; this.warnings = []; }
  error(rule, file, line, message) { this.errors.push({ rule, file, line, message }); }
  warn(rule, file, line, message) { this.warnings.push({ rule, file, line, message }); }
  static #fmt({ rule, file, line, message }) {
    const loc = file ? `${file}${line ? `:${line}` : ''} ` : '';
    return `${loc}[${rule}] ${message}`;
  }
  finish(okMessage = '') {
    for (const w of this.warnings) console.error(`warn  ${Report.#fmt(w)}`);
    for (const e of this.errors) console.error(`error ${Report.#fmt(e)}`);
    if (this.errors.length > 0) {
      console.error(`${this.name}: 失敗(${this.errors.length} 件)`);
      process.exitCode = 1;
    } else {
      console.log(`${this.name}: OK${okMessage ? ` — ${okMessage}` : ''}`);
    }
  }
}
