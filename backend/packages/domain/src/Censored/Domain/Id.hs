-- | 利用者、投稿、候補の組の識別子。取り違えを型で防ぐ。識別子の採番は application の Port が行う。
module Censored.Domain.Id
  ( UserId (..)
  , PostId (..)
  , CandidateSetId (..)
  )
where

import Data.UUID.Types (UUID)

newtype UserId = UserId UUID
  deriving stock (Eq, Ord, Show)

newtype PostId = PostId UUID
  deriving stock (Eq, Ord, Show)

newtype CandidateSetId = CandidateSetId UUID
  deriving stock (Eq, Ord, Show)
