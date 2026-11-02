#!/usr/bin/env bash
# 書記素の分割に使う ICU の開発ファイルが導入済みかを確かめる(ADR-0009)。
# WHY NOT: ICU が無いまま先へ進めない。ヘッダが無いと、Cabal のソルバーが古い text-icu と text に黙って後退する。
set -euo pipefail

if ! command -v pkg-config >/dev/null 2>&1 || ! pkg-config --exists 'icu-i18n >= 62.1'; then
  echo "ICU の開発ファイル(icu-i18n 62.1 以上)が必要(ADR-0009)。導入して再実行する: sudo apt-get install libicu-dev pkg-config" >&2
  exit 1
fi
