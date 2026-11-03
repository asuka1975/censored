-- | 入力の文字数の検査。見た目の 1 文字(書記素)の数え方は ICU に依存するので持たず、呼び出し側が渡す(ADR-0010)。
module Censored.Domain.Length
  ( GraphemeCounter
  , Limit (..)
  , LengthError (..)
  , checkLength
  )
where

import Data.Text (Text)
import Data.Text qualified as T

-- | 拡張書記素クラスタ(UAX #29)の数を数える関数。数え方が違えば受理する入力も変わる。
type GraphemeCounter = Text -> Int

-- | 入力の上限。コードポイントの上限は、書記素の上限を満たす入力でも書記素の数え方の仕事量を抑えるために置く。
data Limit = Limit
  { limitGraphemes :: !Int
  , limitCodePoints :: !Int
  }
  deriving stock (Eq, Show)

data LengthError
  = TooManyCodePoints
  | TooManyGraphemes
  deriving stock (Eq, Show)

-- | コードポイントの上限を先に検査する。両方を超える入力は TooManyCodePoints になる。
-- 上限を超える入力では書記素を数えない。数える仕事量が入力の大きさに比例しないようにする(NFR-ABUSE-3)。
checkLength :: GraphemeCounter -> Limit -> Text -> Either LengthError ()
checkLength count limit text
  | T.compareLength text (limitCodePoints limit) == GT = Left TooManyCodePoints
  | count text > limitGraphemes limit = Left TooManyGraphemes
  | otherwise = Right ()
