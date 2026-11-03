-- | application が外部に求める能力(Port)。infra が実装する。投稿の保存の契約の理由は ADR-0011。
module Censored.Application.Port
  ( IdGenerator (..)
  , PostStore (..)
  )
where

import Censored.Domain.Id (PostId, RequestId, UserId)
import Censored.Domain.Post (Post)

-- | 識別子の採番。
newtype IdGenerator = IdGenerator
  { newPostId :: IO PostId
  }

-- | 投稿の保存。
data PostStore = PostStore
  { findPost :: PostId -> IO (Maybe Post)
  , insertPostOnce :: UserId -> RequestId -> Post -> IO (Maybe Post)
  -- ^ (作者, 要求の識別子)の組が未登録のときだけ、投稿を保存して Nothing を返す。
  -- 登録済みなら、何も保存せず、そのとき保存されていた投稿を返す。
  -- 登録の確認と保存は、同時に届く別の呼び出しに対して原子的でなければならない(一意制約など)。
  }
