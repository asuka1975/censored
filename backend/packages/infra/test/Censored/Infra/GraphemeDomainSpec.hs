module Censored.Infra.GraphemeDomainSpec (spec) where

import Censored.Domain.Candidates (CandidatesError (..), candidateList, mkCandidates)
import Censored.Domain.Length (LengthError (..))
import Censored.Domain.PostBody (PostBodyError (..), mkPostBody, postBodyText)
import Censored.Domain.Topic (TopicError (..), mkTopic, topicText)
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
  describe "トピック" $ do
    it "国旗の絵文字 20 個(コードポイント 40)を受理する" $
      fmap topicText (mkTopic graphemeCount (T.replicate 20 flag)) `shouldBe` Right (T.replicate 20 flag)
    it "国旗の絵文字 21 個(コードポイント 42)を拒否する" $
      fmap topicText (mkTopic graphemeCount (T.replicate 21 flag))
        `shouldBe` Left (TopicTooLong TooManyGraphemes)
    it "e と結合アクセント記号の組 20 個(コードポイント 40)を受理する" $
      fmap topicText (mkTopic graphemeCount (T.replicate 20 accentedE))
        `shouldBe` Right (T.replicate 20 accentedE)
    it "e と結合アクセント記号の組 21 個を拒否する" $
      fmap topicText (mkTopic graphemeCount (T.replicate 21 accentedE))
        `shouldBe` Left (TopicTooLong TooManyGraphemes)
    it "a に結合記号を 200 個続けた入力(書記素 1、コードポイント 201)のトピックを拒否する" $
      fmap topicText (mkTopic graphemeCount ("a" <> T.replicate 200 "\x0301"))
        `shouldBe` Left (TopicTooLong TooManyCodePoints)
  describe "投稿の本文" $ do
    it "国旗の絵文字 140 個(コードポイント 280)を受理する" $
      fmap postBodyText (mkPostBody graphemeCount (T.replicate 140 flag))
        `shouldBe` Right (T.replicate 140 flag)
    it "国旗の絵文字 141 個を拒否する" $
      fmap postBodyText (mkPostBody graphemeCount (T.replicate 141 flag))
        `shouldBe` Left (PostBodyTooLong TooManyGraphemes)
    it "a に結合記号を 1400 個続けた入力(書記素 1、コードポイント 1401)の本文を拒否する" $
      fmap postBodyText (mkPostBody graphemeCount ("a" <> T.replicate 1400 "\x0301"))
        `shouldBe` Left (PostBodyTooLong TooManyCodePoints)
  describe "候補の組" $ do
    it "国旗の絵文字 140 個の候補 3 つを受理する" $
      fmap
        (map postBodyText . candidateList)
        (mkCandidates graphemeCount (replicate 3 (T.replicate 140 flag)))
        `shouldBe` Right (replicate 3 (T.replicate 140 flag))
    it "国旗の絵文字 141 個の候補を含むとき、その位置を示して拒否する" $
      fmap
        (map postBodyText . candidateList)
        (mkCandidates graphemeCount ["a", T.replicate 141 flag, "c"])
        `shouldBe` Left (InvalidCandidate 1 (PostBodyTooLong TooManyGraphemes))
