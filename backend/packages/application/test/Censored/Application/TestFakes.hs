-- | application のテストで使う、Port のフェイクと、AI の差し替え。本物の AI も DB も使わない(ADR-0011)。
module Censored.Application.TestFakes
  ( Fakes (..)
  , newFakes
  , scripted
  , echoing
  , neverCalled
  )
where

import Censored.Application.Env (Env (..))
import Censored.Application.Port
import Censored.Domain.CandidateSet (CandidateSet, candidateSetId)
import Censored.Domain.Id (CandidateSetId (..), PostId (..))
import Censored.Domain.Length (GraphemeCounter)
import Censored.Domain.Post (Post (..))
import Censored.Domain.PostBody (postBodyText)
import Censored.Domain.Topic (topicText)
import Control.Exception (Exception, throwIO)
import Control.Monad (when)
import Data.IORef (atomicModifyIORef', modifyIORef', newIORef, readIORef)
import Data.Map.Strict qualified as Map
import Data.Text (Text)
import Data.UUID.Types (fromWords)

data Fakes = Fakes
  { fakesEnv :: !Env
  , fakesStoredSets :: IO [CandidateSet]
  -- ^ 保存された候補の組を、保存した順ではなく識別子の順に返す。
  , fakesSeedPost :: Post -> IO ()
  -- ^ 返信先にできる投稿を、あらかじめ保存しておく。
  }

newFakes :: GraphemeCounter -> CandidateGenerator -> IO Fakes
newFakes counter generator = do
  sets <- newIORef Map.empty
  posts <- newIORef Map.empty
  next <- newIORef (0 :: Int)
  let nextWord = fromIntegral <$> atomicModifyIORef' next (\n -> (n + 1, n + 1))
      ids =
        IdGenerator
          { newPostId = PostId . fromWords 1 0 0 <$> nextWord
          , newCandidateSetId = CandidateSetId . fromWords 2 0 0 <$> nextWord
          }
      store =
        Store
          { insertCandidateSet = \set -> do
              duplicated <-
                atomicModifyIORef'
                  sets
                  (\stored -> (Map.insert (candidateSetId set) set stored, Map.member (candidateSetId set) stored))
              when duplicated (throwIO DuplicateCandidateSet)
          , findPost = \identifier -> Map.lookup identifier <$> readIORef posts
          }
  pure
    Fakes
      { fakesEnv =
          Env {envGraphemeCounter = counter, envGenerator = generator, envIds = ids, envStore = store}
      , fakesStoredSets = Map.elems <$> readIORef sets
      , fakesSeedPost = \post -> modifyIORef' posts (Map.insert (postId post) post)
      }

-- | 決まった答えを返す AI。
scripted :: Either GeneratorError [Text] -> CandidateGenerator
scripted answer = CandidateGenerator {generate = \_ -> pure answer}

-- | 渡された依頼を、候補の本文に写す AI。何が渡ったかを、結果の候補から確かめるために使う。
echoing :: CandidateGenerator
echoing =
  CandidateGenerator
    { generate = \request ->
        pure
          ( Right
              [ "トピック:" <> topicText (requestTopic request)
              , "返信先:" <> maybe "なし" postBodyText (requestReplyTo request)
              , "三つ目"
              ]
          )
    }

-- | 同じ識別子の組を 2 回保存したときに投げる。本物の保存先の一意制約と同じ振る舞いにする。
data DuplicateCandidateSet = DuplicateCandidateSet
  deriving stock (Show)

instance Exception DuplicateCandidateSet

data AiWasCalled = AiWasCalled
  deriving stock (Show)

instance Exception AiWasCalled

-- | 呼ばれたら例外を投げる AI。呼んではいけない入力で、呼ばれていないことを、結果が返ることで確かめる。
neverCalled :: CandidateGenerator
neverCalled = CandidateGenerator {generate = \_ -> throwIO AiWasCalled}
