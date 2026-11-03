-- | 利用者、投稿、候補の組、投稿の作成要求の識別子。取り違えを型で防ぐ。投稿などの採番は application の Port が行う。要求の識別子は利用者側が付ける(ADR-0011)。
module Censored.Domain.Id
  ( UserId (..)
  , PostId (..)
  , CandidateSetId (..)
  , RequestId (..)
  )
where

import Data.UUID.Types (UUID)

newtype UserId = UserId UUID
  deriving stock (Eq, Ord, Show)

newtype PostId = PostId UUID
  deriving stock (Eq, Ord, Show)

newtype CandidateSetId = CandidateSetId UUID
  deriving stock (Eq, Ord, Show)

-- | 利用者側が付ける、投稿の作成要求の識別子。同じ要求の再送を見分ける。
newtype RequestId = RequestId UUID
  deriving stock (Eq, Ord, Show)
