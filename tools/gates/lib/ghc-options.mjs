// GHC のオプションの分類。.cabal と OPTIONS_GHC プラグマの両方の検査で使う。

/** 警告やエラーを弱めるオプションだけを取り出す。`-with-rtsopts` などを巻き込まない。 */
export function warningSuppressions(options) {
  return options.filter((o) => /^-(w|Wwarn(=.+)?|Wno-.+|fno-warn-.+|fdefer-.+)$/.test(o));
}
