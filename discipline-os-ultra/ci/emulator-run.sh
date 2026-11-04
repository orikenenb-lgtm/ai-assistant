#!/usr/bin/env bash
# Runs inside the CI emulator: instrumented tests, then installs the debug APK and captures real screenshots.
# The emulator is a throwaway VM; nothing here touches a real device or account.
set -u
mkdir -p ci-screenshots
adb shell settings put system system_locales iw-IL >/dev/null 2>&1 || true

./gradlew :app:connectedDebugAndroidTest --console=plain
TEST_STATUS=$?

APK=app/build/outputs/apk/debug/app-debug.apk
PKG=com.disciplineos.app.debug
adb install -r "$APK"
# Hebrew locale for the app (per-app language, API 33+), so screenshots show the RTL UI.
adb shell cmd locale set-app-locales "$PKG" --locales he >/dev/null 2>&1 || true
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true

shot() { sleep "${2:-3}"; adb exec-out screencap -p > "ci-screenshots/$1.png"; }

adb shell am start -n "$PKG/com.disciplineos.app.MainActivity"
shot 01-onboarding-welcome 8
# Advance the onboarding pager (RTL: next page is a right swipe on the content).
for i in 2 3 4 5; do
  adb shell input swipe 200 1200 900 1200 300
  shot "0${i}-onboarding-page" 2
done
adb shell input swipe 900 1200 200 1200 300
shot 06-onboarding-swipe-other-direction 2
adb shell am force-stop "$PKG"

exit $TEST_STATUS
