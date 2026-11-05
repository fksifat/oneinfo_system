#!/usr/bin/env bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd)"
local_adb="$workspace_root/.tools/android/platform-tools/adb"
if [ -n "${ADB_PATH:-}" ]; then
  adb_command="$ADB_PATH"
elif [ -x "$local_adb" ]; then
  adb_command="$local_adb"
elif command -v adb >/dev/null 2>&1; then
  adb_command="$(command -v adb)"
else
  echo "ADB is missing. Install Android Platform Tools first."
  exit 1
fi

authorized_devices="$("$adb_command" devices | awk 'NR > 1 && $2 == "device" { print $1 }')"
selected_device="${ANDROID_SERIAL:-}"
if [ -z "$authorized_devices" ]; then
  echo "Connect an authorized Android device with USB debugging enabled."
  "$adb_command" devices
  exit 1
fi

if [ -n "$selected_device" ]; then
  found=false
  for candidate in $authorized_devices; do
    if [ "$candidate" = "$selected_device" ]; then found=true; fi
  done
  if [ "$found" != true ]; then echo "ANDROID_SERIAL is not an authorized connected device."; exit 1; fi
else
  physical_serial=""
  for candidate in $authorized_devices; do
    if [ -z "$selected_device" ]; then
      selected_device="$candidate"
    else
      if [ -z "$physical_serial" ]; then physical_serial="$("$adb_command" -s "$selected_device" shell getprop ro.serialno | tr -d '\r\n')"; fi
      candidate_serial="$("$adb_command" -s "$candidate" shell getprop ro.serialno | tr -d '\r\n')"
      if [ -z "$physical_serial" ] || [ "$physical_serial" != "$candidate_serial" ]; then
        echo "Multiple different phones detected. Set ANDROID_SERIAL to select one."
        exit 1
      fi
    fi
  done
fi

"$adb_command" -s "$selected_device" reverse tcp:3001 tcp:3001
"$adb_command" -s "$selected_device" reverse tcp:5174 tcp:5174
echo "USB tunnels ready: API port 3001 and local card pages port 5174. Run the Admin/customer app for activation pages."
