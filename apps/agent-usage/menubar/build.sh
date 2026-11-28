#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]] || ! command -v swiftc >/dev/null; then
  echo 'Agent Usage Bar requires macOS and the Xcode Command Line Tools (swiftc).' >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
build_dir="$(cd "$script_dir/../../.." && pwd)/.tmp/menubar"
bundle="$build_dir/Agent Usage Bar.app"
executable="$bundle/Contents/MacOS/AgentUsageBar"
mkdir -p "$(dirname "$executable")"
cp "$script_dir/Info.plist" "$bundle/Contents/Info.plist"
swiftc -O -framework AppKit -module-cache-path "$build_dir/modules" "$script_dir/AgentUsageBar.swift" -o "$executable"
/usr/bin/plutil -lint "$bundle/Contents/Info.plist"
printf 'swiftc built %s\n' "$executable"

if [[ "${1:-}" == install ]]; then
  label="com.vit129.agent-usage-bar"
  application="$HOME/Applications/Agent Usage Bar.app"
  agents="$HOME/Library/LaunchAgents"
  plist="$build_dir/$label.plist"
  domain="gui/$(id -u)"
  arguments="$(node -p 'JSON.stringify([process.argv[1]])' "$application/Contents/MacOS/AgentUsageBar")"
  /usr/bin/plutil -create xml1 "$plist"
  /usr/bin/plutil -insert Label -string "$label" "$plist"
  /usr/bin/plutil -insert ProgramArguments -json "$arguments" "$plist"
  /usr/bin/plutil -insert RunAtLoad -bool YES "$plist"
  /usr/bin/plutil -lint "$plist"
  if /bin/launchctl print "$domain/$label" >/dev/null 2>&1; then
    /bin/launchctl bootout "$domain/$label"
  fi
  mkdir -p "$HOME/Applications" "$agents"
  /usr/bin/ditto "$bundle" "$application"
  /usr/bin/install -m 644 "$plist" "$agents/$label.plist"
  /bin/launchctl bootstrap "$domain" "$agents/$label.plist"
  printf 'Installed %s and registered %s\n' "$application" "$label"
fi
