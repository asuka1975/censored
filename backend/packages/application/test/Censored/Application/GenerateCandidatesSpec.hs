module Censored.Application.GenerateCandidatesSpec (spec) where

import Censored.Application.GenerateCandidates
import Censored.Application.Port (CandidateGenerator, GeneratorError (..))
import Censored.Application.TestFakes
import Censored.Domain.CandidateSet
  ( CandidateSet
  , Purpose (..)
  , SetState (..)
  , candidateSetCandidates
  , candidateSetId
  , candidateSetOwner
  , candidateSetPurpose
  , candidateSetState
  )
import Censored.Domain.Candidates (CandidatesError (..), candidateList)
import Censored.Domain.Id (PostId (..), UserId (..))
import Censored.Domain.Length (GraphemeCounter, LengthError (..))
import Censored.Domain.Post (Post (..))
import Censored.Domain.PostBody (PostBody, PostBodyError (..), mkPostBody, postBodyText)
import Censored.Domain.Topic (TopicError (..))
import Data.Maybe (catMaybes)
import Data.Text (Text)
import Data.Text qualified as T
import Data.UUID.Types (fromWords)
import Hedgehog (Gen, evalIO, forAll, property, (===))
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Test.Syd
import Test.Syd.Hedgehog ()

user :: UserId
user = UserId (fromWords 0 0 0 1)

target :: PostId
target = PostId (fromWords 9 0 0 1)

unknownTarget :: PostId
unknownTarget = PostId (fromWords 9 0 0 2)

-- | 本文を検証して取り出す。見本の本文は正しいので、失敗は書き間違い。
bodyOf :: Text -> Maybe PostBody
bodyOf = either (const Nothing) Just . mkPostBody T.length

-- | 返信される側の投稿。本文は「元の投稿」。
targetPost :: Maybe Post
targetPost = do
  body <- bodyOf "元の投稿"
  pure
    Post
      { postId = target
      , postAuthor = UserId (fromWords 0 0 0 2)
      , postBody = body
      , postReplyTo = Nothing
      }

-- | 返信への返信を確かめるための、返信である投稿。
replyPost :: Maybe Post
replyPost = do
  body <- bodyOf "返信の投稿"
  pure
    Post
      { postId = unknownTarget
      , postAuthor = UserId (fromWords 0 0 0 2)
      , postBody = body
      , postReplyTo = Just target
      }

topicInput :: Text -> GenerateInput
topicInput topic = GenerateInput {inputTopic = topic, inputReplyTo = Nothing}

replyInput :: Text -> PostId -> GenerateInput
replyInput topic to = GenerateInput {inputTopic = topic, inputReplyTo = Just to}

texts :: CandidateSet -> [Text]
texts = map postBodyText . candidateList . candidateSetCandidates

-- | 数え方と AI を差し替えた環境で、候補の生成を実行する。結果と、保存された候補の組を返す。
run
  :: GraphemeCounter
  -> CandidateGenerator
  -> GenerateInput
  -> IO (Either GenerateError CandidateSet, [CandidateSet])
run counter generator generateInput = do
  fakes <- newFakes counter generator
  mapM_ (fakesSeedPost fakes) (catMaybes [targetPost, replyPost])
  result <- generateCandidateSet (fakesEnv fakes) user generateInput
  stored <- fakesStoredSets fakes
  pure (result, stored)

-- | 空白だけではない 1〜140 文字の本文。前後に空白や改行が付くことがある。
candidateBody :: Gen Text
candidateBody = do
  core <- Gen.text (Range.linear 1 100) (Gen.choice [Gen.alphaNum, Gen.element ("あいう漢字" :: String)])
  lead <- Gen.text (Range.linear 0 20) (Gen.element (" \n\t\x3000" :: String))
  trail <- Gen.text (Range.linear 0 20) (Gen.element (" \n\t\x3000" :: String))
  pure (lead <> core <> trail)

threeCandidates :: CandidateGenerator
threeCandidates = scripted (Right ["一つ目", "二つ目", "三つ目"])

spec :: Spec
spec = describe "候補の生成" $ do
  describe "有効なトピック" $ do
    it "AI が返した 3 つの候補を、順序を保った組にする" $ do
      (result, _) <- run T.length threeCandidates (topicInput "こんにちは")
      fmap texts result `shouldBe` Right ["一つ目", "二つ目", "三つ目"]
    it "作った組は、依頼した利用者のもので、新規投稿の組として、まだ選ばれていない" $ do
      (result, _) <- run T.length threeCandidates (topicInput "こんにちは")
      case result of
        Right set -> do
          candidateSetOwner set `shouldBe` user
          candidateSetPurpose set `shouldBe` NewPost
          candidateSetState set `shouldBe` Open
        Left err -> expectationFailure ("候補の生成に失敗した: " <> show err)
    it "作った組を保存する" $ do
      (result, stored) <- run T.length threeCandidates (topicInput "こんにちは")
      fmap pure result `shouldBe` Right stored
    it "AI に渡るトピックは、前後の空白を除いたもの" $ do
      (result, _) <- run T.length echoing (topicInput "  こんにちは \n")
      fmap (take 1 . texts) result `shouldBe` Right ["トピック:こんにちは"]
    it "20 文字ちょうどのトピックを受理する" $ do
      (result, _) <- run T.length threeCandidates (topicInput (T.replicate 20 "あ"))
      fmap texts result `shouldBe` Right ["一つ目", "二つ目", "三つ目"]
    it "2 回生成すると、別々の識別子の組が 2 つ保存される" $ do
      fakes <- newFakes T.length threeCandidates
      first <- generateCandidateSet (fakesEnv fakes) user (topicInput "一回目")
      second <- generateCandidateSet (fakesEnv fakes) user (topicInput "二回目")
      stored <- fakesStoredSets fakes
      length stored `shouldBe` 2
      fmap candidateSetId first `shouldNotBe` fmap candidateSetId second
    it "前後に空白や改行を持つ候補は、削らずにそのまま組にする" $ do
      (result, _) <- run T.length (scripted (Right [" 一つ目\n", "\x3000二つ目", "三つ目 "])) (topicInput "題")
      fmap texts result `shouldBe` Right [" 一つ目\n", "\x3000二つ目", "三つ目 "]
    it "140 文字の候補に空白が 1 文字続いて 141 文字になるとき、その位置を示して失敗にする" $ do
      (result, stored) <-
        run T.length (scripted (Right ["一", "二", T.replicate 140 "あ" <> " "])) (topicInput "題")
      (result, stored)
        `shouldBe` (Left (InvalidCandidates (InvalidCandidate 2 (PostBodyTooLong TooManyGraphemes))), [])
    specify "AI が返した有効な 3 つの候補は、前後の空白や非 ASCII を含んでも、そのまま組になる" $ property $ do
      bodies <- forAll (Gen.list (Range.singleton 3) candidateBody)
      (result, _) <- evalIO (run T.length (scripted (Right bodies)) (topicInput "題"))
      fmap texts result === Right bodies
  describe "不正なトピック(AI を呼ばず、何も保存しない)" $ do
    it "21 文字のトピックを拒否する" $ do
      (result, stored) <- run T.length neverCalled (topicInput (T.replicate 21 "あ"))
      (result, stored) `shouldBe` (Left (InvalidTopic (TopicTooLong TooManyGraphemes)), [])
    it "空のトピックを拒否する" $ do
      (result, stored) <- run T.length neverCalled (topicInput "")
      (result, stored) `shouldBe` (Left (InvalidTopic TopicEmpty), [])
    it "空白だけのトピックを拒否する" $ do
      (result, stored) <- run T.length neverCalled (topicInput " \x3000\n")
      (result, stored) `shouldBe` (Left (InvalidTopic TopicEmpty), [])
    it "書記素が 20 以下でも、コードポイントが 201 のトピックを拒否する" $ do
      (result, stored) <- run (const 1) neverCalled (topicInput (T.replicate 201 "a"))
      (result, stored) `shouldBe` (Left (InvalidTopic (TopicTooLong TooManyCodePoints)), [])
  describe "書記素の数え方" $ do
    it "トピックには、環境に渡された数え方を使う(1 文字と数える数え方なら 21 文字でも受理する)" $ do
      (result, _) <- run (const 1) threeCandidates (topicInput (T.replicate 21 "あ"))
      fmap texts result `shouldBe` Right ["一つ目", "二つ目", "三つ目"]
    it "候補には、環境に渡された数え方を使う(1 文字と数える数え方なら 141 文字の候補も受理する)" $ do
      (result, _) <- run (const 1) (scripted (Right ["一", T.replicate 141 "あ", "三"])) (topicInput "題")
      fmap (map T.length . texts) result `shouldBe` Right [1, 141, 1]
  describe "AI の失敗(組は作らず、保存しない)" $ do
    it "AI が使えないとき、候補の生成を失敗にする" $ do
      (result, stored) <- run T.length (scripted (Left GeneratorUnavailable)) (topicInput "題")
      (result, stored) `shouldBe` (Left (GeneratorFailed GeneratorUnavailable), [])
    it "AI がタイムアウトしたとき、候補の生成を失敗にする" $ do
      (result, stored) <- run T.length (scripted (Left GeneratorTimedOut)) (topicInput "題")
      (result, stored) `shouldBe` (Left (GeneratorFailed GeneratorTimedOut), [])
  describe "AI が返した候補が不正(組は作らず、保存しない)" $ do
    it "候補が 2 つのとき、候補の生成を失敗にする" $ do
      (result, stored) <- run T.length (scripted (Right ["一", "二"])) (topicInput "題")
      (result, stored) `shouldBe` (Left (InvalidCandidates (WrongCandidateCount 2)), [])
    it "候補が 4 つのとき、候補の生成を失敗にする" $ do
      (result, stored) <- run T.length (scripted (Right ["一", "二", "三", "四"])) (topicInput "題")
      (result, stored) `shouldBe` (Left (InvalidCandidates (WrongCandidateCount 4)), [])
    it "141 文字の候補を含むとき、その位置を示して失敗にする" $ do
      (result, stored) <- run T.length (scripted (Right ["一", T.replicate 141 "あ", "三"])) (topicInput "題")
      (result, stored)
        `shouldBe` (Left (InvalidCandidates (InvalidCandidate 1 (PostBodyTooLong TooManyGraphemes))), [])
    it "書記素が 140 以下でも、コードポイントが 1401 の候補を含むとき失敗にする" $ do
      (result, stored) <-
        run (const 1) (scripted (Right [T.replicate 1401 "a", "二", "三"])) (topicInput "題")
      (result, stored)
        `shouldBe` (Left (InvalidCandidates (InvalidCandidate 0 (PostBodyTooLong TooManyCodePoints))), [])
    it "空の候補を含むとき、その位置を示して失敗にする" $ do
      (result, stored) <- run T.length (scripted (Right ["一", "二", ""])) (topicInput "題")
      (result, stored) `shouldBe` (Left (InvalidCandidates (InvalidCandidate 2 PostBodyEmpty)), [])
    it "140 文字ちょうどの候補 3 つを受理する" $ do
      (result, _) <- run T.length (scripted (Right (replicate 3 (T.replicate 140 "あ")))) (topicInput "題")
      fmap (map T.length . texts) result `shouldBe` Right [140, 140, 140]
  describe "返信" $ do
    it "返信先の投稿の本文が、AI に渡される" $ do
      (result, _) <- run T.length echoing (replyInput "賛成" target)
      fmap (take 2 . texts) result `shouldBe` Right ["トピック:賛成", "返信先:元の投稿"]
    it "新規投稿のときは、AI に返信先を渡さない" $ do
      (result, _) <- run T.length echoing (topicInput "賛成")
      fmap (take 2 . texts) result `shouldBe` Right ["トピック:賛成", "返信先:なし"]
    it "作った組は、返信先の投稿を指す目的を持つ" $ do
      (result, _) <- run T.length threeCandidates (replyInput "賛成" target)
      fmap candidateSetPurpose result `shouldBe` Right (ReplyTo target)
    it "返信である投稿にも、返信の組を作れる" $ do
      (result, _) <- run T.length echoing (replyInput "同意" unknownTarget)
      (fmap (take 2 . texts) result, fmap candidateSetPurpose result)
        `shouldBe` (Right ["トピック:同意", "返信先:返信の投稿"], Right (ReplyTo unknownTarget))
    it "存在しない投稿への返信は、AI を呼ばず、何も保存せずに拒否する" $ do
      (result, stored) <- run T.length neverCalled (replyInput "賛成" (PostId (fromWords 9 9 9 9)))
      (result, stored) `shouldBe` (Left ReplyTargetNotFound, [])
    it "返信でも、不正なトピックは AI を呼ばずに拒否する" $ do
      (result, stored) <- run T.length neverCalled (replyInput (T.replicate 21 "あ") target)
      (result, stored) `shouldBe` (Left (InvalidTopic (TopicTooLong TooManyGraphemes)), [])
    it "トピックが不正で、返信先も存在しないとき、トピックの誤りを返す" $ do
      (result, _) <- run T.length neverCalled (replyInput "" (PostId (fromWords 9 9 9 9)))
      result `shouldBe` Left (InvalidTopic TopicEmpty)
    it "返信でも、AI が返した候補が 2 つなら失敗にする" $ do
      (result, stored) <- run T.length (scripted (Right ["一", "二"])) (replyInput "賛成" target)
      (result, stored) `shouldBe` (Left (InvalidCandidates (WrongCandidateCount 2)), [])
    it "返信でも、AI が返した候補が 4 つなら失敗にする" $ do
      (result, stored) <- run T.length (scripted (Right ["一", "二", "三", "四"])) (replyInput "賛成" target)
      (result, stored) `shouldBe` (Left (InvalidCandidates (WrongCandidateCount 4)), [])
    it "返信でも、141 文字の候補を含むとき、その位置を示して失敗にする" $ do
      (result, stored) <-
        run T.length (scripted (Right ["一", T.replicate 141 "あ", "三"])) (replyInput "賛成" target)
      (result, stored)
        `shouldBe` (Left (InvalidCandidates (InvalidCandidate 1 (PostBodyTooLong TooManyGraphemes))), [])
    it "返信でも、140 文字ちょうどの候補 3 つを受理する" $ do
      (result, _) <-
        run T.length (scripted (Right (replicate 3 (T.replicate 140 "あ")))) (replyInput "賛成" target)
      fmap (map T.length . texts) result `shouldBe` Right [140, 140, 140]
    it "返信でも、書記素が 140 以下でコードポイントが 1401 の候補を含むとき失敗にする" $ do
      (result, stored) <-
        run (const 1) (scripted (Right ["一", "二", T.replicate 1401 "a"])) (replyInput "賛成" target)
      (result, stored)
        `shouldBe` (Left (InvalidCandidates (InvalidCandidate 2 (PostBodyTooLong TooManyCodePoints))), [])
