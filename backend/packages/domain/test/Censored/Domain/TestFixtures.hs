-- | テストで使う、識別子と候補の組の見本。
module Censored.Domain.TestFixtures
  ( userA
  , userB
  , postIdN
  , setIdN
  , sampleCandidates
  , openSet
  , openReplySet
  , replyTarget
  )
where

import Censored.Domain.CandidateSet (CandidateSet, Purpose (..), newCandidateSet)
import Censored.Domain.Candidates (Candidates, mkCandidates)
import Censored.Domain.Id (CandidateSetId (..), PostId (..), UserId (..))
import Control.Exception (throw)
import Data.Text qualified as T
import Data.UUID.Types (fromWords)

userA :: UserId
userA = UserId (fromWords 0 0 0 1)

userB :: UserId
userB = UserId (fromWords 0 0 0 2)

postIdN :: Int -> PostId
postIdN n = PostId (fromWords 1 0 0 (fromIntegral n))

setIdN :: Int -> CandidateSetId
setIdN n = CandidateSetId (fromWords 2 0 0 (fromIntegral n))

-- | 返信される側の投稿。
replyTarget :: PostId
replyTarget = postIdN 99

-- | 本文が「一つ目」「二つ目」「三つ目」の組。数え方は文字数をそのまま使う。
sampleCandidates :: Candidates
sampleCandidates = either (throw . userError . show) id (mkCandidates T.length ["一つ目", "二つ目", "三つ目"])

openSet :: CandidateSet
openSet = newCandidateSet (setIdN 1) userA NewPost sampleCandidates

openReplySet :: CandidateSet
openReplySet = newCandidateSet (setIdN 2) userA (ReplyTo replyTarget) sampleCandidates
