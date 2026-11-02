module Censored.Domain.GraphemeSpec (spec) where

import Censored.Domain.Grapheme (graphemeCount)
import Data.Text (Text)
import Data.Text qualified as T
import Hedgehog (forAll, property, (===))
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Test.Syd
import Test.Syd.Hedgehog ()

flag :: Text
flag = "\x1F1EF\x1F1F5"

spec :: Spec
spec = describe "書記素の数" $ do
  it "空の文字列を 0 文字と数える" $
    graphemeCount "" `shouldBe` 0
  it "a を 1 文字と数える" $
    graphemeCount "a" `shouldBe` 1
  it "あ を 1 文字と数える" $
    graphemeCount "あ" `shouldBe` 1
  it "国旗の絵文字(地域指示記号 2 つ)を 1 文字と数える" $
    graphemeCount flag `shouldBe` 1
  it "家族の絵文字(ゼロ幅接合子で結んだ 3 つの絵文字)を 1 文字と数える" $
    graphemeCount "\x1F468\x200D\x1F469\x200D\x1F467" `shouldBe` 1
  it "家族の絵文字(ゼロ幅接合子で結んだ 4 つの絵文字)を 1 文字と数える" $
    graphemeCount "\x1F468\x200D\x1F469\x200D\x1F467\x200D\x1F466" `shouldBe` 1
  it "e と結合アクセント記号 U+0301 の組を 1 文字と数える" $
    graphemeCount "e\x0301" `shouldBe` 1
  specify "英数字だけの文字列は、コードポイントの数と同じ数に数える" $ property $ do
    s <- forAll (Gen.text (Range.linear 0 200) Gen.alphaNum)
    graphemeCount s === T.length s
  specify "国旗 n 個の並びは n 文字と数える" $ property $ do
    n <- forAll (Gen.int (Range.linear 0 50))
    graphemeCount (T.replicate n flag) === n
