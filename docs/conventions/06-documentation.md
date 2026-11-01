---
title: ドキュメント管理
owner: asuka1975
status: living
last_reviewed: 2026-11-02
---

# ドキュメント管理

文書はコードより速く腐る。**書く量を減らす** ことを第一の対策にする。実行できるもの(テスト、型、Makefile)で表せることは文書にしない。

## 文書の種類

| 場所 | 内容 | 更新の契機 |
| --- | --- | --- |
| `docs/conventions/` | 作業の規約 | 規約の変更(単独 PR) |
| `docs/adr/` | 設計判断 | 判断の発生。本文は不変 |
| `docs/nfr/` | 非機能要件 | 要件の変更、障害の教訓 |
| `docs/product/` | 誰のために何を作るか | 方針の変更 |
| `docs/architecture/` | 全体の地図。箱と矢印 | 構造の変更 |
| `docs/runbooks/` | 障害時の手順 | 障害と訓練 |
| `docs/glossary.md` | 用語の定義 | 新しい用語 |

## 規則

| ID | 規則 | 検査 |
| --- | --- | --- |
| DOC-1 | 同じ事実を二か所に書かない。[情報配置の原則](00-principles.md)に従い、他からはリンクする | レビュー |
| DOC-2 | `docs/` の文書には front matter(`title`、`owner`、`status`、`last_reviewed`)を付ける。ADR を除く | `check-docs` |
| DOC-3 | `status: living` の文書は 180 日以内にレビューする。超過は手元では警告、夜間ジョブでは失敗 | `check-docs` |
| DOC-4 | 相対リンクを切らさない | `check-docs` |
| DOC-5 | `docs/README.md` からリンクを辿って到達できる | `check-docs` |
| DOC-6 | コードの変更で事実が変わる文書は同じ PR で更新する | レビュー |
| DOC-7 | Markdown は markdownlint に従う | markdownlint-cli2 |
| DOC-8 | Haddock など生成できる API 文書はコミットしない。CI で生成する | レビュー |
| DOC-9 | 図は Mermaid などテキストで書き、差分をレビュー可能にする | レビュー |
| DOC-10 | 不要になった文書は `status: deprecated` で後継を示すか削除する。履歴は git にある | レビュー |

## front matter

```yaml
---
title: 投稿の配信方式
owner: asuka1975
status: living        # living | draft | deprecated
last_reviewed: 2026-11-02
---
```

`last_reviewed` は内容を確認して正しいと判断した日。文字の修正では更新しない。

## 書き方

- 結論を先に書く。経緯は ADR に任せる。
- 手順はコマンドで書き、`make` のターゲットがあればそれを使う。
- 実装の説明を書かない。コードへのリンクも最小限にする(パスは変わる)。
- 将来の予定を現在形で書かない。予定は Issue に置く。

## AI が読む文書として

文書は AI のコンテキストを消費する。

- `AGENTS.md` は 200 行以内(`check-docs` の AI-3)。詳細はこの `docs/` へのリンクにする。
- 特定のファイルにだけ関わる規則は `.claude/rules/` にパス指定で置く。関係するファイルを触るときだけ読み込まれる。
- 規則の本文は `docs/conventions/` を正本とし、`.claude/rules/` は要点と参照先だけを書く。
