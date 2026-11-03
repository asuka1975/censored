---
title: ADR 一覧
owner: asuka1975
status: living
last_reviewed: 2026-11-02
---

# ADR 一覧

規約は [ADR 管理](../conventions/10-adr.md)。新規作成は `/new-adr` または [template.md](template.md) から。

| 番号 | タイトル | 状態 |
| --- | --- | --- |
| [0001](0001-information-placement.md) | 情報配置の原則と機械強制 | Accepted |
| [0002](0002-monorepo-and-package-boundaries.md) | モノレポとパッケージ境界によるレイヤ強制 | Accepted |
| [0003](0003-toolchain-and-lint-stack.md) | ツールチェーンと Lint の構成 | Accepted |
| [0004](0004-test-stack-and-mutation.md) | テスト基盤とミューテーションテスト | Accepted |
| [0005](0005-coverage-measurement.md) | カバレッジの計測方法 | Accepted |
| [0006](0006-project-license.md) | プロジェクトのライセンス | Accepted |
| [0007](0007-api-contract.md) | バックエンドとフロントエンドの API 契約 | Accepted |
| [0008](0008-review-gate-record.md) | レビューゲートの記録方式 | Accepted |
| [0009](0009-grapheme-counting.md) | 書記素単位の文字数の数え方 | Superseded by ADR-0010 |
| [0010](0010-grapheme-counting-in-infra.md) | 書記素の数え方を infra に置き、ICU の IO 版を保持付きで呼ぶ | Accepted |
