-- | AI が作る、ちょうど 3 つの候補の組。利用者はこの中から 1 つを選んで投稿する。
module Censored.Domain.Candidates
  ( Candidates
  , CandidatesError (..)
  , mkCandidates
  , candidateList
  )
where

import Censored.Domain.Length (GraphemeCounter)
import Censored.Domain.PostBody (PostBody, PostBodyError, mkPostBody)
import Data.Bifunctor (first)
import Data.Text (Text)

data Candidates = Candidates PostBody PostBody PostBody
  deriving stock (Eq, Show)

data CandidatesError
  = -- | 候補の数が 3 でない。値は与えられた数。
    WrongCandidateCount Int
  | -- | 不正な候補がある。値は 0 始まりの位置で、最初に見つかった 1 つだけを示す。
    InvalidCandidate Int PostBodyError
  deriving stock (Eq, Show)

-- | 数を先に検査する。数が合わない入力では、候補の中身を検査しない。
mkCandidates :: GraphemeCounter -> [Text] -> Either CandidatesError Candidates
mkCandidates count texts = case texts of
  [a, b, c] -> Candidates <$> validate 0 a <*> validate 1 b <*> validate 2 c
  _ -> Left (WrongCandidateCount (length texts))
  where
    validate position = first (InvalidCandidate position) . mkPostBody count

candidateList :: Candidates -> [PostBody]
candidateList (Candidates a b c) = [a, b, c]
