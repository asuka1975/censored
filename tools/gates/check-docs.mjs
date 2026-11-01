#!/usr/bin/env node
// 文書の検査。front matter、リンク切れ、索引からの到達性、AGENTS.md の分量。
import path from 'node:path';
import { Report, ROOT, exists, parseArgs, readJson, readText, rel, walk } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
const report = new Report('check-docs');
const policy = readJson('tools/policy/docs.json');
const now = args.today ? new Date(args.today) : new Date();

const mdFiles = [
  ...walk('docs', (f) => f.endsWith('.md')),
  ...['README.md', 'AGENTS.md', 'CLAUDE.md'].filter(exists).map((f) => path.join(ROOT, f)),
  ...walk('backend', (f) => f.endsWith('.md')),
  ...walk('frontend', (f) => f.endsWith('.md')),
  ...walk('contract', (f) => f.endsWith('.md')),
  ...walk('tools', (f) => f.endsWith('.md')),
];

function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

const linkedFrom = new Map();
for (const file of mdFiles) {
  const name = rel(file);
  const text = readText(file);
  const needsFront = name.startsWith('docs/') && !name.startsWith('docs/adr/');

  if (needsFront) {
    const fm = frontMatter(text);
    if (!fm) {
      report.error('DOC-2', name, 1, 'front matter(title / owner / status / last_reviewed)が必要');
    } else {
      for (const key of ['title', 'owner', 'status', 'last_reviewed']) {
        if (!fm[key]) report.error('DOC-2', name, 1, `front matter に ${key} が必要`);
      }
      if (fm.status && !policy.statuses.includes(fm.status)) {
        report.error('DOC-2', name, 1, `status は ${policy.statuses.join(' / ')} のいずれか`);
      }
      if (fm.last_reviewed) {
        const d = new Date(fm.last_reviewed);
        if (Number.isNaN(d.getTime())) {
          report.error('DOC-2', name, 1, 'last_reviewed は YYYY-MM-DD');
        } else if (fm.status === 'living') {
          const days = (now - d) / 86400000;
          if (days > policy.staleAfterDays) {
            const msg = `最終レビューから ${Math.floor(days)} 日経過(上限 ${policy.staleAfterDays} 日)`;
            if (args.strict) report.error('DOC-3', name, 1, msg);
            else report.warn('DOC-3', name, 1, msg);
          }
        }
      }
    }
  }

  // コードブロックとインラインコードの中はリンクとして扱わない。
  const stripped = text.replace(/^```[\s\S]*?^```/gm, (s) => s.replace(/[^\n]/g, ' ')).replace(/`[^`\n]*`/g, (s) => ' '.repeat(s.length));
  stripped.split('\n').forEach((lineText, i) => {
    for (const m of lineText.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const clean = target.split('#')[0];
      if (!clean) continue;
      const resolved = path.resolve(path.dirname(file), clean);
      if (!exists(resolved)) {
        report.error('DOC-4', name, i + 1, `リンク切れ: ${target}`);
      } else {
        const set = linkedFrom.get(rel(resolved)) ?? new Set();
        set.add(name);
        linkedFrom.set(rel(resolved), set);
      }
    }
  });
}

// docs/README.md から辿れない文書は存在しないのと同じ。
const reached = new Set(['docs/README.md']);
const edges = new Map();
for (const [to, froms] of linkedFrom) {
  for (const from of froms) {
    if (!edges.has(from)) edges.set(from, []);
    edges.get(from).push(to);
  }
}
const queue = ['docs/README.md'];
while (queue.length > 0) {
  for (const next of edges.get(queue.pop()) ?? []) {
    if (!reached.has(next)) { reached.add(next); queue.push(next); }
  }
}
for (const file of walk('docs', (f) => f.endsWith('.md')).map(rel)) {
  if (!reached.has(file)) report.error('DOC-5', file, null, 'docs/README.md から到達できない');
}

if (exists('AGENTS.md')) {
  const lines = readText('AGENTS.md').split('\n').length;
  if (lines > policy.agentsMdMaxLines) {
    report.error('AI-3', 'AGENTS.md', null, `${lines} 行。上限 ${policy.agentsMdMaxLines} 行(詳細は docs/conventions へ)`);
  }
}

report.finish(`${mdFiles.length} ファイル`);
