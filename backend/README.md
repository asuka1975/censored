# backend

層の定義は [ディレクトリ構成](../docs/conventions/01-directory-structure.md)。

## パッケージの雛形

`packages/<layer>/censored-<layer>.cabal`。`domain` を例にする。

```cabal
cabal-version: 3.8
name: censored-domain
version: 0.1.0.0
license: AGPL-3.0-or-later
copyright: 2026 asuka1975
build-type: Simple

-- ミューテーション計測用。通常のビルドでは無効(TQ-M8)。
flag mutation
  default: False
  manual: True

common defaults
  default-language: GHC2021
  default-extensions:
    DerivingStrategies
    OverloadedStrings

library
  import: defaults
  hs-source-dirs: src
  exposed-modules:
    Censored.Domain.Post
  build-depends:
    , base
    , text
  if flag(mutation)
    build-depends:
      , sydtest-mutation-plugin
      , sydtest-mutation-runtime
    ghc-options:
      -fplugin=Test.Syd.Mutation.Plugin
      -plugin-package=sydtest-mutation-plugin
      -package=sydtest-mutation-plugin

test-suite censored-domain-spec
  import: defaults
  type: exitcode-stdio-1.0
  hs-source-dirs: test
  main-is: Spec.hs
  other-modules:
    Censored.Domain.PostSpec
  build-tool-depends: sydtest-discover:sydtest-discover
  build-depends:
    , base
    , censored-domain
    , hedgehog
    , sydtest
    , sydtest-hedgehog
    , text
  ghc-options: -threaded -rtsopts -with-rtsopts=-N
  if flag(mutation)
    build-depends: sydtest-mutation-runtime
```

- 計測対象に依存するパッケージのテストスイートには、すべて `if flag(mutation)` の `sydtest-mutation-runtime` が必要(ないとリンクに失敗する)。計測対象でないパッケージには、`library` の plugin の節は要らないが `flag mutation` は定義する。
- 警告の設定は [cabal.project](cabal.project) に集約しているので、`.cabal` に書かない。

`test/Spec.hs`:

```haskell
{-# OPTIONS_GHC -F -pgmF sydtest-discover #-}
```

## テストの例

```haskell
module Censored.Domain.PostSpec (spec) where

import Censored.Domain.Post
import Data.Text qualified as T
import Hedgehog (forAll, property, (===))
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Test.Syd
import Test.Syd.Hedgehog ()

spec :: Spec
spec = describe "投稿本文" $ do
  it "501文字の本文を拒否する" $
    mkPostBody (T.replicate 501 "a") `shouldBe` Left (TooLong 501)
  it "500文字ちょうどの本文を受理する" $
    (unPostBody <$> mkPostBody (T.replicate 500 "a")) `shouldBe` Right (T.replicate 500 "a")
  specify "受理された本文は前後の空白を含まない" $ property $ do
    s <- forAll (Gen.text (Range.linear 1 400) Gen.alphaNum)
    fmap unPostBody (mkPostBody (" " <> s <> " ")) === Right s
```

## 依存を追加したら

```bash
make freeze
```

`cabal.project.freeze` と [tools/policy/dependencies.json](../tools/policy/dependencies.json) をコミットする。
