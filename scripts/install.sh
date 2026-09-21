#!/bin/bash
# Installs the latest Study App release on a Mac.
#
#   curl -fsSL https://raw.githubusercontent.com/neftyhot/study-app/main/scripts/install.sh | bash
#
# Why this exists: the app is not yet signed with an Apple Developer ID, so
# a DMG downloaded in a browser is tagged with com.apple.quarantine and
# Gatekeeper refuses to open it ("Study App is damaged" / "cannot be
# verified"). A file fetched with curl is never tagged, and the tag is also
# removed from the installed copy below, so the app opens normally.
#
# That is exactly the check Gatekeeper exists to make, so only run this for
# a release you trust. Signing and notarizing the app makes it unnecessary.
set -euo pipefail

REPO="neftyhot/study-app"
APP="Study App.app"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Study App is a macOS app; this installer only runs on a Mac." >&2
  exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "Releases are built for Apple silicon (M1 or later); this Mac is $(uname -m)." >&2
  exit 1
fi

echo "Finding the latest release…"
DMG_URL="$(
  curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" |
    grep -o '"browser_download_url": *"[^"]*arm64\.dmg"' |
    head -n 1 |
    sed -E 's/.*"(https[^"]+)"$/\1/' ||
    true
)"

if [[ -z "${DMG_URL}" ]]; then
  echo "No macOS release found at github.com/${REPO}/releases." >&2
  echo "(The repository must be public, with a published release.)" >&2
  exit 1
fi

WORK="$(mktemp -d)"
MOUNT=""
cleanup() {
  [[ -n "${MOUNT}" ]] && hdiutil detach "${MOUNT}" -quiet 2>/dev/null || true
  rm -rf "${WORK}"
}
trap cleanup EXIT

echo "Downloading ${DMG_URL##*/}…"
curl -fL --progress-bar -o "${WORK}/StudyApp.dmg" "${DMG_URL}"

echo "Installing to /Applications…"
MOUNT="$(hdiutil attach "${WORK}/StudyApp.dmg" -nobrowse -readonly | grep -o '/Volumes/.*' | head -n 1)"

# Quit a running copy first; replacing an app while it runs can corrupt it.
if pgrep -f "/Applications/${APP}/" >/dev/null 2>&1; then
  osascript -e 'tell application "Study App" to quit' >/dev/null 2>&1 || true
  sleep 2
fi

rm -rf "/Applications/${APP}"
ditto "${MOUNT}/${APP}" "/Applications/${APP}"
xattr -dr com.apple.quarantine "/Applications/${APP}" 2>/dev/null || true

echo "Installed. Opening Study App…"
open "/Applications/${APP}"
