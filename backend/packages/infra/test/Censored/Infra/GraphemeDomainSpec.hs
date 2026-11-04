module Censored.Infra.GraphemeDomainSpec (spec) where

import Censored.Domain.Length (LengthError (..))
import Censored.Domain.PostBody (PostBodyError (..), mkPostBody, postBodyText)
import Censored.Infra.Grapheme (graphemeCount)
import Data.Text (Text)
import Data.Text qualified as T
import Test.Syd

flag :: Text
flag = "\x1F1EF\x1F1F5"

accentedE :: Text
accentedE = "e\x0301"

spec :: Spec
spec = describe "ドメインの検証に実際の書記素の数え方を渡す" $ do
  describe "投稿の本文" $ do
    it "国旗の絵文字 140 個(コードポイント 280)を受理する" $
      fmap postBodyText (mkPostBody graphemeCount (T.replicate 140 flag))
        `shouldBe` Right (T.replicate 140 flag)
    it "国旗の絵文字 141 個を拒否する" $
      fmap postBodyText (mkPostBody graphemeCount (T.replicate 141 flag))
        `shouldBe` Left (PostBodyTooLong TooManyGraphemes)
    it "e と結合アクセント記号の組 140 個(コードポイント 280)を受理する" $
      fmap postBodyText (mkPostBody graphemeCount (T.replicate 140 accentedE))
        `shouldBe` Right (T.replicate 140 accentedE)
    it "e と結合アクセント記号の組 141 個を拒否する" $
      fmap postBodyText (mkPostBody graphemeCount (T.replicate 141 accentedE))
        `shouldBe` Left (PostBodyTooLong TooManyGraphemes)
    it "a に結合記号を 1400 個続けた入力(書記素 1、コードポイント 1401)の本文を拒否する" $
      fmap postBodyText (mkPostBody graphemeCount ("a" <> T.replicate 1400 "\x0301"))
        `shouldBe` Left (PostBodyTooLong TooManyCodePoints)
