#!/usr/bin/env bash
# 計測ページと診断ページ(tools/llm-bench の静的ファイル 8 つと、版を示す version.mjs)を gh-pages ブランチへ公開する。
#   tools/llm-bench/publish-pages.sh            公開する
#   PAGES_DRY_RUN=1 tools/llm-bench/publish-pages.sh   中身を表示するだけで、push しない
# HEAD にコミットされた版を使い、作業ツリーの未コミットの変更は見ない。
# PAGES_TRAILERS に改行つきの文字列を渡すと、コミットメッセージの末尾に付ける(共著者の行など)。
#
# WHY NOT: git checkout や worktree でコミットしない。gh-pages には tools/gates が無く、
# コミットフックが動かない。インデックスを一時ファイルに分けてツリーを直接組み、commit-tree でコミットする。
set -euo pipefail

BRANCH="${PAGES_BRANCH:-gh-pages}"
FILES=(index.html bench.mjs engines.mjs lib.mjs topics.mjs download.mjs probe.html probe.mjs)

cd "$(git rev-parse --show-toplevel)"
source_sha="$(git rev-parse --short HEAD)"

index_file="$(mktemp -u)"
trap 'rm -f "$index_file"' EXIT
tree="$(
  export GIT_INDEX_FILE="$index_file"
  git read-tree --empty
  for f in "${FILES[@]}"; do
    git update-index --add --cacheinfo "100644,$(git rev-parse "HEAD:tools/llm-bench/$f"),$f"
  done
  # どの版が配信されたかを、結果から分かるようにする(Pages のキャッシュで、古い版が返ることがある)。
  git update-index --add --cacheinfo "100644,$(printf 'export const VERSION = "%s";\n' "$source_sha" | git hash-object -w --stdin),version.mjs"
  # Jekyll の処理を止める。
  git update-index --add --cacheinfo "100644,$(git hash-object -w --stdin </dev/null),.nojekyll"
  git write-tree
)"

if [ "${PAGES_DRY_RUN:-}" = "1" ]; then
  echo "公開するもの(${source_sha} の版):"
  git ls-tree --long "$tree"
  exit 0
fi

parent_args=()
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  git fetch --quiet origin "$BRANCH"
  parent="$(git rev-parse FETCH_HEAD)"
  if [ "$(git rev-parse "$parent^{tree}")" = "$tree" ]; then
    echo "公開済みの内容と同じなので、何もしない"
    exit 0
  fi
  parent_args=(-p "$parent")
fi

message="$(cat <<EOF
chore(pages): 計測ページを ${source_sha} の版に更新する

Why: ブラウザ内 LLM の計測を、手元のサーバーを使わずに、スマートフォンを含む端末で行えるようにする。
内容は tools/llm-bench の静的ファイルだけで、ソースのコミットは ${source_sha}。計測が終わったら、このブランチごと削除する。

Refs: #16
${PAGES_TRAILERS:-}
EOF
)"

commit="$(git commit-tree "$tree" ${parent_args[@]+"${parent_args[@]}"} -m "$message")"
git push origin "$commit:refs/heads/$BRANCH"
echo "公開した: $BRANCH @ $(git rev-parse --short "$commit")(ソース ${source_sha})"
