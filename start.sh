#!/bin/sh
set -eu

case "$0" in
  */*) here=${0%/*} ;;
  *) here=. ;;
esac
cd "$here"

case "$(uname -s)" in
  Darwin | Linux) ;;
  *)
    echo "GT7 Tutor runs on macOS and Linux." >&2
    exit 1
    ;;
esac

node_message="Install Node.js 26 or later: https://nodejs.org/en/download"

if ! command -v node >/dev/null 2>&1; then
  echo "$node_message" >&2
  exit 1
fi

version=$(node --version)
major=${version#v}
major=${major%%.*}
case "$major" in
  '' | *[!0-9]*)
    echo "$node_message" >&2
    exit 1
    ;;
esac
if [ "$major" -lt 26 ]; then
  echo "$node_message" >&2
  exit 1
fi

exec node tools/start/start.ts "$@"
