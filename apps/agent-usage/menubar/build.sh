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
swiftc -O -framework AppKit -module-cache-path "$build_dir/modules" \
  "$script_dir/AgentUsageBar.swift" "$script_dir/StatusTitle.swift" -o "$executable"
icon_dest="$bundle/Contents/Resources/ProviderIcons"
mkdir -p "$icon_dest"
codexbar_resources=''
for codexbar in "/Applications/CodexBar.app" "$HOME/Applications/CodexBar.app"; do
  if [[ -d "$codexbar/Contents/Resources" ]]; then
    codexbar_resources="$codexbar/Contents/Resources"
    break
  fi
done
for provider in claude agy copilot codex; do
  icon="$icon_dest/$provider.png"
  rm -f -- "$icon"
  if [[ -n "${AGENT_USAGE_ICON_DIR:-}" && -f "$AGENT_USAGE_ICON_DIR/$provider.png" ]]; then
    if /usr/bin/sips -s format png -Z 32 "$AGENT_USAGE_ICON_DIR/$provider.png" --out "$icon" >/dev/null 2>&1 && [[ -s "$icon" ]]; then
      continue
    fi
    rm -f -- "$icon"
  fi
  source_provider="$provider"
  if [[ "$provider" == agy ]]; then source_provider=antigravity; fi
  source_icon="$codexbar_resources/ProviderIcon-$source_provider.svg"
  if [[ -n "$codexbar_resources" && -f "$source_icon" ]]; then
    if ! /usr/bin/sips -s format png -Z 32 "$source_icon" --out "$icon" >/dev/null 2>&1 || [[ ! -s "$icon" ]]; then
      rm -f -- "$icon"
      printf 'Using a letter for %s (local icon conversion failed).\n' "$provider"
    fi
  fi
done
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
