# Censored

Censored は、バックエンドを Haskell、フロントエンドを PureScript で作る SNS。現在は開発規約とゲートのみで、アプリケーションのコードはまだない。

## 始め方

前提: x86_64 Linux(glibc 2.34 以上)、[GHCup](https://www.haskell.org/ghcup/)、Node.js 24、pnpm 11、ICU の開発ファイル(Ubuntu なら `libicu-dev` と `pkg-config`。理由は [ADR-0009](docs/adr/0009-grapheme-counting.md))。

```bash
make setup   # ツールを .tools/bin に導入し、Git フックを設定する
make check   # 全検査
make help    # コマンド一覧
```

## 文書

- [AGENTS.md](AGENTS.md) — 作業の入口(AI と人の共通)
- [docs/README.md](docs/README.md) — すべての文書の索引

## ライセンス

Copyright (C) 2026 asuka1975

[AGPL-3.0-or-later](LICENSE)。判断の根拠は [ADR-0006](docs/adr/0006-project-license.md)。
