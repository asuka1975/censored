module Censored.Domain.LengthSpec (spec) where

import Censored.Domain.Length
import Censored.Domain.TestCounters (ignoringCombining, neverCount)
import Data.Text qualified as T
import Hedgehog (forAll, property, (===))
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Test.Syd
import Test.Syd.Hedgehog ()

limit :: Limit
limit = Limit {limitGraphemes = 20, limitCodePoints = 200}

spec :: Spec
spec = describe "文字数の検査" $ do
  it "書記素が上限ちょうど(20)なら受理する" $
    checkLength T.length limit (T.replicate 20 "a") `shouldBe` Right ()
  it "書記素が上限 + 1(21)なら TooManyGraphemes で拒否する" $
    checkLength T.length limit (T.replicate 21 "a") `shouldBe` Left TooManyGraphemes
  it "コードポイントが上限ちょうど(200)で、書記素が 1 なら受理する" $
    checkLength (const 1) limit (T.replicate 200 "a") `shouldBe` Right ()
  it "コードポイントが上限 + 1(201)なら、書記素が 1 でも TooManyCodePoints で拒否する" $
    checkLength (const 1) limit (T.replicate 201 "a") `shouldBe` Left TooManyCodePoints
  it "コードポイントが上限 + 1 の入力では、数え方の関数を評価せずに TooManyCodePoints で拒否する" $
    checkLength neverCount limit (T.replicate 201 "a") `shouldBe` Left TooManyCodePoints
  it "書記素もコードポイントも超えるときは、コードポイントを先に報告する" $
    checkLength T.length limit (T.replicate 300 "a") `shouldBe` Left TooManyCodePoints
  it "数え方は渡された関数に従う: 見た目 20 文字(コードポイント 40)を受理する" $
    checkLength ignoringCombining limit (T.replicate 20 "e\x0301") `shouldBe` Right ()
  it "数え方は渡された関数に従う: 見た目 21 文字(コードポイント 42)を拒否する" $
    checkLength ignoringCombining limit (T.replicate 21 "e\x0301") `shouldBe` Left TooManyGraphemes
  specify "a を n 個並べた入力は、20 個まで受理し、21〜200 個は書記素の超過、201 個以上はコードポイントの超過になる" $ property $ do
    n <- forAll (Gen.int (Range.linear 0 400))
    let expected
          | n <= 20 = Right ()
          | n <= 200 = Left TooManyGraphemes
          | otherwise = Left TooManyCodePoints
    checkLength T.length limit (T.replicate n "a") === expected
