#!/bin/zsh
# 車站收集 Android 小工具的裝置端算圖：產案例 → 建置（獨立 applicationId tw.railisland.app.cwtest，
# 不動裝置上原本的 tw.railisland.app）→ 安裝 → 推案例 → 跑 CollectionWidgetInstrumentedTest 與 CollectionDataInstrumentedTest → 拉回 obs.json 與 PNG。
# TESTCLASS=<類別全名，逗號分隔> 可只跑指定的類別。
# 之後跑 node app/scripts/verify_android_collect_widget.mjs 從 payload 獨立重算期望值比對。
#
# 用法：ANDROID_SERIAL=<你自己的模擬器> zsh app/scripts/android-collect-widget/run.sh [skip-build]
# 🔴 一定要指名自己的裝置：同一台機器常有別的 session 的模擬器或真機在跑，不指名會打到別人的。
#    起一台自己的無視窗模擬器：emulator -avd <名稱> -read-only -no-window -no-audio -port <沒人用的埠>
# 輸出都在 tmp/collect-widget/android/（已被忽略）：cases/、out/collect-out/、gradle-run.log、instr-run.log。
set -u
HERE=${0:A:h}
ROOT=${HERE:h:h:h}
OUT=$ROOT/tmp/collect-widget/android
P=tw.railisland.app.cwtest
[[ -z "${ANDROID_SERIAL:-}" ]] && { echo "請用 ANDROID_SERIAL 指名你自己的裝置（先 adb devices 確認是你的）"; exit 64; }
: ${ANDROID_HOME:=$HOME/Library/Android/sdk}
: ${JAVA_HOME:=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}
export ANDROID_HOME JAVA_HOME
a() { $ANDROID_HOME/platform-tools/adb -s $ANDROID_SERIAL "$@"; }
mkdir -p $OUT
python3 $HERE/gen_cases.py $OUT/cases || exit 1
if [[ "${1:-}" != skip-build ]]; then
  (cd $ROOT/app/android && ./gradlew -PrailApplicationId=$P -PrailSkipGoogleServices=true :app:assembleDebug :app:assembleDebugAndroidTest > $OUT/gradle-run.log 2>&1)
  rc=$?
  echo "GRADLE_RC=$rc"
  [[ $rc -ne 0 ]] && { grep -a -n "error:\|FAILED" $OUT/gradle-run.log | head -20; exit 1; }
  a install -r -t $ROOT/app/android/app/build/outputs/apk/debug/app-debug.apk 2>&1 | tail -1
  a install -r -t $ROOT/app/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk 2>&1 | tail -1
fi
a shell "rm -rf /data/local/tmp/cw-cases && mkdir -p /data/local/tmp/cw-cases"
a push $OUT/cases/. /data/local/tmp/cw-cases/ > /dev/null || exit 1
a shell "run-as $P sh -c 'rm -rf files/collect-cases && mkdir -p files/collect-cases && cp /data/local/tmp/cw-cases/* files/collect-cases/'"
# 預設跑兩個類別：CollectionWidgetInstrumentedTest（算圖觀察，給預言機）與 CollectionDataInstrumentedTest（解碼／過濾單元測試，自帶期望值）。
a shell am instrument -w -e class ${TESTCLASS:-tw.railisland.app.CollectionWidgetInstrumentedTest,tw.railisland.app.CollectionDataInstrumentedTest} $P.test/androidx.test.runner.AndroidJUnitRunner > $OUT/instr-run.log 2>&1
tail -5 $OUT/instr-run.log
grep -a -q "^OK (" $OUT/instr-run.log || { echo "INSTRUMENT FAILED"; head -60 $OUT/instr-run.log; exit 2; }
rm -rf $OUT/out/collect-out
mkdir -p $OUT/out
a exec-out "run-as $P tar -cf - -C files collect-out" | tar -x -C $OUT/out
echo "pulled $(ls $OUT/out/collect-out | wc -l | tr -d ' ') files → $OUT/out/collect-out"
