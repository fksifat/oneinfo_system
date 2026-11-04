#!/usr/bin/env bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd)"
local_adb="$workspace_root/.tools/android/platform-tools/adb"
if [ -x "$local_adb" ]; then
  adb_command="$local_adb"
elif command -v adb >/dev/null 2>&1; then
  adb_command="$(command -v adb)"
else
  echo "ADB is missing. Install Android Platform Tools first."
  exit 1
fi

device_count="$("$adb_command" devices | awk 'NR > 1 && $2 == "device" { count++ } END { print count+0 }')"
if [ "$device_count" -ne 1 ]; then
  echo "Connect exactly one authorized Android device with USB debugging enabled."
  "$adb_command" devices
  exit 1
fi

"$adb_command" reverse tcp:3001 tcp:3001
echo "USB tunnel ready: phone 127.0.0.1:3001 -> workstation 127.0.0.1:3001"
