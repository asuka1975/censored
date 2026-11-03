module Censored.Domain.PostBodySpec (spec) where

import Censored.Domain.Length (LengthError (..))
import Censored.Domain.PostBody
import Censored.Domain.TestCounters (ignoringCombining, neverCount)
import Data.Text (Text)
import Data.Text qualified as T
import Hedgehog (forAll, property, (===))
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Test.Syd
import Test.Syd.Hedgehog ()

bodyOf :: Text -> Either PostBodyError Text
bodyOf = fmap postBodyText . mkPostBody T.length

spec :: Spec
spec = describe "投稿の本文" $ do
  it "140 文字ちょうどの本文を受理する" $
    bodyOf (T.replicate 140 "あ") `shouldBe` Right (T.replicate 140 "あ")
  it "141 文字の本文を拒否する" $
    bodyOf (T.replicate 141 "あ") `shouldBe` Left (PostBodyTooLong TooManyGraphemes)
  it "1 文字の本文を受理する" $
    bodyOf "あ" `shouldBe` Right "あ"
  it "空の本文を拒否する" $
    bodyOf "" `shouldBe` Left PostBodyEmpty
  it "空白と改行だけの本文を拒否する" $
    bodyOf " \x3000\t\n\r" `shouldBe` Left PostBodyEmpty
  it "前後の空白や改行を含む本文を、そのまま保持する(手直ししない)" $
    bodyOf "\n  こんにちは \n" `shouldBe` Right "\n  こんにちは \n"
  it "前後の空白も文字数に数える(140 文字 + 空白 1 つを拒否する)" $
    bodyOf (T.replicate 140 "あ" <> " ") `shouldBe` Left (PostBodyTooLong TooManyGraphemes)
  it "書記素が 140 以下でも、コードポイントが 1401 の本文を拒否する" $
    fmap postBodyText (mkPostBody (const 1) (T.replicate 1401 "a"))
      `shouldBe` Left (PostBodyTooLong TooManyCodePoints)
  it "コードポイントが 1401 の本文は、数え方の関数を評価せずに拒否する" $
    fmap postBodyText (mkPostBody neverCount (T.replicate 1401 "a"))
      `shouldBe` Left (PostBodyTooLong TooManyCodePoints)
  it "NEL(U+0085)と行区切り(U+2028)と段落区切り(U+2029)だけの本文を拒否する" $
    bodyOf "\x85\x2028\x2029" `shouldBe` Left PostBodyEmpty
  it "書記素が 140 以下で、コードポイントが 1400 の本文を受理する" $
    fmap postBodyText (mkPostBody (const 1) (T.replicate 1400 "a"))
      `shouldBe` Right (T.replicate 1400 "a")
  it "渡された数え方で、見た目 140 文字(コードポイント 280)の本文を受理する" $
    fmap postBodyText (mkPostBody ignoringCombining (T.replicate 140 "e\x0301"))
      `shouldBe` Right (T.replicate 140 "e\x0301")
  it "渡された数え方で、見た目 141 文字(コードポイント 282)の本文を拒否する" $
    fmap postBodyText (mkPostBody ignoringCombining (T.replicate 141 "e\x0301"))
      `shouldBe` Left (PostBodyTooLong TooManyGraphemes)
  specify "英数字だけの 140 文字以下の本文は、そのまま受理される" $ property $ do
    body <- forAll (Gen.text (Range.linear 1 140) Gen.alphaNum)
    bodyOf body === Right body
