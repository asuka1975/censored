-- | テストで使う、書記素の数え方の差し替え。domain は数え方を持たない(ADR-0010)ので、ICU は使わない。
module Censored.Domain.TestCounters
  ( ignoringCombining
  , neverCount
  )
where

import Control.Exception (Exception, throw)
import Data.Text (Text)
import Data.Text qualified as T

-- | 結合アクセント記号を数えない。見た目の 1 文字が複数のコードポイントになる入力を再現する。
ignoringCombining :: Text -> Int
ignoringCombining = T.length . T.filter (/= '\x0301')

data CounterCalled = CounterCalled
  deriving stock (Show)

instance Exception CounterCalled

-- | 評価されたら例外を投げる。数えてはいけない入力で、数え方が呼ばれていないことを、結果が返ることで確かめる。
neverCount :: Text -> Int
neverCount _ = throw CounterCalled
