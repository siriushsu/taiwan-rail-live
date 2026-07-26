#!/bin/sh
#
# Xcode Cloud — clone 後的前置腳本
#
# 為什麼需要它：軌島的 iOS 殼是 Capacitor 專案，git 裡只有原生殼本體，
# 網頁素材（App/public）、CocoaPods（Pods/）與機密檔都不進版控，必須在 CI 現場產生。
#
# 需要在 Xcode Cloud 工作流程的「環境變數」設定以下五個，全部勾「密碼」：
#   STADIA_API_KEY                  repo 根 .env 的同名值
#   ESRI_API_KEY                    repo 根 .env 的同名值
#   RAIL_RELEASE_POLICY_B64         base64 -i app/release-policy.json
#   RAIL_MUSIC_CHECKLIST_B64        base64 -i app/MUSIC_LICENSE_CHECKLIST.md
#   GOOGLE_SERVICE_INFO_PLIST_B64   base64 -i app/ios/App/App/GoogleService-Info.plist
#
set -eu

REPO="$CI_PRIMARY_REPOSITORY_PATH"
APP="$REPO/app"

echo "==> 還原機密檔"
printf 'STADIA_API_KEY=%s\nESRI_API_KEY=%s\n' "$STADIA_API_KEY" "$ESRI_API_KEY" > "$REPO/.env"
printf '%s' "$RAIL_RELEASE_POLICY_B64" | base64 --decode > "$APP/release-policy.json"
# 音樂授權核對表：build:release 自 2026-07-26 起含 RAIL_INCLUDE_LICENSED_MUSIC=1，
# 發行閘門會讀這份核對 29 首曲目，沒還原就會 ENOENT 中斷。
printf '%s' "$RAIL_MUSIC_CHECKLIST_B64" | base64 --decode > "$APP/MUSIC_LICENSE_CHECKLIST.md"
printf '%s' "$GOOGLE_SERVICE_INFO_PLIST_B64" | base64 --decode > "$APP/ios/App/App/GoogleService-Info.plist"

echo "==> 安裝工具鏈"
command -v node >/dev/null 2>&1 || brew install node
command -v pod  >/dev/null 2>&1 || brew install cocoapods

echo "==> 建置網頁素材（含授權底圖）"
cd "$APP"
npm ci
npm run build:release

echo "==> 授權閘門"
npm run verify

echo "==> 同步進原生專案（含 pod install）"
# cap sync 對非 UTF-8 locale 會炸，必須指定
LANG=en_US.UTF-8 npx cap sync ios

echo "==> 授權閘門（同步後複驗）"
# 為什麼要跑第二次：乾淨 clone 沒有 App/public，上面那次 verify 的「原生內嵌資產一致性」
# 檢查會因為讀不到檔案而略過——也就是 CI 從來沒有真的驗過打包進 IPA 的那份網頁。
# cap sync 之後 App/public 才存在，這次才驗得到；漏了它，iOS 帶舊版網頁也會綠燈通過。
# RAIL_REQUIRE_NATIVE=1：這次不准再因為「檔案不存在」而略過，讀不到就是失敗。
RAIL_REQUIRE_NATIVE=1 npm run verify

echo "==> ci_post_clone 完成"
