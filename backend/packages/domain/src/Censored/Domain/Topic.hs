-- | 投稿のもとにするトピック。前後の空白を除き、空と、20 文字(書記素)を超える入力を受け付けない。
module Censored.Domain.Topic
  ( Topic
  , TopicError (..)
  , mkTopic
  , topicText
  )
where

import Censored.Domain.Length (GraphemeCounter, LengthError, Limit (..), checkLength)
import Censored.Domain.Whitespace (isWhitespace)
import Data.Bifunctor (first)
import Data.Text (Text)
import Data.Text qualified as T

newtype Topic = Topic Text
  deriving stock (Eq, Show)

data TopicError
  = TopicEmpty
  | TopicTooLong LengthError
  deriving stock (Eq, Show)

-- | 前後の空白は文字数に数えず、保持しない。空白だけの入力は空として拒否する。
mkTopic :: GraphemeCounter -> Text -> Either TopicError Topic
mkTopic count raw
  | T.null body = Left TopicEmpty
  | otherwise = first TopicTooLong (Topic body <$ checkLength count topicLimit body)
  where
    body = T.dropAround isWhitespace raw

topicText :: Topic -> Text
topicText (Topic text) = text

topicLimit :: Limit
topicLimit = Limit {limitGraphemes = 20, limitCodePoints = 200}
