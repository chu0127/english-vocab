#!/usr/bin/env bash
# Rebuild → commit → push to GitHub (chu0127/english-vocab) → wait for GitHub Pages.
# Same permanent URL every time: https://chu0127.github.io/english-vocab/
# Usage: ./tools/publish_pages.sh ["commit message"]
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=chu0127/english-vocab
URL=https://chu0127.github.io/english-vocab/
MSG="${1:-Update vocab app $(date '+%Y-%m-%d %H:%M')}"

.venv/bin/python tools/build.py
cp dist/index.html index.html
git add -A
if git diff --cached --quiet; then echo "冇新改動要 commit（照樣檢查網站）"; else git commit -q -m "$MSG"; echo "committed: $MSG"; fi
git push -q origin main
SHA=$(git rev-parse HEAD)
BUILT=$(grep -o 'const BUILD=[^;]*' index.html | grep -o '"id": "[0-9a-f]*"' | grep -o '[0-9a-f]\{12\}')
echo "pushed $SHA — 等 GitHub Pages 更新（通常 1–3 分鐘，有時要 10 分鐘）..."
for i in $(seq 1 60); do
  if curl -fsS -m 30 "${URL}?v=${SHA:0:7}-$i" 2>/dev/null | grep -qF "$BUILT"; then
    echo "✅ 已上線：$URL  (${BUILT})"
    curl -sS -m 30 -o /dev/null -w "check GET: %{http_code} %{content_type} %{size_download} bytes\n" "$URL"
    echo "提示：手機如果仲見到舊版，落拉重新整理（GitHub CDN 最多 cache 10 分鐘）。"
    exit 0
  fi
  sleep 10
done
echo "⚠️ 10 分鐘內仲未見到新版本，請睇 https://github.com/$REPO/actions 或者遲啲再試。"; exit 1
