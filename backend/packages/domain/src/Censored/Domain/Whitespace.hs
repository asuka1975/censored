-- | 空白の定義。Unicode の White_Space プロパティを持つ文字を空白とする。
module Censored.Domain.Whitespace
  ( isWhitespace
  )
where

import Data.Char (isSpace)

-- | `Data.Char.isSpace` は NEL(U+0085)、行区切り(U+2028)、段落区切り(U+2029)を空白としない。それらを補う。
-- ゼロ幅スペース(U+200B)は White_Space を持たないので、空白としない。
isWhitespace :: Char -> Bool
isWhitespace c = isSpace c || c == '\x85' || c == '\x2028' || c == '\x2029'
