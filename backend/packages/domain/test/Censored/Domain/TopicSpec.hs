module Censored.Domain.TopicSpec (spec) where

import Censored.Domain.Length (LengthError (..))
import Censored.Domain.TestCounters (ignoringCombining, neverCount)
import Censored.Domain.Topic
import Data.Text (Text)
import Data.Text qualified as T
import Hedgehog (forAll, property, (===))
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Test.Syd
import Test.Syd.Hedgehog ()

topicOf :: Text -> Either TopicError Text
topicOf = fmap topicText . mkTopic T.length

spec :: Spec
spec = describe "トピック" $ do
  it "20 文字ちょうどのトピックを受理する" $
    topicOf (T.replicate 20 "あ") `shouldBe` Right (T.replicate 20 "あ")
  it "21 文字のトピックを拒否する" $
    topicOf (T.replicate 21 "あ") `shouldBe` Left (TopicTooLong TooManyGraphemes)
  it "1 文字のトピックを受理する" $
    topicOf "あ" `shouldBe` Right "あ"
  it "空のトピックを拒否する" $
    topicOf "" `shouldBe` Left TopicEmpty
  it "半角空白だけのトピックを拒否する" $
    topicOf "   " `shouldBe` Left TopicEmpty
  it "全角空白、タブ、改行だけのトピックを拒否する" $
    topicOf "\x3000\t\n\r" `shouldBe` Left TopicEmpty
  it "前後の空白を保持しない" $
    topicOf " \x3000あいう\n " `shouldBe` Right "あいう"
  it "前後の空白を文字数に数えない(20 文字の前後に空白があっても受理する)" $
    topicOf ("  " <> T.replicate 20 "あ" <> "\n") `shouldBe` Right (T.replicate 20 "あ")
  it "内側の空白は保持し、文字数に数える" $
    topicOf "あ い" `shouldBe` Right "あ い"
  it "書記素が 20 以下でも、コードポイントが 201 のトピックを拒否する" $
    fmap topicText (mkTopic (const 1) (T.replicate 201 "a"))
      `shouldBe` Left (TopicTooLong TooManyCodePoints)
  it "書記素が 20 以下で、コードポイントが 200 のトピックを受理する" $
    fmap topicText (mkTopic (const 1) (T.replicate 200 "a")) `shouldBe` Right (T.replicate 200 "a")
  it "コードポイントが 201 のトピックは、数え方の関数を評価せずに拒否する" $
    fmap topicText (mkTopic neverCount (T.replicate 201 "a"))
      `shouldBe` Left (TopicTooLong TooManyCodePoints)
  it "NEL(U+0085)と行区切り(U+2028)と段落区切り(U+2029)だけのトピックを拒否する" $
    topicOf "\x85\x2028\x2029" `shouldBe` Left TopicEmpty
  it "前後の NEL と行区切りと段落区切りを保持しない" $
    topicOf "\x85\x2028あ\x2029" `shouldBe` Right "あ"
  it "ゼロ幅スペース(U+200B)は空白として扱わない" $
    topicOf "\x200B" `shouldBe` Right "\x200B"
  it "コードポイントの上限は、前後の空白を除いた長さで判定する" $
    fmap
      topicText
      (mkTopic (const 1) (T.replicate 100 " " <> T.replicate 200 "a" <> T.replicate 100 " "))
      `shouldBe` Right (T.replicate 200 "a")
  it "渡された数え方で、見た目 20 文字(コードポイント 40)のトピックを受理する" $
    fmap topicText (mkTopic ignoringCombining (T.replicate 20 "e\x0301"))
      `shouldBe` Right (T.replicate 20 "e\x0301")
  it "渡された数え方で、見た目 21 文字(コードポイント 42)のトピックを拒否する" $
    fmap topicText (mkTopic ignoringCombining (T.replicate 21 "e\x0301"))
      `shouldBe` Left (TopicTooLong TooManyGraphemes)
  specify "受理されたトピックは、空でなく、前後の空白を含まない" $ property $ do
    body <- forAll (Gen.text (Range.linear 1 20) Gen.alphaNum)
    pad <- forAll (Gen.text (Range.linear 0 5) (Gen.element [' ', '\t', '\n', '\x3000']))
    topicOf (pad <> body <> pad) === Right body
