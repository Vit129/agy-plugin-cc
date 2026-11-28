#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/../../.." && pwd)"
install=false
if [[ "${1:-}" == install ]]; then
  install=true
  shift
  node "$script_dir/../cli.mjs" check-install-location "$@"
fi

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Agent Usage Bar requires macOS.' >&2
  exit 1
fi
if ! /usr/bin/xcode-select -p >/dev/null 2>&1 || ! command -v swiftc >/dev/null; then
  echo 'Xcode Command Line Tools are required. Run: xcode-select --install' >&2
  exit 1
fi

build_dir="$repo_dir/.tmp/menubar"
bundle="$build_dir/Agent Usage Bar.app"
executable="$bundle/Contents/MacOS/AgentUsageBar"
resources="$bundle/Contents/Resources"
mkdir -p "$(dirname "$executable")" "$resources"
cp "$script_dir/Info.plist" "$bundle/Contents/Info.plist"
cp "$repo_dir/THIRD-PARTY-NOTICES.md" "$resources/"
node --input-type=module - "$script_dir/../ui/provider-icons.mjs" > "$resources/provider-icons.json" <<'JS'
import { pathToFileURL } from 'node:url';
const { providerIcons } = await import(pathToFileURL(process.argv[2]));
console.log(JSON.stringify(providerIcons));
JS
swiftc -O -framework AppKit -framework SwiftUI -module-cache-path "$build_dir/modules" \
  "$script_dir"/*.swift -o "$executable"
/usr/bin/plutil -lint "$bundle/Contents/Info.plist"
printf 'swiftc built %s\n' "$executable"

if $install; then
  node "$script_dir/../cli.mjs" install-menubar "$@"
fi
