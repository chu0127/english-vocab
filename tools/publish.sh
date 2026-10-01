#!/usr/bin/env bash
# Default publish = GitHub Pages (permanent URL). htmldrop version kept as tools/publish_htmldrop.sh.
exec "$(dirname "$0")/publish_pages.sh" "$@"
