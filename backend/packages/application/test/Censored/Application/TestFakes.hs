-- | application のテストで使う、Port のフェイク。本物の DB は使わない。
-- 保存は、本物の保存先の一意制約と同じく、同時に届く呼び出しに対して原子的に判断する(ADR-0011)。
module Censored.Application.TestFakes
  ( Fakes (..)
  , newFakes
  )
where

import Censored.Application.Env (Env (..))
import Censored.Application.Port
import Censored.Domain.Id (PostId (..), RequestId, UserId)
import Censored.Domain.Length (GraphemeCounter)
import Censored.Domain.Post (Post (..))
import Data.IORef (atomicModifyIORef', modifyIORef', newIORef, readIORef)
import Data.Map.Strict (Map)
import Data.Map.Strict qualified as Map
import Data.UUID.Types (fromWords)

data Fakes = Fakes
  { fakesEnv :: !Env
  , fakesPosts :: IO [Post]
  -- ^ 保存された投稿を、識別子の順に返す。
  , fakesSeedPost :: Post -> IO ()
  -- ^ 返信先にできる投稿を、あらかじめ保存しておく。要求の識別子は持たない。
  }

data State = State
  { statePosts :: !(Map PostId Post)
  , stateByRequest :: !(Map (UserId, RequestId) PostId)
  }

newFakes :: GraphemeCounter -> IO Fakes
newFakes counter = do
  state <- newIORef (State Map.empty Map.empty)
  next <- newIORef (0 :: Int)
  let ids =
        IdGenerator
          { newPostId =
              PostId . fromWords 1 0 0 . fromIntegral <$> atomicModifyIORef' next (\n -> (n + 1, n + 1))
          }
      store =
        PostStore
          { findPost = \identifier -> Map.lookup identifier . statePosts <$> readIORef state
          , insertPostOnce = \author request post ->
              atomicModifyIORef' state $ \current ->
                case Map.lookup (author, request) (stateByRequest current) >>= (`Map.lookup` statePosts current) of
                  Just existing -> (current, Just existing)
                  Nothing ->
                    ( State
                        (Map.insert (postId post) post (statePosts current))
                        (Map.insert (author, request) (postId post) (stateByRequest current))
                    , Nothing
                    )
          }
  pure
    Fakes
      { fakesEnv = Env {envGraphemeCounter = counter, envIds = ids, envStore = store}
      , fakesPosts = Map.elems . statePosts <$> readIORef state
      , fakesSeedPost = \post ->
          modifyIORef'
            state
            (\current -> current {statePosts = Map.insert (postId post) post (statePosts current)})
      }
