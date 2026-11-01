---
title: ディレクトリ構成
owner: asuka1975
status: living
last_reviewed: 2026-11-02
---

# ディレクトリ構成

判断の根拠は [ADR-0002](../adr/0002-monorepo-and-package-boundaries.md)。

## 全体

```text
.
├── AGENTS.md              AI と人の作業入口(200 行以内)
├── CLAUDE.md              AGENTS.md を読み込むだけ
├── Makefile               全検査の唯一の入口
├── backend/               Haskell
│   ├── cabal.project      コンパイラ・index-state・警告方針の正本
│   ├── cabal.project.freeze
│   ├── cabal.project.mutation
│   ├── migrations/        DB マイグレーション
│   └── packages/<layer>/  層ごとに 1 パッケージ
├── frontend/              PureScript
│   ├── spago.yaml         package set の正本
│   ├── spago.lock
│   ├── tools/             テスト実行スクリプト
│   └── packages/<layer>/  層ごとに 1 パッケージ
├── contract/              API 契約(バックエンドが生成、両者が検証)
├── docs/                  文書(docs/README.md が索引)
├── tools/
│   ├── gates/             ゲートの実装とそのテスト
│   ├── policy/            閾値・層・許可リスト(判断の値)
│   └── versions.env       ツールの版の正本
├── .claude/               レビュアーとスキル
└── .github/               CI、PR テンプレート、CODEOWNERS
```

## バックエンドの層

依存は上から下へのみ。**import の制限ではなくパッケージ境界で強制する**ので、規則を破るとコンパイルが通らない。

| 層 | パッケージ | 責務 | 依存してよい内部パッケージ |
| --- | --- | --- | --- |
| domain | `censored-domain` | ビジネスルール。純粋関数のみ | なし |
| application | `censored-application` | ユースケースと Port(外部依存の抽象) | domain |
| contract | `censored-contract` | API の型と JSON 表現 | domain |
| infra | `censored-infra` | Port の実装(DB、ストレージ、配信) | domain, application |
| server | `censored-server` | HTTP ハンドラと実行ファイル(結線) | すべて |
| testkit | `censored-testkit` | テスト用ジェネレータとフェイク | domain, application |

### 1 パッケージの形

```text
backend/packages/domain/
├── censored-domain.cabal
├── src/Censored/Domain/Post.hs
└── test/
    ├── Spec.hs                      sydtest-discover
    └── Censored/Domain/PostSpec.hs  src と同じ階層に *Spec
```

.cabal の雛形は [backend/README.md](../../backend/README.md)。

## フロントエンドの層

| 層 | パッケージ | 責務 | 依存してよい内部パッケージ |
| --- | --- | --- | --- |
| core | `censored-core` | 表示に依存しないロジック。`Effect` 禁止 | なし |
| api-client | `censored-api-client` | 生成された API 型と HTTP 呼び出し | core |
| ui | `censored-ui` | コンポーネント | core |
| app | `censored-app` | エントリポイントとルーティング(結線) | すべて |

```text
frontend/packages/core/
├── spago.yaml
├── src/Censored/Core/PostBody.purs
└── test/Test/Censored/Core/
    ├── Main.purs                   テストの起点(モジュール名固定)
    └── PostBodySpec.purs
```

雛形は [frontend/README.md](../../frontend/README.md)。

## API 契約

```text
contract/
├── openapi.json                生成物
└── fixtures/<Type>/<case>.json 代表値の JSON
```

バックエンドのテストが fixture を生成して固定し、フロントエンドのテストがそれをデコードする。詳細は [contract/README.md](../../contract/README.md)。

## 規則

| ID | 規則 | 検査 |
| --- | --- | --- |
| DIR-1 | トップレベルのディレクトリは上の表にあるものだけ。追加は ADR | レビュー |
| DIR-2 | パッケージはディレクトリ名 `<layer>`、パッケージ名 `censored-<layer>`。未定義の層は作らない | `check-layers` |
| DIR-3 | 依存方向は上の表の通り。domain は外部依存も許可リスト制、core は `Effect` 禁止。library と executable の両方に適用し、ビルド後は条件節を解決した `plan.json` でも検査する | `check-layers`(`--plan`)、`check-source`、コンパイラ |
| DIR-4 | Haskell のテストスイート名は `censored-<layer>-spec`、PureScript のテスト起点は `Test.Censored.<Layer>.Main` | `check-layers` |
| DIR-5 | 生成コードは `Generated/` 以下に置く。手で編集しない | `check-source` が対象外にする |
| DIR-6 | 1 モジュールの責務は 1 つ。`Utils`、`Common`、`Helpers` という名前のモジュールを作らない | レビュー |

### DIR-4 の理由

`sydtest-mutation-driver` は複数パッケージに同名のスイートがあると `DuplicateSuiteName` で停止する。PureScript 側は `frontend/tools/run-tests.mjs` がモジュール名でテストを発見する。
