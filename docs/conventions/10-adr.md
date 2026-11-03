---
title: ADR 管理
owner: asuka1975
status: living
last_reviewed: 2026-11-03
---

# ADR 管理

ADR(Architecture Decision Record)は **WHY THIS** を残す。なぜこの設計にして、なぜ他の案を採らなかったか。半年後に「これは変えてよいのか」を判断する材料になる。

## いつ書くか

次のどれかに当たれば書く。

- 置き換えが設計変更になる技術の選定(フレームワーク、DB、認証方式、配信方式)
- 層やパッケージの構成の変更
- API やデータモデルの互換性に関わる方針
- セキュリティ・プライバシーの方針
- 規約やゲートの大きな変更
- 非機能要件を受け入れて破る判断

書かなくてよいもの: 1 か所で完結する実装の選択(コメントの `WHY NOT:`)、簡単に戻せる選択。

## 形式

[template.md](../adr/template.md) を使う。`/new-adr` スキルで番号の採番と索引の更新ができる。

```text
docs/adr/NNNN-短い-slug.md
```

## 状態遷移

```text
Proposed ──承認──→ Accepted ──→ Superseded by ADR-NNNN
    │                  └──────→ Deprecated
    └──却下──→ Rejected
```

| 状態 | 意味 |
| --- | --- |
| Proposed | 提案中。実装の前提にしてよいが、覆る可能性がある |
| Accepted | 人間が承認した決定 |
| Rejected | 検討の結果、採らなかった。**再検討を防ぐために残す** |
| Deprecated | 前提が消えて無効になった |
| Superseded by ADR-NNNN | 新しい ADR に置き換えられた |

## 規則

| ID | 規則 | 検査 |
| --- | --- | --- |
| ADR-1 | 番号は 0001 からの連番。欠番と重複を作らない | `check-adr` |
| ADR-2 | 必須項目: タイトル、Status、Date、Deciders、背景、決定、検討した代替案、結果、再検討の条件 | `check-adr` |
| ADR-3 | Status は定義された値のみ。置き換え先は実在する。Accepted を Proposed などへ戻さない | `check-adr` |
| ADR-4 | 代替案は採用案を含めて 2 つ以上。不採用の案に却下理由を書く | `check-adr` |
| ADR-5 | `docs/adr/README.md` の索引に載せ、状態を一致させる | `check-adr` |
| ADR-6 | コードから参照する ADR は実在し、置き換えられていない | `check-adr` |
| ADR-7 | Accepted の本文は変更も削除もしない。変更できるのは Status 行のみ。考えが変わったら新しい ADR を書く。基準版と番号で対応づけるので、改名しても検査される | `check-adr --base` |
| ADR-8 | ADR が必要な変更は、実装 PR の前か同じ PR で ADR を出す | レビュー |
| ADR-9 | **Accepted にするのは人間だけ。** AI は Proposed までを起草する。人間が Status 行だけを書き換えるコミットは、Why を要らない([COM-9](08-commits.md)) | CODEOWNERS |

## 書き方

- **背景は事実を書く。** 制約、計測値、検証の結果。推測には推測と書く。
- **決定は能動態で 1 段落。** 「〜を使う」。
- **却下理由が本体である。** 採用理由だけの ADR は半年後に役に立たない。
- **結果には悪いことも書く。** 受け入れたコストと負債を明記する。
- **再検討の条件を具体的に書く。** 「月間アクティブが 10 万を超えたら」「sydtest の開発が 6 か月止まったら」。AI はこれを読んで、前提が崩れたことを指摘できる。

## 参照

コードのコメント、コミットのトレーラー、依存の台帳から番号で参照する。

```haskell
-- WHY NOT: ファンアウトを読み取り時に行わない(ADR-0012)。
```

```text
ADR: 0012
```
