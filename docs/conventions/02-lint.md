---
title: Linter と整形
owner: asuka1975
status: living
last_reviewed: 2026-11-02
---

# Linter と整形

`make lint` が入口。ツール選定の根拠は [ADR-0003](../adr/0003-toolchain-and-lint-stack.md)。

## Haskell

| ID | 規則 | ツール |
| --- | --- | --- |
| LINT-H1 | 整形は Fourmolu に従う。手で整えない | `fourmolu --mode check` |
| LINT-H2 | 警告はエラー。警告方針は `backend/cabal.project` の `program-options` にだけ書き、`.cabal` で緩めない | GHC `-Werror`、`check-layers` |
| LINT-H3 | 部分関数(`head`、`fromJust`、`read`、`error` など)、`unsafePerformIO`、デバッグ出力は禁止 | HLint(`backend/.hlint.yaml`) |
| LINT-H4 | 未使用のコードを残さない | weeder |

有効な警告は `-Wall -Wcompat -Widentities -Wincomplete-record-updates -Wincomplete-uni-patterns -Wmissing-deriving-strategies -Wmissing-export-lists -Wmissing-home-modules -Wpartial-fields -Wredundant-constraints -Wunused-packages`。

weeder は古い `.hie` を読むと消したはずのコードを報告する。身に覚えのない指摘が出たら `backend/packages/*/.hie` を消して再ビルドする。

## PureScript

| ID | 規則 | ツール |
| --- | --- | --- |
| LINT-P1 | `Unsafe.Coerce`、`Partial.Unsafe`、`Effect.Unsafe`、`Unsafe.Reference` は禁止。不可避なら直上に `SAFETY:` | `check-source` |
| LINT-P2 | 全パッケージで `strict: true` と `pedanticPackages: true`(本体とテストの両方) | spago、`check-layers` |
| LINT-P3 | 整形は purs-tidy に従う | `purs-tidy check` |

### 専用 Linter を入れていない理由

PureScript の Linter は検証の結果どれもゲートに採用できなかった([ADR-0003](../adr/0003-toolchain-and-lint-stack.md))。

- コンパイラの `--strict` が未使用の名前・import などの大半を担う
- `--pedantic-packages` が依存の過不足を検出する
- プロジェクト固有の禁止事項は `check-source` に追加する

## リポジトリ規約

| ID | 規則 | ツール |
| --- | --- | --- |
| LINT-R1 | コメント・テスト名・純粋性 | `check-source` |
| LINT-R2 | パッケージ構成と依存方向 | `check-layers` |
| LINT-R3 | ADR・文書・依存の台帳 | `check-adr`、`check-docs`、`check-deps` |
| LINT-R4 | Markdown の書式 | markdownlint-cli2 |
| LINT-R5 | 秘密情報をコミットしない | gitleaks |
| LINT-R6 | CI 定義の妥当性 | `make lint-actions`(actionlint) |

違反の出力は `ファイル:行 [ルール ID] メッセージ` に統一する。AI はこの形式を読んで修正する。

## 抑止の扱い

検査を黙らせる前に、まずコードを直す。どうしても抑止するときは直上に理由を書く。理由がないと `check-source` が `CMT-4` で落とす。対象は `OPTIONS_GHC` で警告を弱めるオプション(`-w`、`-Wwarn`、`-Wno-*`、`-fno-warn-*`、`-fdefer-*`)、HLint の抑止(`HLINT ignore` と `ANN "HLint: ignore"`)、`DisableMutation`。

```haskell
-- WHY NOT: ここだけ NonEmpty にしない。外部ライブラリのコールバック型が [] を要求する。
{-# HLINT ignore "Avoid restricted function" #-}
```

## 実行の階層

| いつ | 何を | 強制力 |
| --- | --- | --- |
| コミット時 | 変更ファイルの整形・コメント規約・秘密情報、コミットログ(`.lefthookrc` が `.tools/bin` を PATH に入れる) | 便宜(`--no-verify` で迂回可能) |
| push 時 | `make check` | 便宜 |
| PR | 全ゲート | **必須チェックに設定して初めて強制** |
| 夜間 | 全体ミューテーション、新規の脆弱性、文書の鮮度 | 検知 |
