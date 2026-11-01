// Stryker の結果を PureScript の行へ戻して分類する。
import { decodeMappings, originalPosition } from './sourcemap.mjs';

// purs が生成するコードに対応づく行。作者が書いたロジックではないので判定に入れない。
const GENERATED_LINE = /^\s*(derive\b|newtype\b|data\b|type\b|foreign\b|import\b|module\b|[a-z][\w']*\s*::)/;

/**
 * WHY NOT: Stryker のスコアをそのまま使わない。JS には purs が生成したコード(derive の実装、パターン照合の
 * 失敗分岐など)が含まれ、PS の作者が書いていない変異で数字が大きく下がる。PS の行へ戻せるものだけを数える。
 *
 * @param results Stryker の mutation.json
 * @param loadMap JS ファイル → { mappings, sourcePath(index) }。無ければ null
 * @param loadSource PS ファイル → 本文。無ければ null
 * @param changed 差分モードの変更行(Map<PS ファイル, Set<行>>)。全体モードでは null
 */
export function classifyMutants(results, { loadMap, loadSource, changed }) {
  const out = { killed: 0, survived: 0, ignored: 0, undetermined: 0, survivors: [], problems: [] };
  for (const [jsFile, entry] of Object.entries(results.files ?? {})) {
    const map = loadMap(jsFile);
    if (!map) {
      // WHY NOT: 読み飛ばさない。判定材料の欠落を黙って捨てると、生存ミュータントがあっても 0 件で合格する。
      out.problems.push(`${jsFile}: ソースマップが無く、ミュータントを PS の行へ戻せない`);
      continue;
    }
    const decoded = decodeMappings(map.mappings);
    for (const mutant of entry.mutants) {
      const pos = originalPosition(decoded, mutant.location.start.line - 1, mutant.location.start.column - 1);
      if (!pos) {
        out.ignored += 1;
        continue;
      }
      const psFile = map.sourcePath(pos.src);
      const source = loadSource(psFile);
      if (source === null) {
        out.problems.push(`${jsFile}: ソースマップが指す ${psFile} が無い`);
        continue;
      }
      const lineText = source.split('\n')[pos.line - 1] ?? '';
      if (GENERATED_LINE.test(lineText) || (changed && !changed.get(psFile)?.has(pos.line))) {
        out.ignored += 1;
      } else if (mutant.status === 'Killed' || mutant.status === 'Timeout') {
        out.killed += 1;
      } else if (mutant.status === 'Survived' || mutant.status === 'NoCoverage') {
        out.survived += 1;
        out.survivors.push(`${psFile}:${pos.line} [${mutant.mutatorName}] ${lineText.trim()}`);
      } else if (mutant.status === 'Ignored') {
        out.ignored += 1;
      } else {
        out.undetermined += 1;
      }
    }
  }
  return out;
}
