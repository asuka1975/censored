-- | 利用者に出した 3 つの候補の組。持ち主だけが選べて、破棄できる。選べるのは 1 回だけ。
module Censored.Domain.CandidateSet
  ( CandidateSet
  , Purpose (..)
  , SetState (..)
  , Selection (..)
  , SelectError (..)
  , DiscardError (..)
  , newCandidateSet
  , candidateSetId
  , candidateSetOwner
  , candidateSetPurpose
  , candidateSetCandidates
  , candidateSetState
  , selectCandidate
  , discardCandidates
  )
where

import Censored.Domain.Candidates (Candidates, Choice, candidateAt)
import Censored.Domain.Id (CandidateSetId, PostId, UserId)
import Censored.Domain.Post (Post (..))

-- | 組から作る投稿が、新しい投稿か、既存の投稿への返信か。返信にも返信できるので、返信先は投稿ならよい。
data Purpose
  = NewPost
  | ReplyTo PostId
  deriving stock (Eq, Show)

data SetState
  = Open
  | -- | 選ばれて投稿が作られた。選んだ候補と、作った投稿の識別子を覚える。
    Posted Choice PostId
  | Discarded
  deriving stock (Eq, Show)

data CandidateSet = CandidateSet
  { candidateSetId :: !CandidateSetId
  , candidateSetOwner :: !UserId
  , candidateSetPurpose :: !Purpose
  , candidateSetCandidates :: !Candidates
  , candidateSetState :: !SetState
  }
  deriving stock (Eq, Show)

-- | 選んだ結果。初めて選んだときだけ、保存すべき投稿と更新後の組が返る。
data Selection
  = NewlyPosted Post CandidateSet
  | -- | 同じ候補を選ぶ再送。最初の投稿をそのまま返し、保存するものは無い。
    AlreadyPosted Post
  deriving stock (Eq, Show)

data SelectError
  = SelectNotOwner
  | SelectDiscarded
  | SelectedOtherCandidate
  deriving stock (Eq, Show)

data DiscardError
  = DiscardNotOwner
  | DiscardAlreadyPosted
  deriving stock (Eq, Show)

newCandidateSet :: CandidateSetId -> UserId -> Purpose -> Candidates -> CandidateSet
newCandidateSet setId owner purpose candidates =
  CandidateSet
    { candidateSetId = setId
    , candidateSetOwner = owner
    , candidateSetPurpose = purpose
    , candidateSetCandidates = candidates
    , candidateSetState = Open
    }

-- | 持ち主かどうかを先に検査する。持ち主でない利用者には、組の状態(破棄や投稿済み)を教えない。
-- 作る投稿の識別子は引数で受け取る。使うのは初めて選んだときだけで、再送では最初の投稿の識別子を返す。
selectCandidate :: UserId -> Choice -> PostId -> CandidateSet -> Either SelectError Selection
selectCandidate user choice newPostId set
  | user /= candidateSetOwner set = Left SelectNotOwner
  | otherwise = case candidateSetState set of
      Discarded -> Left SelectDiscarded
      Posted chosen existing
        | chosen == choice -> Right (AlreadyPosted (postFor existing))
        | otherwise -> Left SelectedOtherCandidate
      Open ->
        Right (NewlyPosted (postFor newPostId) set {candidateSetState = Posted choice newPostId})
  where
    postFor identifier =
      Post
        { postId = identifier
        , postAuthor = candidateSetOwner set
        , postBody = candidateAt choice (candidateSetCandidates set)
        , postReplyTo = case candidateSetPurpose set of
            NewPost -> Nothing
            ReplyTo target -> Just target
        }

-- | 破棄済みの組をもう一度破棄しても、破棄済みのまま受理する。投稿済みの組は破棄できない。
discardCandidates :: UserId -> CandidateSet -> Either DiscardError CandidateSet
discardCandidates user set
  | user /= candidateSetOwner set = Left DiscardNotOwner
  | otherwise = case candidateSetState set of
      Posted _ _ -> Left DiscardAlreadyPosted
      Open -> Right set {candidateSetState = Discarded}
      Discarded -> Right set
