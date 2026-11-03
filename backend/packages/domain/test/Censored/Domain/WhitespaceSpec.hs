module Censored.Domain.WhitespaceSpec (spec) where

import Censored.Domain.Whitespace (isWhitespace)
import Test.Syd

-- | Unicode の White_Space プロパティを持つ文字の全部。
unicodeWhiteSpace :: String
unicodeWhiteSpace =
  ['\x09' .. '\x0D']
    <> ['\x20', '\x85', '\xA0', '\x1680']
    <> ['\x2000' .. '\x200A']
    <> ['\x2028', '\x2029', '\x202F', '\x205F', '\x3000']

-- | 見えなくても White_Space ではない文字と、普通の文字。
notWhiteSpace :: String
notWhiteSpace =
  "a0あ"
    <> ['\x1C' .. '\x1F']
    <> ['\x200B', '\x200C', '\x200D', '\x180E', '\x2800', '\x3164', '\xFEFF']

spec :: Spec
spec = describe "空白の判定" $ do
  it "Unicode の White_Space を持つ文字をすべて空白と判定する" $
    filter (not . isWhitespace) unicodeWhiteSpace `shouldBe` []
  it "ゼロ幅スペースなど、White_Space を持たない文字を空白と判定しない" $
    filter isWhitespace notWhiteSpace `shouldBe` []
