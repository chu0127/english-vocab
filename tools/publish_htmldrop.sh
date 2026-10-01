#!/usr/bin/env bash
# LEGACY: publish dist/index.html to htmldrop.link (anonymous, 30-day expiry, NEW URL every time). Default is now tools/publish_pages.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import json
h = open("dist/index.html", encoding="utf-8").read()
json.dump({"html": h, "title": "每日英文生字 Daily Vocab", "ttl_days": 30}, open("publish/payload.json", "w"), ensure_ascii=False)
PY
res=$(curl -sS -m 180 -X POST https://htmldrop.link/publish -H "Content-Type: application/json; charset=utf-8" --data-binary @publish/payload.json)
echo "$res"
echo "$(date '+%Y-%m-%d %H:%M %Z') $res" >> publish/history.log
url=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["url"])' "$res")
curl -sS -m 60 -o /dev/null -w "check GET: %{http_code} %{content_type} %{size_download} bytes\n" "$url"
