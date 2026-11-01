# ADR-0003: ツールチェーンと Lint の構成

- Status: Accepted
- Date: 2026-11-02
- Deciders: asuka1975

## 背景

2026-11 時点の状況を確認した。

- GHCup の Recommended は GHC 9.10.3、Cabal 3.16.1.0、HLS 2.14.0.0。Latest は GHC 9.14.1。
- PureScript は 0.15.16、Spago は 1.0.5。package set は 81.11.0。
- 手元には Haskell と PureScript のツールが未導入で、Node と Docker のみがあった。

Docker 上で次を実際に動かした。

- GHC 9.10.3 で sydtest、mutation driver、weeder がビルドできる。
- HLint 3.10 の `functions` 制限、Fourmolu 0.21 の `--mode check`(不一致で非 0 終了)。
- Fourmolu の配布バイナリは glibc 2.34 以上を要する(`haskell:9.10.3` イメージの Debian 11 では動かない)。
- osv-scanner 2.7.0 は `cabal.project.freeze` と `pnpm-lock.yaml` の両方を読める。

PureScript の Linter を評価した。

- whine 0.0.34: pnpm の構成で `purs` を見つけられず `spago build` の段階で失敗した。
- purslint 0.1.0: 動作したが、`#` や `$` の好みを指摘する提案が中心で、npm の更新は 2026-01 が最後。
- コンパイラの `--strict` と Spago の `--pedantic-packages` は未使用の名前と依存の過不足を確実に検出した。

## 決定

GHC 9.10.3、Cabal 3.16.1.0、PureScript 0.15.16、Spago 1.0.5 に固定する。版の正本は `tools/versions.env` と `package.json`。ビルドは Cabal + `index-state` + freeze とする。

Haskell の Lint は GHC の `-Werror`、Fourmolu、HLint、weeder。PureScript は `--strict`、`--pedantic-packages`、purs-tidy とし、禁止事項は `check-source` に実装する。ツールはシステムに入れず `.tools/bin` に置く。

## 検討した代替案

### 案 A: GHC 9.10.3(GHCup Recommended)(採用)

HLS、Stackage、ライブラリの対応が揃っている。欠点は最新の言語機能が使えないこと。

### 案 B: GHC 9.14.1(Latest)

新しい機能が使える。**却下理由:** GHCup が Recommended にしておらず、ミューテーションのプラグイン(GHC API に依存)を含めて検証していない。

### 案 C: Stack + LTS

パッケージの組み合わせが保証される。**却下理由:** Cabal の freeze で同等の固定ができ、sydtest の最新版を追うには Stackage の LTS が制約になる。

### 案 D: Nix

環境全体を固定でき、sydtest の mutation の公式な導線も Nix である。**却下理由:** 手元に未導入で学習コストが大きい。Cabal で mutation が動くことを確認できたので必須ではない。

### 案 E: PureScript に whine を採用

ルールを追加できる設計は魅力がある。**却下理由:** 現在の構成で起動しなかった。

### 案 F: PureScript に purslint を採用

**却下理由:** 成熟度が低く、指摘の多くが好みの問題でゲートに向かない。

## 結果

- PureScript の Lint は言語固有の細かい指摘を持たない。必要な規則は `check-source` に足す。
- x86_64 Linux 以外の開発環境には `tools/setup-toolchain.sh` の拡張が必要になる。
- 依存の更新時は `tools/versions.env` のハッシュも更新する。

## 再検討の条件

- GHCup の Recommended が 9.10 系から変わったら。
- whine が pnpm の構成で動くようになり、1.0 に達したら。
- macOS や arm64 の開発者が加わったら(setup の対応、または Nix の再検討)。
