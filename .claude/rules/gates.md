---
paths:
  - "tools/**"
  - "frontend/tools/**"
  - ".github/**"
  - "docs/conventions/**"
  - "lefthook.yml"
  - ".lefthookrc"
  - "Makefile"
---

# ゲートの変更

正本: `docs/conventions/11-ai-native-flow.md`(AI-8)

- 製品コードと同じ PR で変更しない。CI が拒否する(依存の台帳 `tools/policy/dependencies.json` だけは製品コードと一緒に変更する)
- 閾値を緩める変更は、緩める理由を PR に書いて人間の承認を受ける
- 製品コードのゲートを通すために緩めるなら、止まって人間に相談する
- ゲートを変更したら `tools/gates/test/` にテストを追加する。**偽の合格を生まないこと** を確かめるテストを優先する
- **解釈できない入力や欠けた情報を合格にしない**(GATE-1)。読み飛ばす処理を書くときは、それで合格が生まれないかを確かめる
- ワークフローを変更したら `make lint-actions` を実行する。`uses:` はコミット SHA で固定する
