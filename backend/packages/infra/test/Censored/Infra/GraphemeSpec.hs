module Censored.Infra.GraphemeSpec (spec) where

import Censored.Infra.Grapheme (graphemeCount, graphemeCountWith)
import Control.Concurrent (forkIO, yield)
import Control.Exception (evaluate, finally)
import Control.Monad (replicateM_, unless, when)
import Data.IORef (modifyIORef', newIORef, readIORef, writeIORef)
import Data.Text (Text)
import Data.Text qualified as T
import Foreign.ForeignPtr (mallocForeignPtrBytes, withForeignPtr)
import Foreign.Marshal.Utils (fillBytes)
import Hedgehog (forAll, property, (===))
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import System.Mem (performMajorGC)
import Test.Syd
import Test.Syd.Hedgehog ()

flag :: Text
flag = "\x1F1EF\x1F1F5"

-- | 前後の部品と結合しない、それ自体で 1 文字に数えられる文字列。
singleGraphemes :: [Text]
singleGraphemes =
  [ "a"
  , "あ"
  , flag
  , "\x1F468\x200D\x1F469\x200D\x1F467"
  , "e\x0301"
  ]

-- WHY NOT: GC を強制するだけにしない。解放された領域が書き換わらないと、解放済みのメモリを読んでも
-- 正しい数が返り、誤りが隠れる。解放された領域を別の値で埋めて、誤りが数の違いとして表れるようにする。
forceGcAndOverwrite :: IO ()
forceGcAndOverwrite = do
  performMajorGC
  replicateM_ 4 $ do
    buffer <- mallocForeignPtrBytes churnBytes
    withForeignPtr buffer (\pointer -> fillBytes pointer 0xFF churnBytes)

churnBytes :: Int
churnBytes = 2 * 1024 * 1024

forceGcEvery1000 :: Int -> IO ()
forceGcEvery1000 count = when (count `mod` 1000 == 0) forceGcAndOverwrite

spec :: Spec
spec = describe "書記素の数" $ do
  it "空の文字列を 0 文字と数える" $
    graphemeCount "" `shouldBe` 0
  it "a を 1 文字と数える" $
    graphemeCount "a" `shouldBe` 1
  it "あ を 1 文字と数える" $
    graphemeCount "あ" `shouldBe` 1
  it "国旗の絵文字(地域指示記号 2 つ)を 1 文字と数える" $
    graphemeCount flag `shouldBe` 1
  it "家族の絵文字(ゼロ幅接合子で結んだ 3 つの絵文字)を 1 文字と数える" $
    graphemeCount "\x1F468\x200D\x1F469\x200D\x1F467" `shouldBe` 1
  it "家族の絵文字(ゼロ幅接合子で結んだ 4 つの絵文字)を 1 文字と数える" $
    graphemeCount "\x1F468\x200D\x1F469\x200D\x1F467\x200D\x1F466" `shouldBe` 1
  it "e と結合アクセント記号 U+0301 の組を 1 文字と数える" $
    graphemeCount "e\x0301" `shouldBe` 1
  it "種類の違う書記素が並んだ文字列(a、国旗、e と U+0301)を 3 文字と数える" $
    graphemeCount ("a" <> flag <> "e\x0301") `shouldBe` 3
  it "境界を数えるたびに、それまでに数えた個数を渡して IO を実行する" $ do
    calls <- newIORef []
    count <- graphemeCountWith (\n -> modifyIORef' calls (n :)) "abc"
    recorded <- readIORef calls
    (count, reverse recorded) `shouldBe` (3, [0, 1, 2])
  withoutRetries $ do
    it "大きな入力(a を 300,000 個)でも、GC に左右されずに 300,000 文字と数える" $
      graphemeCount (T.replicate 300000 "a") `shouldBe` 300000
    it "大きな入力(国旗を 300,000 個)でも、GC に左右されずに 300,000 文字と数える" $
      graphemeCount (T.replicate 300000 flag) `shouldBe` 300000
    it "反復中に GC が走っても、a を 300,000 個並べた文字列を 300,000 文字と数える" $ do
      count <- graphemeCountWith forceGcEvery1000 (T.replicate 300000 "a")
      count `shouldBe` 300000
    it "反復中に GC が走っても、国旗を 300,000 個並べた文字列を 300,000 文字と数える" $ do
      count <- graphemeCountWith forceGcEvery1000 (T.replicate 300000 flag)
      count `shouldBe` 300000
    it "別のスレッドが GC を繰り返しても、国旗を 1,000,000 個並べた文字列を 1,000,000 文字と数える" $ do
      finished <- newIORef False
      let collectUntilFinished = do
            done <- readIORef finished
            unless done $ forceGcAndOverwrite >> yield >> collectUntilFinished
      _ <- forkIO collectUntilFinished
      count <- evaluate (graphemeCount (T.replicate 1000000 flag)) `finally` writeIORef finished True
      count `shouldBe` 1000000
  specify "英数字だけの文字列は、コードポイントの数と同じ数に数える" $ property $ do
    s <- forAll (Gen.text (Range.linear 0 200) Gen.alphaNum)
    graphemeCount s === T.length s
  specify "国旗 n 個の並びは n 文字と数える" $ property $ do
    n <- forAll (Gen.int (Range.linear 0 50))
    graphemeCount (T.replicate n flag) === n
  specify "1 文字ずつ数えられる部品を連結した文字列は、部品の数と同じ数に数える" $ property $ do
    parts <- forAll (Gen.list (Range.linear 0 40) (Gen.element singleGraphemes))
    graphemeCount (T.concat parts) === length parts
