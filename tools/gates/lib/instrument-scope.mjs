// ミューテーションの計測対象外の層の変更を見つける(TQ-M10)。
const SOURCE = [
  { side: 'backend', pattern: /^backend\/packages\/([^/]+)\/src\/(.+\.hs)$/ },
  { side: 'frontend', pattern: /^frontend\/packages\/([^/]+)\/src\/(.+\.purs)$/ },
];

/**
 * 変更されたファイルのうち、計測対象外の層にある製品コード(src の下のソース)を、側と層ごとに集める。
 *
 * WHY NOT: 計測対象外の層の変更を黙って捨てない。ミューテーションのゲートは対象の層しか見ないので、
 * 対象外の層だけを変えた PR は「対象なし」で終わる。それを合格と取り違えないよう、変更があったことを表に出す。
 *
 * @param files 変更されたファイル(リポジトリ相対パス)
 * @param policy tools/policy/mutation.json
 * @returns {Array<{side: string, layer: string, files: string[]}>} 側と層の順に並べる
 */
export function uninstrumentedChanges(files, policy) {
  const found = new Map();
  for (const file of files) {
    for (const { side, pattern } of SOURCE) {
      const m = pattern.exec(file);
      if (!m || m[2].split('/').includes('Generated')) continue;
      if (policy[side].instrument.includes(m[1])) continue;
      const key = `${side}/${m[1]}`;
      const entry = found.get(key) ?? { side, layer: m[1], files: [] };
      entry.files.push(file);
      found.set(key, entry);
    }
  }
  return [...found.values()].sort((a, b) => `${a.side}/${a.layer}`.localeCompare(`${b.side}/${b.layer}`));
}

/** 通知の本文。ゲートの名前に続けて出す。 */
export function uninstrumentedNotice(gateName, changes) {
  const layers = changes.map((c) => `${c.side}/${c.layer}(${c.files.length} ファイル)`).join('、');
  return `${gateName}: 計測対象外の層の変更: ${layers}。ミューテーションは計測されない。手作業の変異で判定する(TQ-M10)`;
}
