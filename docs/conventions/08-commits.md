---
title: コミット
owner: asuka1975
status: living
last_reviewed: 2026-11-03
---

# コミット

コミットログは **WHY** を書く場所である。何を変えたかは `git show` で分かる。なぜ変えたかは、ここにしか残らない。

## 形式

```text
<type>(<scope>): <要約>

Why: <なぜ今この変更が必要か。背景、きっかけ、制約>

<必要なら補足: 検討の経緯など。HOW の説明は書かない>

Refs: #123
ADR: 0007
BREAKING CHANGE: <移行方法>
Co-Authored-By: <AI のモデル名> <noreply@anthropic.com>
```

### 例

```text
fix(domain): 投稿本文の上限判定を修正

Why: 500 文字ちょうどの投稿が拒否され、利用規約に書いた上限と食い違っていた。
移行元サービスの投稿を取り込むと 3% が失敗することがサポート経由で判明した。

Refs: #128
```

悪い例:

```text
fix: バグ修正                 ← 件名が何も述べていない

Why: T.length の比較を > から >= に変えた   ← HOW。diff を読めば分かる
```

## type

| type | 用途 |
| --- | --- |
| `feat` | 利用者に見える機能追加 |
| `fix` | 不具合の修正 |
| `security` | 脆弱性の修正 |
| `perf` | 性能改善 |
| `refactor` | 振る舞いを変えない変更 |
| `test` | テストのみの変更 |
| `docs` | 文書のみの変更 |
| `build` | ビルドと依存 |
| `ci` | CI と自動化 |
| `chore` | 上記以外の雑務 |
| `revert` | 取り消し |

scope は小文字の kebab-case。層の名前(`domain`、`ui`、`contract`)か領域(`deps`、`gates`)を使う。

## 規則

| ID | 規則 | 検査 |
| --- | --- | --- |
| COM-1 | 件名は `<type>(<scope>): <要約>`、要約は 72 文字以内。次の行は空行 | `check-commits` |
| COM-2 | 本文に `Why:` を 15 文字以上で書く。件名の繰り返しは不可 | `check-commits` |
| COM-3 | 1 コミット 1 目的。テストと実装は同じコミットに含める(`git bisect` を壊さない) | レビュー |
| COM-4 | 破壊的変更は `!` を付け、`BREAKING CHANGE:` に移行方法を書く | `check-commits` |
| COM-5 | 設計判断に基づく変更は `ADR: NNNN` で参照する | `check-commits`(形式) |
| COM-6 | `fixup!` / `squash!` は手元では使ってよいが、マージ前に畳む | `check-commits`(PR 範囲) |
| COM-7 | main へは rebase マージのみ。履歴を直線に保ち、整理されたコミットをそのまま残す | ブランチ保護 |
| COM-8 | AI が書いたコミットには `Co-Authored-By` を付ける | レビュー |
| COM-9 | 人間が ADR の Status 行だけを書き換えたコミットは、COM-1〜COM-5 の対象外にする(次の節) | `check-commits` |

実際のマージコミットは検査の対象外とする。判定は件名ではなく Git の状態で行う(フックでは `MERGE_HEAD`、PR の範囲では親の数)。

## 人間による ADR の承認のコミット(COM-9)

Proposed を Accepted にするだけのコミットに、書くべき理由は無い。決定は ADR の本文にあり、承認したという事実がコミットの中身そのものだからである。GitHub の画面で承認してもよいように、次のすべてを満たすコミットは COM-1〜COM-5 を検査しない。

- 作者のメールアドレスが [tools/policy/commits.json](../../tools/policy/commits.json) の `humanAuthors` にある
- メッセージに `Co-Authored-By:` と `Claude-Session:` が無い
- 変更が `docs/adr/NNNN-*.md` の Status 行と、`docs/adr/README.md` の索引の状態の列だけで、新しい状態が `Accepted` または `Superseded by ADR-NNNN` である

条件を満たすかを解釈できないとき(ファイルの追加や削除、読めない内容、登録の欠落)は免除せず、通常の検査に戻る。

- Rejected と Deprecated への変更は対象にしない。却下や廃止の理由を書く場所が、コミットログの Why だけだからである
- `fixup!` は免除しない(COM-6)
- 判定の根拠は作者であり、コミッターではない。AI が書いたコミットも、人間のアカウントでコミットされる
- 作者は偽れる。「Accepted にするのは人間だけ」の強制は [ADR-9](10-adr.md) の CODEOWNERS が担い、ここで外すのは Why の検査だけである
- コミット時のフックは、HEAD との差分で判定する。`git commit --amend` では直前のコミットの変更を含めずに判定するので、CI の範囲検査が最終の判定になる

## なぜ squash マージにしないか

squash すると、PR 内の別々の理由が 1 つのメッセージに潰れる。コミットログを WHY の正本とする以上、理由の単位を保つ。そのかわり、マージ前に履歴を整理する責任を負う(COM-6)。

## Why に書くこと

- きっかけ: 障害、要望、計測結果、依存の変更
- 制約: 今この形にしなければならない理由
- 影響: 誰の何が変わるか

書かないこと:

- どう直したか(コードに書いてある)
- ファイルの一覧(`git show --stat` で分かる)
- 将来の予定(Issue に書く)

他の変更の判断を縛る理由は [ADR](10-adr.md) に昇格させる。
