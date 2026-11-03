-- | ユースケースが使う Port と設定の束。server が実物を組み立てて渡し、テストはフェイクを渡す。
module Censored.Application.Env
  ( Env (..)
  )
where

import Censored.Application.Port (IdGenerator, PostStore)
import Censored.Domain.Length (GraphemeCounter)

data Env = Env
  { envGraphemeCounter :: GraphemeCounter
  , envIds :: IdGenerator
  , envStore :: PostStore
  }
