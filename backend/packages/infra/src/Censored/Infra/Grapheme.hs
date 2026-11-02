{-# LANGUAGE MagicHash #-}

-- | 書記素(見た目の 1 文字)単位の文字数を数える。ICU に触れるのはこのモジュールだけ(ADR-0010)。
module Censored.Infra.Grapheme
  ( graphemeCount
  , graphemeCountWith
  )
where

import Data.Text (Text)
import Data.Text.ICU (LocaleName (Root))
import Data.Text.ICU.Break (BreakIterator, breakCharacter, first, next)
import GHC.Exts (keepAlive#)
import GHC.IO (IO (IO), unsafePerformIO)

-- | 拡張書記素クラスタ(UAX #29)の数。ICU の版によって、新しく追加された絵文字の数え方は環境ごとに変わり得る。
-- 入力の大きさの上限は、呼び出し側が先に検査する(NFR-ABUSE-3)。
graphemeCount :: Text -> Int
graphemeCount = unsafePerformIO . graphemeCountWith (\_ -> pure ())
-- WHY NOT: unsafePerformIO の禁止をここでは外す。入力の Text だけに依存し、ICU のデータは読み取り専用で、
-- 反復器は呼び出しごとに作るので、結果は純粋である。IO にすると domain に数える関数を渡せない(ADR-0010)。
{-# ANN graphemeCount ("HLint: ignore Avoid restricted function" :: String) #-}

-- | 境界を 1 つ数えるたびに、それまでに数えた個数を渡して IO を実行する。反復中の GC をテストで強制するために公開する。
graphemeCountWith :: (Int -> IO ()) -> Text -> IO Int
graphemeCountWith afterBoundary text = do
  iterator <- breakCharacter Root text
  keepAlive iterator $ do
    _ <- first iterator
    countBoundaries afterBoundary iterator 0

countBoundaries :: (Int -> IO ()) -> BreakIterator () -> Int -> IO Int
countBoundaries afterBoundary iterator !count = do
  boundary <- next iterator
  case boundary of
    Nothing -> pure count
    Just _ -> do
      afterBoundary count
      countBoundaries afterBoundary iterator (count + 1)

-- WHY NOT: 反復器を keepAlive# で保持せずに数えない。反復中に使われるのは ICU の反復器へのポインタだけで、
-- GC が入力のコピーを解放すると、解放済みのメモリを ICU が読み、数が狂う(ADR-0010)。
keepAlive :: a -> IO b -> IO b
keepAlive value (IO action) = IO (\s -> keepAlive# value s action)
