# 人・AI・CI が同じ入口を使う。CI 固有のチェックは作らない(手元で再現できないゲートは信頼されない)。
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
BASE ?= origin/main

export PATH := $(CURDIR)/.tools/bin:$(CURDIR)/node_modules/.bin:$(PATH)
# 日本語のテスト名を子プロセスの引数で渡すため UTF-8 が必須(未設定だと sydtest のミューテーションが失敗する)。
export LANG := C.UTF-8
export LC_ALL := C.UTF-8

HS_PKGS := $(wildcard backend/packages/*/*.cabal)
PS_PKGS := $(wildcard frontend/packages/*/spago.yaml)
GATES := node tools/gates
# BASE が解決できる環境(PR ブランチ)でだけ差分系の検査を有効にする。
HAS_BASE := $(shell git rev-parse --verify --quiet $(BASE) >/dev/null 2>&1 && echo yes)
DIFF_ARGS := $(if $(HAS_BASE),--base $(BASE),)
LICENSE_SCOPE ?= npm,purescript,hackage

.PHONY: help setup fmt check lint lint-repo lint-hs lint-ps lint-md lint-actions test-gates require-base build build-hs build-ps \
        test test-hs test-ps coverage coverage-hs coverage-ps \
        mutation-diff mutation-diff-hs mutation-diff-ps mutation-full \
        licenses vulns secrets weeder contract-check check-pr freeze

help: ## このヘルプを表示する
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

setup: ## ツールチェーンと Git フックを導入する
	tools/setup-toolchain.sh
	pnpm install --frozen-lockfile
	@if git rev-parse --git-dir >/dev/null 2>&1; then lefthook install; else echo "git 管理外のためフックは未導入"; fi

fmt: ## フォーマッタを適用する
ifneq ($(HS_PKGS),)
	cd backend && find packages -name '*.hs' -not -path '*/dist-*' -print0 | xargs -0 fourmolu --mode inplace -q
endif
ifneq ($(PS_PKGS),)
	cd frontend && purs-tidy format-in-place 'packages/**/*.purs'
endif

check: lint build coverage weeder licenses ## push 前に必ず通す一式(差分系を含む)

lint: lint-repo lint-hs lint-ps lint-md ## 静的検査をすべて実行する

# CI で BASE が解決できないと差分系の検査が黙って飛ばされるので、失敗にする。
require-base:
	@if [ "$${CI:-}" = "true" ] && [ -z "$(HAS_BASE)" ]; then echo "[GATE-1] BASE=$(BASE) を解決できない。差分の検査を実行できない" >&2; exit 1; fi

lint-repo: require-base test-gates ## リポジトリ規約(コメント・層・ADR・文書・依存)を検査する
	$(GATES)/check-source.mjs
	$(GATES)/check-layers.mjs
	$(GATES)/check-adr.mjs $(DIFF_ARGS)
	$(GATES)/check-docs.mjs
	$(GATES)/check-deps.mjs

test-gates: ## ゲート自身のテストを実行する
	node --test 'tools/gates/test/*.test.mjs'

lint-hs: ## Haskell の整形と HLint を検査する
ifneq ($(HS_PKGS),)
	cd backend && find packages -name '*.hs' -not -path '*/dist-*' -print0 | xargs -0 fourmolu --mode check -q
	cd backend && hlint packages --hint=.hlint.yaml
else
	@echo "lint-hs: Haskell パッケージなし"
endif

lint-ps: ## PureScript の整形を検査する(厳格な警告は build-ps で検査される)
ifneq ($(PS_PKGS),)
	cd frontend && purs-tidy check 'packages/**/*.purs'
else
	@echo "lint-ps: PureScript パッケージなし"
endif

lint-md: ## Markdown を検査する
	markdownlint-cli2 "**/*.md" "#node_modules" "#frontend/.spago" "#**/dist-*" "#.tools"

lint-actions: ## GitHub Actions の定義を検査する
	actionlint .github/workflows/*.yml

build: build-hs build-ps ## すべてビルドする

build-hs:
ifneq ($(HS_PKGS),)
	cd backend && cabal build all --enable-coverage -j
	$(GATES)/check-layers.mjs --plan backend/dist-newstyle/cache/plan.json
else
	@echo "build-hs: Haskell パッケージなし"
endif

build-ps:
ifneq ($(PS_PKGS),)
	cd frontend && spago build
else
	@echo "build-ps: PureScript パッケージなし"
endif

test: test-hs test-ps ## すべてのテストを実行する

test-hs:
ifneq ($(HS_PKGS),)
	cd backend && find dist-newstyle -name '*.tix' -delete 2>/dev/null || true
	cd backend && cabal test all --enable-coverage --test-show-details=direct -j
else
	@echo "test-hs: Haskell パッケージなし"
endif

test-ps: build-ps
ifneq ($(PS_PKGS),)
	rm -rf frontend/coverage/v8 && mkdir -p frontend/coverage/v8
	cd frontend && NODE_V8_COVERAGE=coverage/v8 node tools/run-tests.mjs
else
	@echo "test-ps: PureScript パッケージなし"
endif

coverage: coverage-hs coverage-ps ## テストを実行してカバレッジゲートを判定する

coverage-hs: require-base test-hs
ifneq ($(HS_PKGS),)
	$(GATES)/hs-coverage.mjs --out backend/dist-newstyle/coverage/lcov.info
	$(GATES)/check-coverage.mjs --side backend --lcov backend/dist-newstyle/coverage/lcov.info $(DIFF_ARGS)
endif

coverage-ps: require-base test-ps
ifneq ($(PS_PKGS),)
	$(GATES)/ps-coverage.mjs --v8 frontend/coverage/v8 --out frontend/coverage/lcov.info
	$(GATES)/check-coverage.mjs --side frontend --lcov frontend/coverage/lcov.info $(DIFF_ARGS)
endif

mutation-diff: mutation-diff-hs mutation-diff-ps ## 変更箇所のミューテーションテスト(PR ゲート)

mutation-diff-hs:
	$(GATES)/hs-mutation.mjs --mode diff --base $(BASE)

mutation-diff-ps: build-ps
	$(GATES)/ps-mutation.mjs --mode diff --base $(BASE)

mutation-full: build-ps ## 全体のミューテーションテスト(夜間ジョブ)
	$(GATES)/hs-mutation.mjs --mode full
	$(GATES)/ps-mutation.mjs --mode full

weeder: ## 未使用コードを検査する
ifneq ($(HS_PKGS),)
	cd backend && weeder --hie-directory .
endif

licenses: ## 依存ライセンスを検査する
	$(GATES)/check-licenses.mjs --only $(LICENSE_SCOPE)

vulns: ## 既知の脆弱性を検査する
	osv-scanner scan source --config=osv-scanner.toml --lockfile=pnpm-lock.yaml \
	  $(if $(wildcard backend/cabal.project.freeze),--lockfile=backend/cabal.project.freeze,)

secrets: ## コミット履歴の秘密情報を検査する
	gitleaks git --no-banner --redact .

freeze: ## Haskell の依存を固定し直す
	cd backend && rm -f cabal.project.freeze && cabal freeze

contract-check: ## API 契約の生成物がコミットと一致するか検査する(未追跡の新しい fixture も失敗にする)
	@if [ -n "$$(git status --porcelain -- contract/)" ]; then git status --short -- contract/; echo "contract/ の生成物がコミットと一致しない" >&2; exit 1; fi

check-pr: ## PR 単位の検査(コミットログ・サイズ・ゲート分離・レビュー記録)
	$(GATES)/check-commits.mjs --range $(BASE)..HEAD
	$(GATES)/check-pr.mjs --base $(BASE) $(if $(PR_BODY),--body-file $(PR_BODY),)
