-- | 投稿の本文。空と、140 文字(書記素)を超える入力を受け付けない。AI が作った候補を手直しせずに保持する。
module Censored.Domain.PostBody
  ( PostBody
  , PostBodyError (..)
  , mkPostBody
  , postBodyText
  )
where

import Censored.Domain.Length (GraphemeCounter, LengthError, Limit (..), checkLength)
import Censored.Domain.Whitespace (isWhitespace)
import Data.Bifunctor (first)
import Data.Text (Text)
import Data.Text qualified as T

newtype PostBody = PostBody Text
  deriving stock (Eq, Show)

data PostBodyError
  = PostBodyEmpty
  | PostBodyTooLong LengthError
  deriving stock (Eq, Show)

-- | 本文は入力のまま保持する(前後の空白や改行も削らず、文字数にも数える)。空白だけの入力は空として拒否する。
mkPostBody :: GraphemeCounter -> Text -> Either PostBodyError PostBody
mkPostBody count text
  | T.all isWhitespace text = Left PostBodyEmpty
  | otherwise = first PostBodyTooLong (PostBody text <$ checkLength count postBodyLimit text)

postBodyText :: PostBody -> Text
postBodyText (PostBody text) = text

postBodyLimit :: Limit
postBodyLimit = Limit {limitGraphemes = 140, limitCodePoints = 1400}
