# contract

バックエンドとフロントエンドの API 契約の生成物を置く。方針は [ADR-0007](../docs/adr/0007-api-contract.md)。**手で編集しない。**

```text
contract/
├── openapi.json                censored-contract から生成
└── fixtures/<Type>/<case>.json 代表値の JSON
```

## 仕組み

1. `censored-contract` のテストが、代表値を JSON にして `fixtures/` と比較する(golden テスト)。
2. `censored-api-client` のテストが、同じ `fixtures/` をデコードする。
3. CI の `make contract-check` が、生成物とコミットの不一致を検出する。

表現を変えると、片方または両方のテストが落ちる。

## 変更の手順

意図した変更なら、テストの更新機能で fixture を書き換え、**差分を確認してから** コミットする。fixture の差分は API の破壊的変更そのものなので、レビューの中心になる(NFR-MIG-4)。
