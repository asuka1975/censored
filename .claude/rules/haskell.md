---
paths:
  - "backend/**/*.hs"
  - "backend/**/*.cabal"
---

# Haskell

正本: `docs/conventions/01-directory-structure.md`、`02-lint.md`、`07-comments.md`

- 失敗は型で返す。`head`、`fromJust`、`read`、`error`、`undefined` を使わない
- `domain` では `IO` を使わない。外部依存は `application` の Port を経由する
- 不正な値は型の境界で弾く(`newtype` + スマートコンストラクタ)
- モジュールは明示的な export list と、先頭の Haddock(責務を 1〜3 行)を持つ
- `deriving` には strategy を書く(`deriving stock`)
- 警告を `.cabal` で抑止しない
- 新しい `.cabal` は `backend/README.md` の雛形から作る
- 依存を追加したら `make freeze` と `tools/policy/dependencies.json` の更新
