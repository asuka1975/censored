-- | 投稿。本文は検証済みで、返信なら返信先の投稿を指す。
module Censored.Domain.Post
  ( Post (..)
  )
where

import Censored.Domain.Id (PostId, UserId)
import Censored.Domain.PostBody (PostBody)

data Post = Post
  { postId :: !PostId
  , postAuthor :: !UserId
  , postBody :: !PostBody
  , postReplyTo :: !(Maybe PostId)
  }
  deriving stock (Eq, Show)
