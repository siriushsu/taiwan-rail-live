#!/bin/sh
#
# Xcode Cloud — 建置前腳本：釘死 build 號
#
# 為什麼需要它：App Store Connect 的 build 號只進不退、用過就永久燒掉，
# 撞號時 Xcode 會回報成「網路連線中斷」之類的假象（實為 409 duplicate）。
# Xcode Cloud 的 CI_BUILD_NUMBER 從 1 起算，但 Apple 端已經燒到 8，
# 因此加 BASE 位移確保恆高於既有值，且隨每次 CI 單調遞增。
#
set -eu

BASE=100
BUILD_NUM=$(( ${CI_BUILD_NUMBER:-0} + BASE ))

cd "$CI_PRIMARY_REPOSITORY_PATH/app/ios/App"
sed -i '' "s/CURRENT_PROJECT_VERSION = .*;/CURRENT_PROJECT_VERSION = ${BUILD_NUM};/g" \
  App.xcodeproj/project.pbxproj

echo "==> build 號設為 ${BUILD_NUM}"
grep -c "CURRENT_PROJECT_VERSION = ${BUILD_NUM};" App.xcodeproj/project.pbxproj
