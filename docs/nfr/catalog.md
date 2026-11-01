---
title: 非機能要件カタログ
owner: asuka1975
status: living
last_reviewed: 2026-11-02
---

# 非機能要件カタログ

Censored が満たすべき水準。確認の手順は [非機能要件レビューゲート](../conventions/04-nfr-gate.md)。

> **数値はすべて初期値である。** 想定利用者数と運用体制が決まっていない段階の出発点で、実測と方針決定にあわせて見直す。実現を前提にできない項目は、人間が判断して緩和する。

検証方法の凡例:

- **review**: `nfr-reviewer` が差分を読んで判定
- **CI**: CI の自動検査で判定
- **test**: テストの存在をレビューで確認
- **load**: 負荷試験で判定(環境の整備後)
- **ops**: 運用で確認

## 変更パスと観点の対応

レビュアーはまずこの表で観点を絞る。該当がなくても、差分から明らかに関係する観点は見る。

| 変更パス | 見る観点 |
| --- | --- |
| `backend/packages/server/` のハンドラ | SEC、PRIV、PERF、OBS、ABUSE |
| `backend/packages/application/` | SEC、PRIV、PERF、REL |
| `backend/packages/infra/` | PERF、REL、OBS、SEC |
| `backend/migrations/` | MIG、PRIV、PERF |
| `backend/packages/contract/`、`contract/` | MIG、SEC、PRIV |
| `frontend/packages/ui/` | A11Y、I18N、WEB、SEC |
| `frontend/packages/app/` | WEB、SEC、LIC |
| `frontend/packages/api-client/` | SEC、REL |
| 依存の変更 | SEC、WEB |

## SEC セキュリティ

| ID | 要件 | 検証 |
| --- | --- | --- |
| NFR-SEC-1 | 公開を明示したものを除き、全エンドポイントで認証を要求する。既定は拒否 | review, test |
| NFR-SEC-2 | リソースごとに所有者または権限を確認する(IDOR の防止)。「他人の〜を操作できない」テストを持つ | review, test |
| NFR-SEC-3 | 外部入力は境界で型に変換し、検証済みの型だけを内部に渡す | review |
| NFR-SEC-4 | SQL はパラメータ化する。文字列連結で組み立てない | review |
| NFR-SEC-5 | パスワードは Argon2id で保存する。平文、可逆暗号、独自方式を使わない | review |
| NFR-SEC-6 | セッショントークンは十分な乱数で生成し、Cookie は `HttpOnly`、`Secure`、`SameSite` を設定する。状態変更には CSRF 対策を持つ | review |
| NFR-SEC-7 | 投稿本文などのユーザー入力を描画時にエスケープする。HTML を直接挿入しない | review |
| NFR-SEC-8 | CSP を設定し、`unsafe-inline` と `unsafe-eval` を使わない | review |
| NFR-SEC-9 | 秘密情報をコード、ログ、クライアントに含めない | CI(gitleaks), review |
| NFR-SEC-10 | アップロードされたファイルの種類とサイズを検証し、別オリジンから配信する | review |
| NFR-SEC-11 | 既知の脆弱性を放置しない | CI(osv-scanner) |

## PRIV プライバシー

| ID | 要件 | 検証 |
| --- | --- | --- |
| NFR-PRIV-1 | ログと計測に個人情報(メールアドレス、IP アドレス、投稿本文、DM)を平文で記録しない | review |
| NFR-PRIV-2 | 投稿の公開範囲を全ての読み取り経路で強制する。タイムライン、検索、通知、API、キャッシュを含む | review, test |
| NFR-PRIV-3 | ブロックとミュートを全ての読み取り経路に反映する | review, test |
| NFR-PRIV-4 | 退会時に個人データを定められた期間内に削除する。バックアップと派生データ(検索インデックス、キャッシュ)を含む。初期値: 30 日 | review, ops |
| NFR-PRIV-5 | 利用者が自分のデータをエクスポートできる | test |
| NFR-PRIV-6 | 新しい個人情報の項目を追加する際は、目的と保持期間を記録する | review |
| NFR-PRIV-7 | 個人情報保護法への適合を確認する。海外展開時は GDPR も確認する | ops(人間) |

## PERF 性能

| ID | 要件 | 検証 |
| --- | --- | --- |
| NFR-PERF-1 | タイムライン取得の p95 ≤ 300 ms | load |
| NFR-PERF-2 | 投稿作成の p95 ≤ 500 ms(配信は非同期) | load |
| NFR-PERF-3 | 一覧取得はカーソル方式でページングし、件数の上限を持つ。上限のないクエリを書かない | review |
| NFR-PERF-4 | N+1 クエリを作らない。ループ内で DB を呼ばない | review |
| NFR-PERF-5 | よく使うクエリに対応するインデックスがある。マイグレーションと同じ PR で追加する | review |
| NFR-PERF-6 | 計算量がフォロー数やフォロワー数に比例する処理を同期リクエスト内で行わない | review |

## REL 信頼性

| ID | 要件 | 検証 |
| --- | --- | --- |
| NFR-REL-1 | 可用性の目標: 月間 99.9% | ops |
| NFR-REL-2 | 外部呼び出しすべてにタイムアウトを設定する。リトライには上限とバックオフを設ける | review |
| NFR-REL-3 | 再送され得る書き込みを冪等にする(投稿作成、いいね、フォロー) | review, test |
| NFR-REL-4 | 非同期ジョブは冪等で、失敗時に再実行でき、死活を監視できる | review |
| NFR-REL-5 | 依存サービスの障害時は可能な範囲で縮退する。部分的な障害で全体を止めない | review |
| NFR-REL-6 | SIGTERM で処理中のリクエストを完了してから終了する | test |
| NFR-REL-7 | 目標復旧: RPO 1 時間、RTO 4 時間。復元手順を訓練する | ops |

## OBS 可観測性

| ID | 要件 | 検証 |
| --- | --- | --- |
| NFR-OBS-1 | ログは構造化(JSON)する。`putStrLn` や `console.log` を使わない | CI(HLint), review |
| NFR-OBS-2 | リクエストに相関 ID を付け、ログと外部呼び出しに伝播する | review |
| NFR-OBS-3 | 新しいエンドポイントとジョブに、件数・失敗数・所要時間の計測を追加する | review |
| NFR-OBS-4 | エラーログには調査に足りる文脈を含める。ただし NFR-PRIV-1 に従う | review |

## MIG 互換性と移行

| ID | 要件 | 検証 |
| --- | --- | --- |
| NFR-MIG-1 | DB の変更は expand → migrate → contract の順で段階的に行い、新旧のコードが共存できるようにする | review |
| NFR-MIG-2 | 破壊的なマイグレーション(列の削除、型の変更)はリスク区分 C とする | review |
| NFR-MIG-3 | 大きなテーブルへの変更は長時間のロックを取らない | review |
| NFR-MIG-4 | API の破壊的変更はバージョンを分けるか、移行期間を設ける。`contract/` の差分で検出する | CI, review |
| NFR-MIG-5 | フロントエンドとバックエンドのデプロイ順序に依存しない | review |

## ABUSE 不正利用

| ID | 要件 | 検証 |
| --- | --- | --- |
| NFR-ABUSE-1 | 認証、投稿、フォロー、DM にレート制限を設ける | review, test |
| NFR-ABUSE-2 | 投稿の報告と、管理者による対応(非表示、凍結)の経路がある | test |
| NFR-ABUSE-3 | 入力サイズに上限を設ける(本文、添付、リクエスト全体) | review, test |
| NFR-ABUSE-4 | ユーザー入力の URL を取得する処理で SSRF を防ぐ | review |
| NFR-ABUSE-5 | 利用者の存在を推測できる応答の差を作らない(ログイン、パスワード再設定) | review, test |

## WEB フロントエンド

| ID | 要件 | 検証 |
| --- | --- | --- |
| NFR-WEB-1 | Core Web Vitals: LCP ≤ 2.5 s、INP ≤ 200 ms、CLS ≤ 0.1(モバイル、p75) | load |
| NFR-WEB-2 | 初期ロードの JS は圧縮後 200 KB 以下 | review(CI 化予定) |
| NFR-WEB-3 | 通信の失敗と読み込み中の状態を、すべての画面で扱う | review |

## A11Y アクセシビリティ

| ID | 要件 | 検証 |
| --- | --- | --- |
| NFR-A11Y-1 | WCAG 2.2 AA を満たす | review |
| NFR-A11Y-2 | すべての操作をキーボードで行える。フォーカスが見える | review |
| NFR-A11Y-3 | 画像に代替テキストを入力する手段がある | review |
| NFR-A11Y-4 | セマンティックな要素を使う。`div` にクリック処理を付けない | review |

## I18N 国際化

| ID | 要件 | 検証 |
| --- | --- | --- |
| NFR-I18N-1 | 表示文字列をコードに直接書かず、翻訳リソースから読む | review |
| NFR-I18N-2 | 日時は UTC で保存し、表示時に利用者のタイムゾーンへ変換する | review |
| NFR-I18N-3 | 絵文字や結合文字を含む文字列を正しく扱う。文字数の定義を明示する | test |

## LIC ライセンス

| ID | 要件 | 検証 |
| --- | --- | --- |
| NFR-LIC-1 | ネットワーク越しの利用者に、実行中のバージョンに対応するソースの入手先を提示する(AGPL-3.0 第 13 条。[ADR-0006](../adr/0006-project-license.md)) | test, ops |

## 項目の追加

障害やレビューで新しい種類の問題が見つかったら、ここに追加する([AI-11](../conventions/11-ai-native-flow.md))。カテゴリ内の連番を振り、ID は再利用しない。
