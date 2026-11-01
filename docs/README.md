---
title: 文書の索引
owner: asuka1975
status: living
last_reviewed: 2026-11-02
---

# 文書の索引

ここから辿れない文書は存在しないものとして扱う([DOC-5](conventions/06-documentation.md))。

## まず読むもの

1. [情報配置の原則](conventions/00-principles.md) — 何をどこに書くか。すべての規約の土台
2. [AI-native 開発フロー](conventions/11-ai-native-flow.md) — 変更を入れるまでの手順

## 規約

| 文書 | 決めていること | 主な強制手段 |
| --- | --- | --- |
| [00 情報配置の原則](conventions/00-principles.md) | HOW / WHAT / WHY / WHY NOT の置き場所 | 各ゲート |
| [01 ディレクトリ構成](conventions/01-directory-structure.md) | モノレポ構成と層の依存方向 | `check-layers`、パッケージ境界 |
| [02 Linter と整形](conventions/02-lint.md) | 静的検査の一式 | `make lint`、`-Werror`、`--strict` |
| [03 テストカバレッジ](conventions/03-coverage.md) | 計測方法と下限 | `check-coverage` |
| [04 非機能要件レビューゲート](conventions/04-nfr-gate.md) | NFR の確認手順 | レビュー記録 + `check-pr` |
| [05 テスト品質レビューゲート](conventions/05-test-quality-gate.md) | テスト自体の品質 | ミューテーション、`check-source`、レビュー記録 |
| [06 ドキュメント管理](conventions/06-documentation.md) | 文書の種類と鮮度 | `check-docs`、markdownlint |
| [07 コメント](conventions/07-comments.md) | WHY NOT とタグ | `check-source` |
| [08 コミット](conventions/08-commits.md) | WHY を残すログ | `check-commits` |
| [09 依存パッケージ](conventions/09-dependencies.md) | 導入基準・固定・ライセンス | `check-deps`、`check-licenses`、OSV |
| [10 ADR 管理](conventions/10-adr.md) | 設計判断の記録 | `check-adr` |
| [11 AI-native 開発フロー](conventions/11-ai-native-flow.md) | 人と AI の役割分担 | `check-pr`、CODEOWNERS |

## 判断と要件

- [ADR 一覧](adr/README.md) — なぜこの設計か
- [非機能要件カタログ](nfr/catalog.md) — どの水準を満たすか

## プロダクトと運用

- [プロダクト要求](product/README.md) — 誰のために何を作るか
- [アーキテクチャ概要](architecture/README.md) — 全体の地図
- [運用手順書](runbooks/README.md) — 何か起きたときにどうするか
- [用語集](glossary.md) — 言葉の定義

## 文書以外の正本

| 情報 | 正本 |
| --- | --- |
| ツールの版 | [tools/versions.env](../tools/versions.env) |
| カバレッジ下限・層の定義・ライセンス許可 | [tools/policy/](../tools/policy/coverage.json) |
| 依存の台帳 | [tools/policy/dependencies.json](../tools/policy/dependencies.json) |
| API 契約 | [contract/](../contract/README.md) |
