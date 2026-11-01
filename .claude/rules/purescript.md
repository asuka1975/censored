---
paths:
  - "frontend/**/*.purs"
  - "frontend/**/spago.yaml"
---

# PureScript

正本: `docs/conventions/01-directory-structure.md`、`02-lint.md`、`07-comments.md`

- `core` では `Effect` と `Web.*` を使わない
- `Unsafe.Coerce`、`Partial.Unsafe`、`Effect.Unsafe` を使わない。不可避なら直上に `SAFETY:`
- `foreign import` には直上に `SAFETY:` で JS 側の前提を書く
- `where` は最後のガードにしか束縛されない。共有する値は `let` で書く
- モジュールは明示的な export list と、先頭の `-- |`(責務を 1〜3 行)を持つ
- 表示文字列をコードに直接書かない(NFR-I18N-1)。ユーザー入力を HTML として挿入しない(NFR-SEC-7)
