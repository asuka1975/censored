-- | 書記素(見た目の 1 文字)単位の文字数を数える。ICU に触れるのはこのモジュールだけ(ADR-0009)。
module Censored.Domain.Grapheme
  ( graphemeCount
  )
where

import Data.Text (Text)
import Data.Text.ICU (LocaleName (Root), breakCharacter, breaks)

-- | 拡張書記素クラスタ(UAX #29)の数。ICU の版によって、新しく追加された絵文字の数え方は環境ごとに変わり得る。
graphemeCount :: Text -> Int
graphemeCount = length . breaks (breakCharacter Root)
-- WHY NOT: Root を Current に替えるミュータントはテストで殺さない。ICU 74.2 で、Current を含む 14 のロケールと
-- 20 の入力(国旗、ZWJ、結合文字、ハングル、タイ文字、インド系文字、アラビア文字など)を比べ、書記素の数は一致した。
-- Root を使うのは、環境の LANG に結果を左右させないため(ADR-0009)。
{-# ANN graphemeCount ("DisableMutation: ConstConstructor" :: String) #-}
