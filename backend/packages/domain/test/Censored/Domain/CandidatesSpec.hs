module Censored.Domain.CandidatesSpec (spec) where

import Censored.Domain.Candidates
import Censored.Domain.Length (LengthError (..))
import Censored.Domain.PostBody (PostBodyError (..), postBodyText)
import Censored.Domain.TestCounters (neverCount)
import Data.Text (Text)
import Data.Text qualified as T
import Hedgehog (forAll, property, (===))
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Test.Syd
import Test.Syd.Hedgehog ()

candidatesOf :: [Text] -> Either CandidatesError [Text]
candidatesOf = fmap (map postBodyText . candidateList) . mkCandidates T.length

spec :: Spec
spec = describe "候補の組" $ do
  it "3 つの有効な候補を、順序を保って受理する" $
    candidatesOf ["一つ目", "二つ目", "三つ目"] `shouldBe` Right ["一つ目", "二つ目", "三つ目"]
  it "140 文字ちょうどの候補 3 つを受理する" $
    candidatesOf (replicate 3 (T.replicate 140 "あ"))
      `shouldBe` Right (replicate 3 (T.replicate 140 "あ"))
  it "候補が 0 個のとき拒否する" $
    candidatesOf [] `shouldBe` Left (WrongCandidateCount 0)
  it "候補が 2 つのとき拒否する" $
    candidatesOf ["一つ目", "二つ目"] `shouldBe` Left (WrongCandidateCount 2)
  it "候補が 4 つのとき拒否する" $
    candidatesOf ["一", "二", "三", "四"] `shouldBe` Left (WrongCandidateCount 4)
  it "空の候補を含むとき、その位置(0 始まり)を示して拒否する" $
    candidatesOf ["一", "", "三"] `shouldBe` Left (InvalidCandidate 1 PostBodyEmpty)
  it "空白だけの候補を含むとき、その位置を示して拒否する" $
    candidatesOf ["一", "二", " \n"] `shouldBe` Left (InvalidCandidate 2 PostBodyEmpty)
  it "141 文字の候補を含むとき、その位置を示して拒否する" $
    candidatesOf ["一", "二", T.replicate 141 "あ"]
      `shouldBe` Left (InvalidCandidate 2 (PostBodyTooLong TooManyGraphemes))
  it "書記素が 140 以下でも、コードポイントが 1401 の候補を含むとき拒否する" $
    fmap (map postBodyText . candidateList) (mkCandidates (const 1) [T.replicate 1401 "a", "二", "三"])
      `shouldBe` Left (InvalidCandidate 0 (PostBodyTooLong TooManyCodePoints))
  it "不正な候補が複数あるとき、最初の位置を示す" $
    candidatesOf ["", "二", T.replicate 141 "あ"] `shouldBe` Left (InvalidCandidate 0 PostBodyEmpty)
  it "個数が合わないときは、候補の中身より先に個数で拒否する" $
    candidatesOf ["", "二", "三", "四"] `shouldBe` Left (WrongCandidateCount 4)
  it "個数が合わないときは、どの候補の数え方の関数も評価せずに拒否する" $
    fmap candidateList (mkCandidates neverCount ["一", "二", "三", "四"])
      `shouldBe` Left (WrongCandidateCount 4)
  specify "3 つ以外の個数は、中身に関わらず拒否される" $ property $ do
    n <- forAll (Gen.filter (/= 3) (Gen.int (Range.linear 0 10)))
    candidatesOf (replicate n "あ") === Left (WrongCandidateCount n)
