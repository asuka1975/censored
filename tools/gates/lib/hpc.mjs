// HPC の .mix ファイルを読む。

/**
 * ティックが 1 つもないモジュールのソースパスを返す。ティックがあれば null。
 * 型の別名だけのモジュールなどは実行コードがなく、テストから読み込まれても .tix に現れない。
 */
export function sourceWithoutTicks(mixText) {
  const m = /^Mix "([^"]+)" .*\[\]\s*$/s.exec(mixText);
  return m ? m[1] : null;
}
