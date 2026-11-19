#!/bin/sh
set -eu

NODE_MAJOR_MIN=26
NODE_LINK="https://nodejs.org/en/download"
PNPM_LINK="https://pnpm.io/installation"
DOCKER_DESKTOP_LINK="https://www.docker.com/products/docker-desktop/"
DOCKER_ENGINE_LINK="https://docs.docker.com/engine/install/"

dry_run=0
demo=0

for option in "$@"; do
  case "$option" in
    --dry-run) dry_run=1 ;;
    --demo) demo=1 ;;
    *)
      echo "Unknown option: $option"
      echo "Use: sh tools/setup/setup.sh [--dry-run] [--demo]"
      exit 2
      ;;
  esac
done

say() {
  echo "$1"
}

stop_with() {
  echo ""
  echo "$1"
  exit 1
}

run() {
  if [ "$dry_run" -eq 1 ]; then
    say "Would run: $*"
  else
    say "Running: $*"
    "$@"
  fi
}

has() {
  command -v "$1" >/dev/null 2>&1
}

node_is_recent() {
  has node || return 1
  version=$(node --version 2>/dev/null) || return 1
  major=${version#v}
  major=${major%%.*}
  case "$major" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$major" -ge "$NODE_MAJOR_MIN" ]
}

case "$0" in
  */*) script_dir=${0%/*} ;;
  *) script_dir=. ;;
esac
cd "$script_dir/../.."

say "GT7 Tutor setup for macOS and Linux."
if [ "$dry_run" -eq 1 ]; then
  say "Dry run: this run only shows the steps. It changes nothing."
fi

system=$(uname -s)
case "$system" in
  Darwin) platform=macos ;;
  Linux) platform=linux ;;
  *) stop_with 'This script supports macOS and Linux. On Windows, follow "Manual setup" in README.md.' ;;
esac

say ""
say "Step 1 of 4: checking Docker."
if ! has docker; then
  if [ "$platform" = macos ]; then
    stop_with "Docker is not installed. Install Docker Desktop: $DOCKER_DESKTOP_LINK"
  fi
  stop_with "Docker is not installed. Install Docker Desktop: $DOCKER_DESKTOP_LINK or Docker Engine: $DOCKER_ENGINE_LINK"
fi
if ! docker info >/dev/null 2>&1; then
  stop_with "Docker is installed but not running. Start it, then run this script again."
fi
say "Docker is running."

say ""
say "Step 2 of 4: checking Node.js $NODE_MAJOR_MIN or later."
if node_is_recent; then
  say "Node.js $(node --version) is installed."
elif [ "$platform" = macos ] && has brew; then
  say "Node.js $NODE_MAJOR_MIN or later is missing. Installing it with Homebrew."
  run brew install node
  if [ "$dry_run" -eq 0 ] && ! node_is_recent; then
    stop_with "Homebrew did not install Node.js $NODE_MAJOR_MIN or later. Install it from $NODE_LINK, then run this script again."
  fi
else
  stop_with "Node.js $NODE_MAJOR_MIN or later is required. Install it from $NODE_LINK, then run this script again."
fi

say ""
say "Step 3 of 4: checking pnpm."
if has pnpm; then
  say "pnpm is installed."
elif [ "$platform" = macos ] && has brew; then
  say "pnpm is missing. Installing it with Homebrew."
  run brew install pnpm
else
  stop_with "pnpm is required. Install it: $PNPM_LINK, then run this script again."
fi

say ""
say "Step 4 of 4: preparing GT7 Tutor. This step has 7 smaller steps."
if [ "$demo" -eq 1 ]; then
  run pnpm setup:local --demo
else
  run pnpm setup:local
fi
