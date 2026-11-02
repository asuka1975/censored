#!/usr/bin/env bash
# 書記素の分割に使う ICU の開発ファイルが導入済みかを確かめる(ADR-0009)。
# WHY NOT: ICU が無いまま先へ進めない。ヘッダが無いと、Cabal のソルバーが古い text-icu と text に黙って後退する。
# WHY NOT: pkg-config --exists "icu-i18n >= 62.1" で比べない。比較演算子の解釈を pkg-config に任せると、
# テストの偽物が演算子を再現する必要が生じ、下限の境界を偽物の実装が決めてしまう。
set -euo pipefail

# text-icu 0.8 の pkgconfig-depends(icu-i18n >= 62.1)と同じ下限。
MIN_ICU=62.1

fail() {
  echo "ICU の開発ファイル(icu-i18n ${MIN_ICU} 以上)が必要(ADR-0009)。導入して再実行する: sudo apt-get install libicu-dev pkg-config" >&2
  exit 1
}

installed="$(pkg-config --modversion icu-i18n 2>/dev/null)" || fail
lowest="$(printf '%s\n%s\n' "${MIN_ICU}" "${installed}" | sort -V | head -n 1)"
[ "${lowest}" = "${MIN_ICU}" ] || fail
