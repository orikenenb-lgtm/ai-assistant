#!/usr/bin/env bash
# Runs inside the CI emulator (a throwaway VM; never a real device or account):
#  1) instrumented tests, 2) installs the debug APK and walks the real UI (onboarding -> every bottom tab),
#  3) captures screenshots, 4) fails the job if the app crashed at any point.
# Small JPEG thumbnails are also printed to the log (between SHOT markers) so reviewers without artifact
# access can still inspect the UI. Full-size PNGs are uploaded as the "emulator-results-and-screenshots" artifact.
set -u
mkdir -p ci-screenshots
PKG=com.disciplineos.app.debug

./gradlew :app:connectedDebugAndroidTest --console=plain
TEST_STATUS=$?

adb install -r app/build/outputs/apk/debug/app-debug.apk
# Hebrew per-app locale (API 33+) so screenshots show the RTL UI.
adb shell cmd locale set-app-locales "$PKG" --locales he >/dev/null 2>&1 || true
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true
adb logcat -c

shot() {
  sleep "${2:-3}"
  adb exec-out screencap -p > "ci-screenshots/$1.png"
  if command -v convert >/dev/null 2>&1; then
    convert "ci-screenshots/$1.png" -resize 320x -quality 55 "ci-screenshots/$1.thumb.jpg"
    echo "SHOT_BEGIN:$1"; base64 -w0 "ci-screenshots/$1.thumb.jpg"; echo; echo "SHOT_END:$1"
  fi
}

# Tap the first on-screen element whose text or content-description equals $1 (via UI Automator dump).
tap_text() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || return 1
  adb pull /sdcard/ui.xml ci-screenshots/ui.xml >/dev/null 2>&1 || return 1
  local xy
  xy=$(python3 - "$1" <<'PY'
import re, sys, xml.etree.ElementTree as ET
target = sys.argv[1]
for n in ET.parse("ci-screenshots/ui.xml").iter("node"):
    if n.get("text") == target or n.get("content-desc") == target:
        m = re.findall(r"\d+", n.get("bounds", ""))
        if len(m) == 4:
            x1, y1, x2, y2 = map(int, m)
            print((x1 + x2) // 2, (y1 + y2) // 2)
            break
PY
)
  [ -n "$xy" ] || { echo "tap_text: '$1' not found"; return 1; }
  adb shell input tap $xy
}

adb shell am start -n "$PKG/com.disciplineos.app.MainActivity"
shot 01-onboarding 8
for i in 2 3 4 5 6; do
  if tap_text "בוא נתחיל"; then break; fi
  tap_text "הבא" || tap_text "דלג בינתיים" || true
  shot "0${i}-onboarding" 2
done
shot 10-dashboard 4
tap_text "משימות" && shot 11-tasks 3
tap_text "מיקוד" && shot 12-focus 3
tap_text "התקדמות" && shot 13-stats 3
tap_text "הגדרות" && shot 14-settings 3
tap_text "בית" && shot 15-dashboard-again 3

CRASH=0
if adb logcat -d -b crash | grep -q "$PKG"; then
  echo "APP CRASH DETECTED:"; adb logcat -d -b crash | tail -60; CRASH=1
fi
adb logcat -d | grep -E "FATAL EXCEPTION|AndroidRuntime" -A 25 | head -80 || true
adb shell am force-stop "$PKG"

if [ $TEST_STATUS -ne 0 ] || [ $CRASH -ne 0 ]; then exit 1; fi
exit 0
