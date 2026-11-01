---
title: 依存パッケージ
owner: asuka1975
status: living
last_reviewed: 2026-11-02
---

# 依存パッケージ

依存は将来の保守コストと攻撃面の借り入れである。AI は依存を簡単に増やすので、追加に手続きを課す。

## 規則

| ID | 規則 | 検査 |
| --- | --- | --- |
| DEP-1 | 直接依存はすべて台帳 `tools/policy/dependencies.json` に用途つきで登録する | `check-deps` |
| DEP-2 | 基盤となる依存(`tier: foundation`)は ADR を要する | `check-deps` |
| DEP-3 | 版を固定する(下表)。固定ファイルをコミットする | `check-deps` |
| DEP-4 | 使われなくなった依存は台帳からも消す | `check-deps`、spago pedantic、`-Wunused-packages` |
| DEP-5 | Git 直参照(`source-repository-package`、`extraPackages`)を使わない | `check-deps` |
| DEP-6 | GitHub Actions はコミット SHA で固定する | `check-deps` |
| DEP-7 | ライセンスは許可リスト内。テスト専用の例外が製品の依存グラフに含まれない | `check-licenses`、`check-layers` |
| DEP-8 | プロジェクト自身が OSI 承認ライセンスを持つ(sydtest の利用条件)。`tools/policy/licenses.json` の `project` に宣言し、`LICENSE` の本文と対応させる | `check-licenses`(宣言と本文の対応のみ。法的な妥当性は人間が ADR で判断する) |
| DEP-9 | インストールスクリプトは `allowBuilds` に明示したものだけ実行する | pnpm |
| DEP-10 | 既知の脆弱性を残さない。無視は `osv-scanner.toml` に期限と理由を書く | `make vulns` |
| DEP-11 | 公開から 7 日未満の npm パッケージを取り込まない | pnpm `minimumReleaseAge` |
| DEP-12 | 月に一度、依存の更新をまとめて行う。セキュリティ修正は随時 | 運用 |

## 固定の方法

| エコシステム | 宣言 | 固定 |
| --- | --- | --- |
| Haskell | `.cabal` の `build-depends` | `index-state` + `cabal.project.freeze` |
| PureScript | `spago.yaml` | package set の版 + `spago.lock` |
| npm(ツール) | `package.json`(完全一致の版) | `pnpm-lock.yaml` |
| ツールチェーン | `tools/versions.env` | SHA-256 で検証してダウンロード |
| GitHub Actions | ワークフロー | コミット SHA |

Hackage に公開しないので `.cabal` に上限を書かない。固定の正本は freeze である。`censored-*` 同士にも書かない。

## 追加の手順

1. **本当に要るか。** 標準ライブラリか既存の依存で書けないか。20 行で書けるなら書く。
2. **候補を比べる。** 下の基準で 2 つ以上を見る。
3. **ライセンスを確認する。** 許可リスト外なら止まって人間に相談する。
4. **台帳に登録する。**

   ```json
   "servant": {
     "purpose": "HTTP API の型レベル定義",
     "tier": "foundation",
     "adr": "ADR-0007",
     "reviewed": "2026-11-02"
   }
   ```

5. **freeze を更新する。** `make freeze` または `spago build`。差分が予想より大きければ止まって理由を調べる。
6. **基盤なら ADR を書く。**

台帳と固定ファイルは製品コードと同じ PR で更新する。他のゲート設定と異なり、[AI-8](11-ai-native-flow.md) の分離の対象にしない。依存の追加を確認する場は、台帳の差分と Code Owners の承認である。

## 導入基準

| 観点 | 基準 |
| --- | --- |
| 保守 | 18 か月以内にリリースがある。Issue に反応がある |
| 互換 | 固定した GHC / PureScript の版で実際にビルドできる |
| 開発者 | 一人だけの場合は、止まったときにフォークできる規模か |
| 推移依存 | 増える推移依存の数を確認した |
| 権限 | インストールスクリプトやネットワークアクセスの有無 |
| 代替 | なぜ他の候補を採らないか説明できる |

**AI が提案する依存は実在を確認する。** 存在しない、あるいは名前が似た別物のパッケージを提案することがある。Hackage、Pursuit、npm で確認し、固定した版でビルドを通す。

## tier の定義

| tier | 意味 | 例 | 要件 |
| --- | --- | --- | --- |
| `foundation` | 置き換えが設計変更になる | servant、DB ライブラリ、UI フレームワーク | ADR |
| `standard` | 用途が明確で置き換え可能 | text、containers | 台帳 |
| `test` | テストでのみ使う | sydtest、hedgehog | 台帳 |
| `tool` | 開発ツール | spago、stryker | 台帳 |

## ライセンス

許可リストの正本は [tools/policy/licenses.json](../../tools/policy/licenses.json)。

### 例外: sydtest

sydtest 系のパッケージは独自ライセンスで、次の条件で利用する([ADR-0004](../adr/0004-test-stack-and-mutation.md))。

- テスト対象が OSI 承認ライセンスの OSS であること(商用利用自体は妨げない)
- sydtest を改変したら同じライセンスで公開すること

**プロジェクトを非公開にする、または OSI 承認でないライセンスに変更する場合は、sydtest の利用条件を満たさなくなる。** その判断の前に、作者との個別契約かテスト基盤の移行が必要である。

### 例外: opt-env-conf

sydtest の推移依存で LGPL-3.0-only。テストのバイナリにのみリンクし、配布しない。

### テスト専用の例外の検証

例外に `testOnly: true` を付けたパッケージは、製品に含まれないことを `check-licenses` が `plan.json` の依存グラフで確かめる。library と executable から到達できれば不合格になる。

### 判定できないときは失敗させる

ビルド計画が無い、cabal store でライセンス情報を見つけられない、`pnpm licenses` が失敗した、といった場合は `GATE-1` で失敗する。確認できなかったものを合格にしない。CI のジョブごとに揃うものが異なるので、`LICENSE_SCOPE` で対象を指定する(`make licenses LICENSE_SCOPE=hackage`)。

## 脆弱性

`make vulns` が OSV のデータベースと固定ファイルを照合する。Hackage、npm の両方に対応する(PureScript の Registry は対象外)。

無視には期限を必ず付ける。期限が切れると CI が再び失敗し、判断をやり直すことになる。

```toml
[[IgnoredVulns]]
id = "HSEC-2023-0007"
ignoreUntil = 2027-05-01
reason = "外部入力を readFloat に渡す経路がない。HLint で read を禁止している"
```
