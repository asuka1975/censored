#!/usr/bin/env bash
# 開発ツールを .tools/bin に導入する。システム全体には触らない。
# 対応環境: x86_64 Linux(glibc 2.34 以上。fourmolu の配布バイナリの要件)。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=tools/versions.env
source "$ROOT/tools/versions.env"
BIN="$ROOT/.tools/bin"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$BIN"

"$ROOT/tools/require-icu.sh"

fetch() {
  local url="$1" sha="$2" out="$3"
  curl -fsSL --retry 3 -o "$out" "$url"
  echo "$sha  $out" | sha256sum -c --quiet -
}

have() { [ -x "$BIN/$1" ] && "$BIN/$1" "${2:---version}" 2>&1 | grep -q "$3"; }

if ! command -v "ghc-$GHC" >/dev/null 2>&1 || ! command -v "cabal-$CABAL" >/dev/null 2>&1; then
  if command -v ghcup >/dev/null 2>&1; then
    ghcup install ghc "$GHC"
    ghcup install cabal "$CABAL"
  elif ! { command -v ghc >/dev/null 2>&1 && ghc --numeric-version | grep -qx "$GHC" \
        && command -v cabal >/dev/null 2>&1 && cabal --numeric-version | grep -qx "$CABAL"; }; then
    echo "GHC $GHC と Cabal $CABAL が必要。ghcup を導入して再実行する: https://www.haskell.org/ghcup/" >&2
    exit 1
  fi
fi

# 版付きコマンドがある環境では、版なしの名前を固定版へ向ける。
link_versioned() {
  local name="$1" versioned="$2"
  if command -v "$versioned" >/dev/null 2>&1; then
    ln -sf "$(command -v "$versioned")" "$BIN/$name"
  fi
}
link_versioned ghc "ghc-$GHC"
link_versioned ghc-pkg "ghc-pkg-$GHC"
link_versioned hpc "hpc-$GHC"
link_versioned cabal "cabal-$CABAL"
export PATH="$BIN:$PATH"

if ! have fourmolu --version "fourmolu $FOURMOLU"; then
  fetch "https://github.com/fourmolu/fourmolu/releases/download/v$FOURMOLU/fourmolu-$FOURMOLU-linux-x86_64.zip" "$FOURMOLU_SHA256" "$TMP/fourmolu.zip"
  unzip -oq "$TMP/fourmolu.zip" -d "$TMP/fourmolu"
  install -m 755 "$(find "$TMP/fourmolu" -type f -name fourmolu)" "$BIN/fourmolu"
fi

if ! have hlint --version "HLint v$HLINT"; then
  fetch "https://github.com/ndmitchell/hlint/releases/download/v$HLINT/hlint-$HLINT-x86_64-linux.tar.gz" "$HLINT_SHA256" "$TMP/hlint.tgz"
  tar -xzf "$TMP/hlint.tgz" -C "$TMP"
  install -m 755 "$TMP/hlint-$HLINT/hlint" "$BIN/hlint"
  cp -r "$TMP/hlint-$HLINT/data" "$BIN/"
fi

if ! have hpc-codecov --version "$HPC_CODECOV"; then
  fetch "https://github.com/8c6794b6/hpc-codecov/releases/download/v$HPC_CODECOV/hpc-codecov-Linux-X64-static" "$HPC_CODECOV_SHA256" "$TMP/hpc-codecov"
  install -m 755 "$TMP/hpc-codecov" "$BIN/hpc-codecov"
fi

if ! have osv-scanner --version "$OSV_SCANNER"; then
  fetch "https://github.com/google/osv-scanner/releases/download/v$OSV_SCANNER/osv-scanner_linux_amd64" "$OSV_SCANNER_SHA256" "$TMP/osv-scanner"
  install -m 755 "$TMP/osv-scanner" "$BIN/osv-scanner"
fi

if ! have gitleaks version "$GITLEAKS"; then
  fetch "https://github.com/gitleaks/gitleaks/releases/download/v$GITLEAKS/gitleaks_${GITLEAKS}_linux_x64.tar.gz" "$GITLEAKS_SHA256" "$TMP/gitleaks.tgz"
  tar -xzf "$TMP/gitleaks.tgz" -C "$TMP" gitleaks
  install -m 755 "$TMP/gitleaks" "$BIN/gitleaks"
fi

if ! have actionlint --version "$ACTIONLINT"; then
  fetch "https://github.com/rhysd/actionlint/releases/download/v$ACTIONLINT/actionlint_${ACTIONLINT}_linux_amd64.tar.gz" "$ACTIONLINT_SHA256" "$TMP/actionlint.tgz"
  tar -xzf "$TMP/actionlint.tgz" -C "$TMP" actionlint
  install -m 755 "$TMP/actionlint" "$BIN/actionlint"
fi

# GHC の ABI に結びつくツール。プロジェクトの外で入れて、固定した依存に影響されないようにする。
cabal_tool() {
  local pkg="$1" version="$2" exe="$3" flag="$4" pattern="$5"
  if have "$exe" "$flag" "$pattern"; then return; fi
  cabal update
  (cd "$TMP" && cabal install "$pkg-$version" --with-compiler="ghc-$GHC" \
     --installdir="$BIN" --install-method=copy --overwrite-policy=always -j)
}
cabal_tool weeder "$WEEDER" weeder --version "$WEEDER"
cabal_tool sydtest-mutation-driver "$SYDTEST_MUTATION_DRIVER" sydtest-mutation-driver --version "$SYDTEST_MUTATION_DRIVER"

echo "toolchain: $BIN に導入済み"
