module Censored.Domain.CandidateSetSpec (spec) where

import Censored.Domain.CandidateSet
import Censored.Domain.Candidates (Choice (..))
import Censored.Domain.Post (Post (..))
import Censored.Domain.PostBody (postBodyText)
import Censored.Domain.TestFixtures
import Hedgehog (failure, footnote, forAll, property, (===))
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Test.Syd
import Test.Syd.Hedgehog ()

choices :: [Choice]
choices = [FirstCandidate, SecondCandidate, ThirdCandidate]

-- | 利用者 A が選び、初めて投稿が作られたときの投稿と更新後の組を取り出して検査する。
whenNewlyPosted :: Choice -> CandidateSet -> (Post -> CandidateSet -> Expectation) -> Expectation
whenNewlyPosted choice set check = case selectCandidate userA choice (postIdN 10) set of
  Right (NewlyPosted post updated) -> check post updated
  other -> expectationFailure ("初めての選択が投稿を作らなかった: " <> show other)

-- | 利用者 A が選んで投稿が作られたあとの組。作れなければテストを失敗させる。
posted :: Choice -> CandidateSet -> IO CandidateSet
posted choice set = case selectCandidate userA choice (postIdN 10) set of
  Right (NewlyPosted _ updated) -> pure updated
  other -> expectationFailure ("初めての選択が投稿を作らなかった: " <> show other)

discarded :: CandidateSet -> IO CandidateSet
discarded set = case discardCandidates userA set of
  Right updated -> pure updated
  Left err -> expectationFailure ("破棄できなかった: " <> show err)

spec :: Spec
spec = describe "候補の組" $ do
  describe "生成" $ do
    it "生成した直後の組は、生成した利用者のもので、まだ選ばれていない" $ do
      candidateSetOwner openSet `shouldBe` userA
      candidateSetState openSet `shouldBe` Open
    it "生成した組は、渡された識別子と、新規投稿という目的を保つ" $ do
      candidateSetId openSet `shouldBe` setIdN 1
      candidateSetPurpose openSet `shouldBe` NewPost
    it "返信の組は、渡された識別子と、返信先の投稿を指す目的を保つ" $ do
      candidateSetId openReplySet `shouldBe` setIdN 2
      candidateSetPurpose openReplySet `shouldBe` ReplyTo replyTarget
  describe "選択" $ do
    it "生成した利用者が 1 番目の候補を選ぶと、その本文の投稿が作られる" $
      whenNewlyPosted FirstCandidate openSet $
        \post _ -> postBodyText (postBody post) `shouldBe` "一つ目"
    it "生成した利用者が 2 番目の候補を選ぶと、その本文の投稿が作られる" $
      whenNewlyPosted SecondCandidate openSet $
        \post _ -> postBodyText (postBody post) `shouldBe` "二つ目"
    it "生成した利用者が 3 番目の候補を選ぶと、その本文の投稿が作られる" $
      whenNewlyPosted ThirdCandidate openSet $
        \post _ -> postBodyText (postBody post) `shouldBe` "三つ目"
    it "作られる投稿の作者は選んだ利用者で、識別子は渡された識別子になる" $
      whenNewlyPosted FirstCandidate openSet $ \post _ -> do
        postAuthor post `shouldBe` userA
        postId post `shouldBe` postIdN 10
    it "新規投稿の組から作られる投稿は、返信先を持たない" $
      whenNewlyPosted FirstCandidate openSet $
        \post _ -> postReplyTo post `shouldBe` Nothing
    it "返信の組から作られる投稿は、返信先の投稿を指す" $
      whenNewlyPosted FirstCandidate openReplySet $
        \post _ -> postReplyTo post `shouldBe` Just replyTarget
    it "返信として作られた投稿にも、返信の組を作って返信できる" $
      whenNewlyPosted FirstCandidate openReplySet $ \reply _ -> do
        postReplyTo reply `shouldBe` Just replyTarget
        let nested = newCandidateSet (setIdN 3) userB (ReplyTo (postId reply)) sampleCandidates
        case selectCandidate userB SecondCandidate (postIdN 20) nested of
          Right (NewlyPosted post _) -> do
            postReplyTo post `shouldBe` Just (postIdN 10)
            postAuthor post `shouldBe` userB
          other -> expectationFailure ("返信への返信が投稿を作らなかった: " <> show other)
    it "選ぶと、組は選んだ候補と投稿の識別子を記録して、投稿済みになる" $
      whenNewlyPosted ThirdCandidate openSet $ \_ updated ->
        candidateSetState updated `shouldBe` Posted ThirdCandidate (postIdN 10)
    it "選んでも、組の持ち主と候補は変わらない" $
      whenNewlyPosted FirstCandidate openSet $ \_ updated -> do
        candidateSetOwner updated `shouldBe` userA
        candidateSetCandidates updated `shouldBe` candidateSetCandidates openSet
    it "同じ候補をもう一度選ぶと、新しい識別子を渡しても最初の投稿を返し、投稿は作られない" $ do
      set <- posted FirstCandidate openSet
      case selectCandidate userA FirstCandidate (postIdN 11) set of
        Right (AlreadyPosted post) -> do
          postId post `shouldBe` postIdN 10
          postBodyText (postBody post) `shouldBe` "一つ目"
        other -> expectationFailure ("再送が最初の投稿を返さなかった: " <> show other)
    it "返信の組で同じ候補を選び直すと、返信先を指す最初の投稿を返す" $ do
      set <- posted FirstCandidate openReplySet
      case selectCandidate userA FirstCandidate (postIdN 11) set of
        Right (AlreadyPosted post) -> do
          postId post `shouldBe` postIdN 10
          postReplyTo post `shouldBe` Just replyTarget
        other -> expectationFailure ("返信の再送が最初の投稿を返さなかった: " <> show other)
    it "投稿済みの組から別の候補を選ぶと拒否する" $ do
      set <- posted FirstCandidate openSet
      selectCandidate userA SecondCandidate (postIdN 11) set `shouldBe` Left SelectedOtherCandidate
    it "生成した利用者でない利用者が選ぶと拒否する" $
      selectCandidate userB FirstCandidate (postIdN 10) openSet `shouldBe` Left SelectNotOwner
    it "生成した利用者でない利用者は、投稿済みの組から同じ候補を選んでも拒否する" $ do
      set <- posted FirstCandidate openSet
      selectCandidate userB FirstCandidate (postIdN 11) set `shouldBe` Left SelectNotOwner
    it "生成した利用者でない利用者が、投稿済みの組から別の候補を選んでも、持ち主でないことを理由に拒否する" $ do
      set <- posted FirstCandidate openSet
      selectCandidate userB SecondCandidate (postIdN 11) set `shouldBe` Left SelectNotOwner
    it "破棄した組からは選べない" $ do
      set <- discarded openSet
      selectCandidate userA FirstCandidate (postIdN 10) set `shouldBe` Left SelectDiscarded
    it "生成した利用者でない利用者は、破棄した組から選ぼうとしても、持ち主でないことを理由に拒否する" $ do
      set <- discarded openSet
      selectCandidate userB FirstCandidate (postIdN 10) set `shouldBe` Left SelectNotOwner
    specify "一度選んだ組では、同じ候補を何度選んでも最初の投稿が返り、別の候補はどれも拒否される" $ property $ do
      base <- forAll (Gen.element [openSet, openReplySet])
      first <- forAll (Gen.element choices)
      other <- forAll (Gen.element (filter (/= first) choices))
      later <- forAll (Gen.int (Range.linear 11 1000))
      case selectCandidate userA first (postIdN 10) base of
        Right (NewlyPosted original set) -> do
          selectCandidate userA first (postIdN later) set === Right (AlreadyPosted original)
          selectCandidate userA other (postIdN later) set === Left SelectedOtherCandidate
        unexpected -> footnote (show unexpected) >> failure
  describe "破棄" $ do
    it "生成した利用者が破棄すると、組は破棄済みになる" $ do
      set <- discarded openSet
      candidateSetState set `shouldBe` Discarded
    it "生成した利用者でない利用者は破棄できない" $
      discardCandidates userB openSet `shouldBe` Left DiscardNotOwner
    it "生成した利用者でない利用者は、投稿済みの組を破棄しようとしても、投稿済みであることを教えず、持ち主でないことを理由に拒否する" $ do
      set <- posted FirstCandidate openSet
      discardCandidates userB set `shouldBe` Left DiscardNotOwner
    it "投稿済みの組は破棄できない" $ do
      set <- posted FirstCandidate openSet
      discardCandidates userA set `shouldBe` Left DiscardAlreadyPosted
    it "破棄済みの組を、生成した利用者がもう一度破棄しても、破棄済みのまま受理する" $ do
      set <- discarded openSet
      discardCandidates userA set `shouldBe` Right set
    it "生成した利用者でない利用者は、破棄済みの組も破棄できない" $ do
      set <- discarded openSet
      discardCandidates userB set `shouldBe` Left DiscardNotOwner
