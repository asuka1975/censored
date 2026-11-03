-- | application が外部に求める能力(Port)。infra が実装する。形の理由は ADR-0011。
module Censored.Application.Port
  ( CandidateGenerator (..)
  , GenerationRequest (..)
  , GeneratorError (..)
  , IdGenerator (..)
  , Store (..)
  )
where

import Censored.Domain.CandidateSet (CandidateSet)
import Censored.Domain.Id (CandidateSetId, PostId)
import Censored.Domain.Post (Post)
import Censored.Domain.PostBody (PostBody)
import Censored.Domain.Topic (Topic)
import Data.Text (Text)

-- | AI への依頼。返信のときは、返信先の投稿の本文も渡す。
data GenerationRequest = GenerationRequest
  { requestTopic :: !Topic
  , requestReplyTo :: !(Maybe PostBody)
  }
  deriving stock (Eq, Show)

-- | 失敗の理由に、利用者の入力(トピックや本文)を含めない(NFR-PRIV-1)。
data GeneratorError
  = GeneratorUnavailable
  | GeneratorTimedOut
  deriving stock (Eq, Show)

-- | AI。外部サービスなので、実装は呼び出しにタイムアウトを持つ(NFR-REL-2)。
-- 返す文字列は信用しない。検証は呼び出し側が行う。
newtype CandidateGenerator = CandidateGenerator
  { generate :: GenerationRequest -> IO (Either GeneratorError [Text])
  }

-- | 識別子の採番。
data IdGenerator = IdGenerator
  { newPostId :: IO PostId
  , newCandidateSetId :: IO CandidateSetId
  }

-- | 候補の組と投稿の保存。
data Store = Store
  { insertCandidateSet :: CandidateSet -> IO ()
  , findPost :: PostId -> IO (Maybe Post)
  }
