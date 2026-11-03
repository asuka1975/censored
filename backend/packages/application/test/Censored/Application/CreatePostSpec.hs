module Censored.Application.CreatePostSpec (spec) where

import Censored.Application.CreatePost
import Censored.Application.TestFakes
import Censored.Domain.Id (PostId (..), RequestId (..), UserId (..))
import Censored.Domain.Length (GraphemeCounter, LengthError (..))
import Censored.Domain.Post (Post (..))
import Censored.Domain.PostBody (PostBodyError (..), mkPostBody, postBodyText)
import Control.Concurrent (forkIO)
import Control.Concurrent.MVar (newEmptyMVar, putMVar, takeMVar)
import Control.Monad (replicateM, void)
import Data.Maybe (catMaybes)
import Data.Text (Text)
import Data.Text qualified as T
import Data.UUID.Types (fromWords)
import Test.Syd

alice :: UserId
alice = UserId (fromWords 0 0 0 1)

bob :: UserId
bob = UserId (fromWords 0 0 0 2)

request :: Int -> RequestId
request n = RequestId (fromWords 3 0 0 (fromIntegral n))

target :: PostId
target = PostId (fromWords 9 0 0 1)

-- | 返信される側の投稿。見本の本文は正しいので、検証に失敗したら見本が無いだけ。
seedPosts :: [Post]
seedPosts =
  catMaybes [mkSeed target Nothing "元の投稿", mkSeed (PostId (fromWords 9 0 0 2)) (Just target) "返信の投稿"]
  where
    mkSeed identifier replyTo text = case mkPostBody T.length text of
      Right body -> Just Post {postId = identifier, postAuthor = bob, postBody = body, postReplyTo = replyTo}
      Left _ -> Nothing

replyToReply :: PostId
replyToReply = PostId (fromWords 9 0 0 2)

input :: Int -> Text -> CreatePostInput
input n body = CreatePostInput {inputRequestId = request n, inputBody = body, inputReplyTo = Nothing}

replyInput :: Int -> Text -> PostId -> CreatePostInput
replyInput n body to = (input n body) {inputReplyTo = Just to}

-- | 数え方を差し替えた環境で、利用者 alice の要求を順に実行する。結果と、保存された投稿を返す。
runAs :: GraphemeCounter -> [CreatePostInput] -> IO ([Either CreatePostError Post], [Post])
runAs counter inputs = do
  fakes <- newFakes counter
  mapM_ (fakesSeedPost fakes) seedPosts
  results <- mapM (createPost (fakesEnv fakes) alice) inputs
  stored <- fakesPosts fakes
  pure (results, filter ((== alice) . postAuthor) stored)

bodyOfPost :: Either CreatePostError Post -> Either CreatePostError Text
bodyOfPost = fmap (postBodyText . postBody)

spec :: Spec
spec = describe "投稿と返信の作成" $ do
  describe "本文" $ do
    it "140 文字ちょうどの本文を受理し、その本文の投稿を作る" $ do
      (results, stored) <- runAs T.length [input 1 (T.replicate 140 "あ")]
      (map bodyOfPost results, length stored) `shouldBe` ([Right (T.replicate 140 "あ")], 1)
    it "141 文字の本文を拒否し、何も保存しない" $ do
      (results, stored) <- runAs T.length [input 1 (T.replicate 141 "あ")]
      (results, stored) `shouldBe` ([Left (InvalidBody (PostBodyTooLong TooManyGraphemes))], [])
    it "空の本文を拒否する" $ do
      (results, stored) <- runAs T.length [input 1 ""]
      (results, stored) `shouldBe` ([Left (InvalidBody PostBodyEmpty)], [])
    it "空白だけの本文を拒否する" $ do
      (results, stored) <- runAs T.length [input 1 " \x3000\n"]
      (results, stored) `shouldBe` ([Left (InvalidBody PostBodyEmpty)], [])
    it "本文は入力のまま保持する(前後の空白や改行を削らない)" $ do
      (results, _) <- runAs T.length [input 1 "\n 本文 \n"]
      map bodyOfPost results `shouldBe` [Right "\n 本文 \n"]
    it "書記素が 140 以下でも、コードポイントが 1401 の本文を拒否する" $ do
      (results, stored) <- runAs (const 1) [input 1 (T.replicate 1401 "a")]
      (results, stored) `shouldBe` ([Left (InvalidBody (PostBodyTooLong TooManyCodePoints))], [])
    it "書記素の数え方は、環境に渡されたものを使う(1 文字と数える数え方なら 141 文字も受理する)" $ do
      (results, _) <- runAs (const 1) [input 1 (T.replicate 141 "あ")]
      map bodyOfPost results `shouldBe` [Right (T.replicate 141 "あ")]
  describe "投稿の作成" $ do
    it "作者は操作している利用者で、識別子は採番されたものになる" $ do
      (results, stored) <- runAs T.length [input 1 "こんにちは"]
      case results of
        [Right post] -> do
          postAuthor post `shouldBe` alice
          postReplyTo post `shouldBe` Nothing
          stored `shouldBe` [post]
        other -> expectationFailure ("投稿が作られなかった: " <> show other)
    it "異なる要求の識別子の要求は、別々の投稿になる" $ do
      (results, stored) <- runAs T.length [input 1 "一つ目", input 2 "二つ目"]
      (map bodyOfPost results, length stored) `shouldBe` ([Right "一つ目", Right "二つ目"], 2)
    it "同じ要求の識別子で同じ本文を再送しても、投稿は 1 件のままで、同じ投稿を返す" $ do
      (results, stored) <- runAs T.length [input 1 "こんにちは", input 1 "こんにちは"]
      case results of
        [Right first, Right second] -> do
          second `shouldBe` first
          stored `shouldBe` [first]
        other -> expectationFailure ("再送が同じ投稿を返さなかった: " <> show other)
    it "同じ要求の識別子で別の本文を送ると拒否し、最初の投稿は変わらない" $ do
      (results, stored) <- runAs T.length [input 1 "こんにちは", input 1 "さようなら"]
      (map void results, map (postBodyText . postBody) stored)
        `shouldBe` ([Right (), Left RequestIdReused], ["こんにちは"])
    it "別の利用者が同じ要求の識別子を使っても、互いに干渉しない" $ do
      fakes <- newFakes T.length
      first <- createPost (fakesEnv fakes) alice (input 1 "aliceの投稿")
      second <- createPost (fakesEnv fakes) bob (input 1 "bobの投稿")
      stored <- fakesPosts fakes
      (fmap postAuthor first, fmap postAuthor second, length stored)
        `shouldBe` (Right alice, Right bob, 2)
    it "同じ要求が同時に届いても、投稿は 1 件になり、どの呼び出しも同じ投稿を返す" $ do
      fakes <- newFakes T.length
      done <- replicateM 20 newEmptyMVar
      mapM_ (\signal -> forkIO (createPost (fakesEnv fakes) alice (input 1 "同時") >>= putMVar signal)) done
      results <- mapM takeMVar done
      stored <- fakesPosts fakes
      case (results, stored) of
        (Right first : rest, [saved]) -> (first == saved, all (== Right first) rest) `shouldBe` (True, True)
        other -> expectationFailure ("同時の要求が 1 件にならなかった: " <> show other)
  describe "返信" $ do
    it "返信先の投稿を指定して、返信先を指す投稿を作る" $ do
      (results, _) <- runAs T.length [replyInput 1 "賛成です" target]
      fmap (fmap postReplyTo) results `shouldBe` [Right (Just target)]
    it "存在しない投稿への返信を拒否し、何も保存しない" $ do
      (results, stored) <- runAs T.length [replyInput 1 "賛成です" (PostId (fromWords 9 9 9 9))]
      (results, stored) `shouldBe` ([Left ReplyTargetNotFound], [])
    it "返信である投稿にも返信できる" $ do
      (results, _) <- runAs T.length [replyInput 1 "同意です" replyToReply]
      fmap (fmap postReplyTo) results `shouldBe` [Right (Just replyToReply)]
    it "返信でも、141 文字の本文を拒否する" $ do
      (results, stored) <- runAs T.length [replyInput 1 (T.replicate 141 "あ") target]
      (results, stored) `shouldBe` ([Left (InvalidBody (PostBodyTooLong TooManyGraphemes))], [])
    it "返信を同じ要求の識別子で再送しても、投稿は 1 件のままで、同じ投稿を返す" $ do
      (results, stored) <- runAs T.length [replyInput 1 "賛成です" target, replyInput 1 "賛成です" target]
      case results of
        [Right first, Right second] -> (second, stored) `shouldBe` (first, [first])
        other -> expectationFailure ("返信の再送が同じ投稿を返さなかった: " <> show other)
    it "同じ要求の識別子と本文でも、返信先が違えば拒否する" $ do
      (results, _) <- runAs T.length [replyInput 1 "賛成です" target, replyInput 1 "賛成です" replyToReply]
      map void results `shouldBe` [Right (), Left RequestIdReused]
    it "本文が不正で返信先も存在しないとき、本文の誤りを返す" $ do
      (results, _) <- runAs T.length [replyInput 1 "" (PostId (fromWords 9 9 9 9))]
      results `shouldBe` [Left (InvalidBody PostBodyEmpty)]
