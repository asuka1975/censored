---
title: テストカバレッジ
owner: asuka1975
status: living
last_reviewed: 2026-11-02
---

# テストカバレッジ

カバレッジは **テストされていない場所を見つける道具** であり、テストの良さは測らない。良さは[テスト品質ゲート](05-test-quality-gate.md)のミューテーションで測る。判断の根拠は [ADR-0005](../adr/0005-coverage-measurement.md)。

## 規則

| ID | 規則 | 検査 |
| --- | --- | --- |
| COV-1 | 層ごとに行カバレッジの下限を満たす | `check-coverage` |
| COV-2 | `src/` の全モジュールがテストから読み込まれている | `check-coverage` |
| COV-3 | PR の変更行の 90% 以上がテストで実行される | `check-coverage --base` |
| COV-4 | 計測からの除外は `tools/policy/coverage.json` でのみ行う。行単位の除外コメントは作らない | CODEOWNERS |
| COV-5 | 下限を下げる PR は製品コードと分け、理由を PR に書く | `check-pr`(AI-8) |

## 下限

値の正本は [tools/policy/coverage.json](../../tools/policy/coverage.json)。初期値であり、実績を見て調整する。

| 層 | 下限 | 理由 |
| --- | --- | --- |
| backend domain | 95% | 純粋で、テストしやすく、誤りの影響が大きい |
| backend application | 90% | Port をフェイクにすれば IO なしで試せる |
| backend contract | 85% | ほぼ型定義と変換。fixture で通る |
| backend infra | 70% | 実 DB を要する統合テストが中心 |
| backend server | 60% | 結線が中心 |
| frontend core | 95% | domain と同じ |
| frontend api-client | 80% | 生成コードを除く |
| frontend ui | 70% | 描画の詳細を追わない |
| frontend app | 40% | 結線が中心 |

`testkit` はテスト支援なので計測しない。

## 計測方法

```text
Haskell     cabal test --enable-coverage → .tix を hpc sum で統合 → hpc-codecov で LCOV → check-coverage
PureScript  NODE_V8_COVERAGE で実行 → ps-coverage がソースマップで PS の行に射影 → LCOV → check-coverage
```

`make coverage` がすべて実行する。単位はどちらも **行** に統一する。

### 計測の落とし穴

検証で実際に遭遇し、規約に組み込んだもの。

| 落とし穴 | 何が起きるか | 対策 |
| --- | --- | --- |
| c8 / v8-to-istanbul を purs の出力に使う | **呼ばれていない関数があっても 100% と報告する** | c8 を使わず、V8 の生データを `ps-coverage` で射影する |
| テストが読み込まないモジュール | hpc にも V8 にも現れず、未計測のモジュールほど合格する | `COV-2` で `src/` の全ファイルを突き合わせる |
| 実行行のないモジュール | 定数だけのモジュールは読み込まれても実行行が 0、型だけのモジュールは読み込まれない | 読み込みの有無と実行行を分けて扱い、出力に実行コードがないモジュールは `COV-2` の対象にしない |
| 生成されるコード | `deriving stock` や PureScript の `newtype` の行が 0 回として数えられる | `ignoreLinePatterns` で分母から除く |
| 他パッケージのテストによる実行 | パッケージ単位の hpc レポートでは数えられない | `hpc sum --union` で統合してから判定する |
| 古い `.tix` | 別の実行の結果が混ざる | `make test-hs` が実行前に削除する |

## 使い方

下限を下回ったら、テストを足す前に次を確認する。

1. そのコードは本当に要るか(不要なら消す)
2. 型で不正な状態を消せないか(消せばテストが要らない)
3. それでも残るなら、振る舞いのテストを書く

**数字を上げるためだけのテストを書かない。** アサーションのないテストや実装をなぞるテストはカバレッジを上げるが、ミューテーションで検出される。
