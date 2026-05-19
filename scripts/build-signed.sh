#!/usr/bin/env bash
# =============================================================
# Signed + notarized .dmg build for macOS.
#
# This script does NOT bundle credentials. Set these env vars (or
# export them in your shell's keychain unlock script) before running:
#
#   APPLE_ID                — Apple ID used for notarization
#   APPLE_PASSWORD          — App-specific password from appleid.apple.com
#   APPLE_TEAM_ID           — Team ID, e.g. ABCDE12345
#   APPLE_SIGNING_IDENTITY  — "Developer ID Application: Your Name (TEAM)"
#
# Without those vars the script will still produce an unsigned .dmg
# and warn — useful for local testing, not for distribution.
# =============================================================
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "▶ HashCerebrum signed-build pipeline"

missing=()
for var in APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_SIGNING_IDENTITY; do
  if [ -z "${!var:-}" ]; then
    missing+=("$var")
  fi
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "  ⚠ no signing credentials set (${missing[*]}) — will produce an unsigned .dmg"
  echo "  ⚠ unsigned bundles will not pass Gatekeeper. Set the env vars above to release."
  SIGN=false
else
  SIGN=true
fi

echo "▶ typecheck + frontend production build"
npm run typecheck
npx vite build

echo "▶ tauri build (.dmg)"
if $SIGN; then
  TAURI_SIGNING_PRIVATE_KEY="" \
  APPLE_ID="$APPLE_ID" \
  APPLE_PASSWORD="$APPLE_PASSWORD" \
  APPLE_TEAM_ID="$APPLE_TEAM_ID" \
  APPLE_SIGNING_IDENTITY="$APPLE_SIGNING_IDENTITY" \
  npx tauri build --bundles dmg
  echo "▶ codesign verify"
  bundle="$(find src-tauri/target/release/bundle/dmg -name '*.dmg' -print -quit)"
  [ -n "$bundle" ] || { echo "  ✗ no .dmg produced"; exit 1; }
  codesign --verify --deep --verbose=2 "$bundle" || true
  echo "▶ spctl assess"
  spctl --assess --type install -v "$bundle" || true
  echo "✓ signed bundle: $bundle"
else
  npx tauri build --bundles dmg
  echo "✓ unsigned bundle in src-tauri/target/release/bundle/dmg/"
fi
