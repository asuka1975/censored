-- | 投稿と返信の作成。本文を検証し、返信先を確かめ、要求の識別子で再送を見分けて保存する。
-- 文章が AI の出力かは確かめない。出所は公式 UI だけで守る(docs/product/README.md)。
module Censored.Application.CreatePost
  ( CreatePostInput (..)
  , CreatePostError (..)
  , createPost
  )
where

import Censored.Application.Env (Env (..))
import Censored.Application.Port
import Censored.Domain.Id (PostId, RequestId, UserId)
import Censored.Domain.Post (Post (..))
import Censored.Domain.PostBody (PostBody, PostBodyError, mkPostBody)
import Data.Text (Text)

-- | 利用者が送った要求(未検証)。返信なら返信先の投稿を指定する。
data CreatePostInput = CreatePostInput
  { inputRequestId :: !RequestId
  , inputBody :: !Text
  , inputReplyTo :: !(Maybe PostId)
  }
  deriving stock (Eq, Show)

data CreatePostError
  = InvalidBody PostBodyError
  | ReplyTargetNotFound
  | -- | 同じ要求の識別子で、別の内容(本文か返信先)を送った。
    RequestIdReused
  deriving stock (Eq, Show)

-- | 本文の検証、返信先の確認、保存の順に進む。前の段階で失敗したら、あとの段階には進まない。
-- 同じ(作者, 要求の識別子)で同じ内容の再送は、最初の投稿をそのまま返す。
createPost :: Env -> UserId -> CreatePostInput -> IO (Either CreatePostError Post)
createPost env author input = case mkPostBody (envGraphemeCounter env) (inputBody input) of
  Left err -> pure (Left (InvalidBody err))
  Right body -> case inputReplyTo input of
    Nothing -> save body
    Just target -> findPost (envStore env) target >>= maybe (pure (Left ReplyTargetNotFound)) (const (save body))
  where
    save :: PostBody -> IO (Either CreatePostError Post)
    save body = do
      identifier <- newPostId (envIds env)
      let post =
            Post {postId = identifier, postAuthor = author, postBody = body, postReplyTo = inputReplyTo input}
      existing <- insertPostOnce (envStore env) author (inputRequestId input) post
      pure $ case existing of
        Nothing -> Right post
        Just saved
          | postBody saved == body && postReplyTo saved == inputReplyTo input -> Right saved
          | otherwise -> Left RequestIdReused
