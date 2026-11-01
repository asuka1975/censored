---
title: コメント
owner: asuka1975
status: living
last_reviewed: 2026-11-02
---

# コメント

コメントは **WHY NOT** を書く場所である。コードを読めば分かること(HOW)、テストを読めば分かること(WHAT)、コミットログにあるべきこと(WHY)は書かない。

## タグ

Haddock を除くすべてのコメントは、次のいずれかで始める。タグのないコメントは `check-source` が拒否する。

| タグ | 用途 | 例 |
| --- | --- | --- |
| `WHY NOT:` | 自明な別解を採らない理由 | `-- WHY NOT: Map にしない。キーが連番で Vector の方が 10 倍速い(計測済み)。` |
| `SAFETY:` | 安全でない操作が成立する条件 | `-- SAFETY: JS 側は例外を投げず、必ず数値を返す。` |
| `TODO(#n):` | Issue に紐づく未対応 | `-- TODO(#128): 添付の複数化に対応する。` |
| `FIXME(#n):` | Issue に紐づく既知の問題 | `-- FIXME(#131): 同時更新で件数がずれる。` |

## 規則

| ID | 規則 | 検査 |
| --- | --- | --- |
| CMT-1 | コメントはタグで始める(Haddock を除く)。コメントアウトしたコードも拒否される | `check-source` |
| CMT-2 | タグの理由は 8 文字以上で具体的に書く | `check-source` |
| CMT-3 | `TODO` / `FIXME` は Issue 番号を持つ。`XXX`、`HACK` は使わない | `check-source` |
| CMT-4 | 検査の抑止(HLint の `ignore`、警告を弱める `OPTIONS_GHC`、`DisableMutation`)には直上に `WHY NOT:`。対象の一覧は [02 Linter と整形](02-lint.md) | `check-source` |
| CMT-5 | `src/` のモジュールは先頭に Haddock で責務を 1〜3 行書く | `check-source` |
| CMT-6 | `foreign import` には直上に `SAFETY:` で JS 側の前提を書く | `check-source` |
| CMT-7 | Haddock に処理手順を書かない。型で表せない事前条件・事後条件・法則だけを書く | レビュー |
| CMT-8 | コメントは日本語で書く。識別子とタグは英語のまま | レビュー |
| CMT-9 | 構造に関わる理由は ADR に書き、コメントは番号で参照する。Superseded の ADR を参照しない | `check-adr`(ADR-6) |

## 良い例と悪い例

### WHY NOT

```haskell
-- 悪い: コードの言い換え(HOW)
-- 空白を除去してから長さを確認する
mkPostBody raw = ...

-- 悪い: 理由だが、この場所に留める必要がない(WHY → コミットログ)
-- 利用者の要望で 500 文字に増やした
maxLength = 500

-- 良い: 次の人が試しそうな別解を止める(WHY NOT)
-- WHY NOT: T.length で書記素を数えない。絵文字の結合で見た目と食い違うが、DB の制約が
-- コードポイント単位なので、ここだけ書記素にすると保存時に初めて失敗する。
```

### Haddock

```haskell
-- 良い: 型で表せない法則
-- | 同じ入力に対して冪等。@normalize . normalize == normalize@
normalize :: Text -> Text

-- 悪い: 手順の説明
-- | テキストを受け取り、前後の空白を除去し、連続する空白を 1 つにして返す。
normalize :: Text -> Text
```

モジュールヘッダには、このモジュールが何の責任を持つかを書く。

```haskell
-- | 投稿本文の不変条件を型の境界で保証する。
module Censored.Domain.PostBody
```

### テストのコメント

テストにも同じ規則を適用する。`-- Given / When / Then` のような区切りコメントは書かない。分かりにくいテストは名前と構造で直す。

## なぜ機械で強制するのか

AI は放っておくと、コードを言い換えるコメントを大量に書く。タグを必須にすると、書く前に「これは WHY NOT か」を問うことになり、説明コメントの多くは書く理由がないと分かる。

検査が見ているのはタグの有無と長さだけで、中身の質は保証しない。`WHY NOT:` を付けただけの言い換えは PR のレビューで指摘する。
