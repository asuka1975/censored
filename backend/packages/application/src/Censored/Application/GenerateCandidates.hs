-- | 候補の生成。トピックを検証し、AI に 3 つの候補を作らせ、検証して、候補の組として保存する。
module Censored.Application.GenerateCandidates
  ( GenerateInput (..)
  , GenerateError (..)
  , generateCandidateSet
  )
where

import Censored.Application.Env (Env (..))
import Censored.Application.Port
import Censored.Domain.CandidateSet (CandidateSet, Purpose (..), newCandidateSet)
import Censored.Domain.Candidates (CandidatesError, mkCandidates)
import Censored.Domain.Id (PostId, UserId)
import Censored.Domain.Post (Post (..))
import Censored.Domain.Topic (Topic, TopicError, mkTopic)
import Data.Text (Text)

-- | 利用者が入力したトピック(未検証)と、返信なら返信先の投稿。
data GenerateInput = GenerateInput
  { inputTopic :: !Text
  , inputReplyTo :: !(Maybe PostId)
  }
  deriving stock (Eq, Show)

data GenerateError
  = InvalidTopic TopicError
  | ReplyTargetNotFound
  | GeneratorFailed GeneratorError
  | InvalidCandidates CandidatesError
  deriving stock (Eq, Show)

-- | トピックの検証、返信先の確認、AI の呼び出しの順に進む。前の段階で失敗したら、あとの段階には進まない。
-- 不正なトピックと存在しない返信先では AI を呼ばず、どの失敗でも何も保存しない。
generateCandidateSet :: Env -> UserId -> GenerateInput -> IO (Either GenerateError CandidateSet)
generateCandidateSet env user input = case mkTopic (envGraphemeCounter env) (inputTopic input) of
  Left err -> pure (Left (InvalidTopic err))
  Right topic -> case inputReplyTo input of
    Nothing -> askAi topic Nothing
    Just target -> findPost (envStore env) target >>= maybe (pure (Left ReplyTargetNotFound)) (askAi topic . Just)
  where
    askAi :: Topic -> Maybe Post -> IO (Either GenerateError CandidateSet)
    askAi topic replyTo = do
      answer <- generate (envGenerator env) (GenerationRequest topic (postBody <$> replyTo))
      case answer of
        Left err -> pure (Left (GeneratorFailed err))
        Right texts -> case mkCandidates (envGraphemeCounter env) texts of
          Left err -> pure (Left (InvalidCandidates err))
          Right candidates -> do
            setId <- newCandidateSetId (envIds env)
            let set = newCandidateSet setId user (purposeOf replyTo) candidates
            insertCandidateSet (envStore env) set
            pure (Right set)
    purposeOf = maybe NewPost (ReplyTo . postId)
