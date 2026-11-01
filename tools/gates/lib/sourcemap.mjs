// Source Map v3 の mappings を復号する最小実装。

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * 1 要素のセグメントは「ここから先は元ソースに対応しない」という境界なので、src を null にして残す。
 * @returns {Array<Array<{genCol:number, src:number|null, line:number|null, col:number|null}>>} 生成行ごとのセグメント(line は 1 始まり)
 */
export function decodeMappings(mappings) {
  const lines = [];
  let src = 0;
  let origLine = 0;
  let origCol = 0;
  for (const genLine of mappings.split(';')) {
    const segments = [];
    let genCol = 0;
    for (const seg of genLine.split(',')) {
      if (!seg) continue;
      const fields = [];
      let value = 0;
      let shift = 0;
      for (const ch of seg) {
        const digit = B64.indexOf(ch);
        value |= (digit & 31) << shift;
        if (digit & 32) {
          shift += 5;
        } else {
          fields.push(value & 1 ? -(value >> 1) : value >> 1);
          value = 0;
          shift = 0;
        }
      }
      genCol += fields[0];
      if (fields.length >= 4) {
        src += fields[1];
        origLine += fields[2];
        origCol += fields[3];
        segments.push({ genCol, src, line: origLine + 1, col: origCol });
      } else {
        segments.push({ genCol, src: null, line: null, col: null });
      }
    }
    lines.push(segments);
  }
  return lines;
}

/** 生成コードの位置 (0 始まり行, 列) に最も近い直前のセグメントを同じ行から探す。対応がなければ null。 */
export function originalPosition(decoded, genLine, genCol) {
  const segs = decoded[genLine] ?? [];
  let best = null;
  for (const s of segs) {
    if (s.genCol <= genCol) best = s;
    else break;
  }
  return best && best.src !== null ? best : null;
}
