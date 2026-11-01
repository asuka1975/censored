# frontend

層の定義は [ディレクトリ構成](../docs/conventions/01-directory-structure.md)。

## パッケージの雛形

`packages/<layer>/spago.yaml`。`core` を例にする。

```yaml
package:
  name: censored-core
  dependencies:
    - either
    - prelude
    - strings
  build:
    strict: true
    pedanticPackages: true
  test:
    main: Test.Censored.Core.Main
    strict: true
    pedanticPackages: true
    dependencies:
      - effect
      - spec
      - spec-node
```

名前の形式(`censored-<layer>`、`Test.Censored.<Layer>.Main`)は `check-layers` が検査する。`frontend/tools/run-tests.mjs` はこのモジュール名でテストを発見する。

## テストの例

```purescript
module Test.Censored.Core.Main (main) where

import Prelude

import Censored.Core.PostBody (PostBodyError(..), mkPostBody)
import Data.Either (Either(..))
import Effect (Effect)
import Test.Spec (describe, it)
import Test.Spec.Assertions (shouldEqual)
import Test.Spec.Reporter (consoleReporter)
import Test.Spec.Runner.Node (runSpecAndExitProcess)

main :: Effect Unit
main = runSpecAndExitProcess [ consoleReporter ] do
  describe "投稿本文" do
    it "空白のみの本文を拒否する" do
      mkPostBody "   " `shouldEqual` Left Empty
```

## 注意

`where` は最後のガードにしか束縛されない。複数のガードで共有する値は `let` で書く。

依存を追加したら `spago.lock` と [tools/policy/dependencies.json](../tools/policy/dependencies.json) をコミットする。

不必要な二次的なラベルや説明は避る。レイアウトだけで意味が伝わるようにする。
