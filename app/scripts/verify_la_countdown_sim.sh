#!/bin/bash
# 跟車 Live Activity「到站倒數」自走驗收（iOS 模擬器，可重跑）
#
# 要證的事【不是】「卡片開得起來」，而是：
#   在【零推播、而且 App 已經被終止】的狀態下，鎖定畫面上的分鐘數會不會自己往下掉。
# 所以流程刻意是：起卡 → simctl terminate → 鎖屏 → 隔 65／60 秒各截一張。
# 只有這樣，t0/t1/t2 三個數字的差異才【只可能】來自系統自己重繪，
# 不可能來自 App 前景 update，也不可能來自伺服器推播。
#
# ── 三個非做不可的環境前提（每一條都是實際撞出來的，改掉就會得到假結果）──
# 1. 🔴 App 必須帶著 `aps-environment` 進模擬器，所以 build【不可以】關掉簽章。
#    plugin 用 `Activity.request(..., pushType: .token)`（RailLiveActivityPlugin.swift:99-103），
#    少了那個 entitlement，liveactivitiesd 直接回
#      「tw.railisland.app does not specify an APS environment name」，卡片【根本沒有建立】。
#    模擬器的 entitlement 不住在簽章裡，是連結期塞進二進位的 `__TEXT,__entitlements`
#    （`-Xlinker -sectcreate … App.app-Simulated.xcent`）⇒
#      · `CODE_SIGNING_ALLOWED=NO` ⇒ 那一段根本不會被塞進去 ⇒ 卡片開不了；
#      · 事後用 `codesign --force --sign - --entitlements` 補簽【救不了而且更糟】，
#        實測 App 直接 launch 不起來（RBSRequestErrorDomain 5 / NSPOSIXErrorDomain 163）。
#      · `codesign -d --entitlements -` 對模擬器 build 永遠印空的，不是證據；
#        要驗就驗 `__TEXT,__entitlements` 這一段（本腳本 install 的 gate 就是驗它）。
#    ⇒ build 一律【不帶任何簽章覆寫】：
#       xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug \
#         -sdk iphonesimulator -destination "id=$UDID" -derivedDataPath "$DD" ENABLE_PREVIEWS=NO build
#    失敗的樣子很惡毒：build 綠、App 跑得好好的、只有卡片安靜地不存在。
# 2. 🔴 跟車卡沒有深連結，而且 liveActivityAllowed() 要通行證資格 ⇒ 走 UI 開不了卡。
#    改注入模擬器容器內那份 index.html，直接呼叫 window.RAIL_NATIVE_LIVEACTIVITY.start(...)。
#    被繞過的只有「誰有資格開卡」，卡片怎麼畫仍然是出貨的原生程式碼。
# 3. 🔴 這台不能用 osascript 送 ⌘L 鎖屏（System Events 回 1002「不允許傳送按鍵」），
#    simctl 也沒有鎖屏指令 ⇒ 鎖屏這一步必須由呼叫端做，所以拆成 arm／shots 兩段。
#    呼叫端可用 Claude Code iOS Simulator MCP 的 `button LOCK`，或人工按 ⌘L。
#
# 用法：
#   app/scripts/verify_la_countdown_sim.sh install            # 重簽＋安裝已 build 好的 App.app
#   app/scripts/verify_la_countdown_sim.sh arm     <tag>      # 注入→重啟→開卡→驗卡片真的建立→終止 App
#   （呼叫端在這裡鎖屏）
#   app/scripts/verify_la_countdown_sim.sh shots   <tag>      # t0 / +65s t1 / +60s t2 三張截圖
#   app/scripts/verify_la_countdown_sim.sh restore            # 還原容器內的 index.html
#
# 環境變數：
#   SIM_UDID                模擬器 UDID（預設取第一台 booted）
#   DERIVED_DATA            xcodebuild 的 -derivedDataPath（install 用）
#   SHOT_DIR                截圖輸出目錄（預設 app/tmp/la-shots）
#   LA_ARRIVAL_OFFSET_SEC   到站＝現在＋這麼多秒（預設 960＝16 分；邊界情境用 75 與 -30）
#                           驗「保鮮期到期會自己脫困」用 90：arm 會印出到站與到期的絕對時刻，
#                           照它排 shots（LA_WAIT1／LA_WAIT2）截到期前後各一張
#   LA_DEPARTED_OFFSET_SEC  上一站發車＝現在＋這麼多秒（預設 -660）
#   LA_WAIT1 / LA_WAIT2     t0→t1、t1→t2 的間隔秒（預設 65 / 60）
set -euo pipefail

CMD="${1:-}"
TAG="${2:-run}"
BUNDLE=tw.railisland.app
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOT_DIR="${SHOT_DIR:-$HERE/../tmp/la-shots}"
UDID="${SIM_UDID:-$(xcrun simctl list devices booted -j | /usr/bin/python3 -c 'import json,sys;d=json.load(sys.stdin)["devices"];print(next(x["udid"] for v in d.values() for x in v))')}"

ARR="${LA_ARRIVAL_OFFSET_SEC:-960}"
DEP="${LA_DEPARTED_OFFSET_SEC:--660}"
W1="${LA_WAIT1:-65}"
W2="${LA_WAIT2:-60}"

mkdir -p "$SHOT_DIR"
shot() {
  xcrun simctl io "$UDID" screenshot "$SHOT_DIR/${TAG}_$1.png" >/dev/null 2>&1
  echo "[harness] shot ${TAG}_$1.png"
}

case "$CMD" in

install)
  DD="${DERIVED_DATA:?請設 DERIVED_DATA=<xcodebuild 的 -derivedDataPath>}"
  APP="$DD/Build/Products/Debug-iphonesimulator/App.app"
  [ -d "$APP" ] || { echo "找不到 $APP，先跑 xcodebuild"; exit 1; }
  # 前提 1 的 gate：驗連結期塞進去的 __TEXT,__entitlements 有沒有 aps-environment。
  # 沒有就停手——否則之後量到的「卡片沒出現」會被誤讀成產品缺陷。
  for exe in "$APP/App" "$APP/PlugIns/RailBoardWidgetExtension.appex/RailBoardWidgetExtension"; do
    /usr/bin/python3 - "$exe" <<'PY' || exit 1
import re, subprocess, sys
exe = sys.argv[1]
out = subprocess.run(["otool", "-X", "-s", "__TEXT", "__entitlements", exe],
                     capture_output=True, text=True).stdout
words = []
for line in out.splitlines():
    p = line.split()
    if len(p) >= 2 and re.fullmatch(r'[0-9a-f]{8,16}', p[0]):
        words += p[1:]
# otool 印的是小端 4-byte word ⇒ 逐字反轉才是原文
blob = b"".join(bytes.fromhex(w)[::-1] for w in words if re.fullmatch(r'[0-9a-f]{8}', w))
txt = blob.decode("utf-8", "replace")
name = exe.rsplit("/", 1)[-1]
if "aps-environment" not in txt:
    print(f"[harness] ✗ {name} 的 __TEXT,__entitlements 沒有 aps-environment"
          f"——build 是不是帶了 CODE_SIGNING_ALLOWED=NO / CODE_SIGN_IDENTITY 覆寫？")
    sys.exit(1)
print(f"[harness] ✓ {name} 帶有 aps-environment"
      f"{'＋app-group' if 'application-groups' in txt else ''}")
PY
  done
  xcrun simctl uninstall "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
  xcrun simctl install "$UDID" "$APP"
  echo "[harness] installed"
  ;;

arm)
  APPDIR="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" app)"
  IDX="$APPDIR/public/index.html"
  [ -f "$IDX" ] || { echo "找不到 $IDX"; exit 1; }
  # 只保留一份原稿；重跑先還原，否則注入層層疊加、第二輪起分不清跑的是哪一版。
  if [ -f "$IDX.orig" ]; then cp "$IDX.orig" "$IDX"; else cp "$IDX" "$IDX.orig"; fi
  echo "[harness] udid=$UDID tag=$TAG arrival=+${ARR}s departed=${DEP}s"
  echo "[harness] bundle=$APPDIR"
  echo "[harness] web $(grep -o "BUILD *= *'[^']*'" "$IDX" | head -1) index.md5=$(md5 -q "$IDX")"

  /usr/bin/python3 - "$IDX" "$ARR" "$DEP" <<'PY'
import sys, io
path, arr, dep = sys.argv[1], sys.argv[2], sys.argv[3]
# payload 欄位以 RailLiveActivityPlugin.swift:46-60,82-121 為準（notice 刻意不帶，那是後端欄位）。
snippet = """
<script>
// ── 驗收注入（verify_la_countdown_sim.sh）：直接開一張跟車 Live Activity ──
(function () {
  var ARR = %s, DEP = %s, tries = 0;
  function iso(off) { return new Date(Date.now() + off * 1000).toISOString(); }
  function go() {
    // 🔴 不要等 window.load：首次安裝時 146MB bundle 的 load 事件可能拖過一分鐘
    //    （首訪教學卡＋定位授權對話框期間資源還在載），等它就會量到「卡片沒開成」的假紅。
    //    橋接物件由 native-bridge.js 同步建立，一到手就開卡。
    var api = window.RAIL_NATIVE_LIVEACTIVITY;
    if (!api) { if (++tries < 600) return setTimeout(go, 100); console.log('[LAHARNESS] no bridge'); return; }
    var p = {
      key: 'harness', trainNo: '0625', kind: '高鐵', sys: 'thsr_sched', color: '#F27300',
      terminus: '左營', nextStop: '台中', prevStop: '新竹',
      arrivalIso: iso(ARR), departedIso: iso(DEP), delaySec: 0, stopping: false,
    };
    // 🔴 先收掉等車卡（RailMetroWait）再開跟車卡。兩張 Live Activity 並存時鎖定畫面會把
    //    它們【疊成一落】，只有最上面那張看得到內容 —— 而 App 一啟動就會自動恢復等車卡，
    //    於是整輪觀測拍到的全是等車卡，跟車卡只露出一條邊。實際踩過：
    //    07:17:22 App[44122] 建 MetroWaitAttributes → 07:17:59 App[44838] 建 RailFollowAttributes
    //    ⇒ t0/t1 兩張截圖都是「板南線 龍山寺 10 分」，跟這支腳本要驗的東西毫無關係。
    //    stop() 失敗不擋流程（可能本來就沒在等車），但要把結果印出來，否則下次又是靜默的假結果。
    var mw = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RailMetroWait;
    var pre = mw ? Promise.resolve(mw.stop()).then(
                     function (r) { console.log('[LAHARNESS] metrowait.stop ' + JSON.stringify(r)); },
                     function (e) { console.log('[LAHARNESS] metrowait.stop failed ' + e); })
                 : Promise.resolve(console.log('[LAHARNESS] metrowait bridge 不存在，略過'));
    pre.then(function () {
      console.log('[LAHARNESS] start ' + JSON.stringify(p));
      return Promise.resolve(api.start(p))
        .then(function (r) { console.log('[LAHARNESS] result ' + JSON.stringify(r)); })
        .catch(function (e) { console.log('[LAHARNESS] failed ' + e); });
    });
  }
  setTimeout(go, 500);
})();
</script>
</body>"""  % (arr, dep)
src = io.open(path, encoding='utf-8').read()
i = src.rfind('</body>')
if i < 0: raise SystemExit('index.html 裡找不到 </body>，注入點不存在')
io.open(path, 'w', encoding='utf-8').write(src[:i] + snippet + src[i + len('</body>'):])
print('[harness] injected at </body>')
PY

  # 卡片建立與否的觀測管道：先開 realtime log stream 再啟動 App。
  # 🔴 不可以用 `log show --start`：(a) 它吃【本機時間】，給 UTC 會往前多撈八小時；
  #    (b) 模擬器整機 log 一分鐘 200MB 以上，不下 predicate 每輪 dump 十幾秒；
  #    (c) 最毒的是——log store 有數十秒的落地延遲，request 明明發生了 `log show` 還讀不到
  #        ⇒ gate 先超時，把「環境還沒同步」誤判成「卡片沒開成」（實測踩到兩次）。
  #    log stream 是即時的，沒有這三個問題。
  STREAM_LOG="$(mktemp -t la_arm_log)"
  xcrun simctl spawn "$UDID" log stream --style compact \
    --predicate 'process == "App" OR process == "liveactivitiesd"' > "$STREAM_LOG" 2>/dev/null &
  STREAM_PID=$!
  # 只收自己起的那顆 PID（絕不用行程名比對去殺別人的東西）
  trap 'kill "$STREAM_PID" 2>/dev/null || true' EXIT
  sleep 3

  # 乾淨重啟（模擬器 stale-restore：launch 對既存行程只是帶到前景，boot 不重跑）
  xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
  sleep 1
  xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
  echo "[harness] launched，等卡片建立…"

  # gate：卡片真的建立了嗎？沒建立就停手——不要讓「卡片不存在」偽裝成「倒數不會動」。
  ok=0
  for i in $(seq 1 24); do
    sleep 5
    if grep -q "does not specify an APS environment name" "$STREAM_LOG"; then
      echo "[harness] ✗ entitlement 缺 aps-environment ⇒ 卡片沒建立。先跑 install 再重來。"; exit 1
    fi
    if grep -q "Requesting an activity.*RailFollowAttributes" "$STREAM_LOG"; then ok=1; break; fi
  done
  [ "$ok" = 1 ] || { echo "[harness] ✗ 120 秒內沒看到 RailFollowAttributes 的 activity request，卡片沒開成"; exit 1; }
  echo "[harness] ✓ ActivityKit 收到 RailFollowAttributes 的 request"

  # 卡片的【絕對】到站時刻。沒有它就排不出「保鮮期到期之後」要在什麼時候截圖——而那正是
  # 唯一問得出「零推播的卡會不會自己脫困」的時點（到站之後、下一發推播永遠不來的那一段，
  # 卡片停在「0 秒／行駛中」，要等 staleDate 到期讓系統重繪一次才會換成「資料未更新」）。
  # 🔴 寬限直接讀出貨程式碼那一顆共享常數，不在這裡抄一份數字：抄了就會有一天對不上，
  #    而對不上的症狀是「截圖時機差幾秒」——看起來像修法沒生效。
  GRACE="$(grep -oE 'static let graceSeconds: Double = [0-9.]+' \
    "$HERE/../ios/App/App/RailFollowAttributes.swift" 2>/dev/null | grep -oE '[0-9.]+$' | head -1)"
  /usr/bin/python3 - "$STREAM_LOG" "${GRACE:-}" <<'PY'
import io, re, sys, time, datetime
log, grace = sys.argv[1], sys.argv[2]
if not grace:
    print("[harness] ⚠ 讀不到 RailFollowStale.graceSeconds（檔案搬家或改名？）——"
          "不印時刻表，請自行確認寬限值再排截圖時點")
    raise SystemExit(0)
grace = float(grace)
txt = io.open(log, encoding='utf-8', errors='replace').read()
m = re.search(r'"arrivalIso":"([^"]+)"', txt)
if not m:
    print("[harness] ⚠ log 裡抓不到 arrivalIso（webview 的 console 沒被轉發到 os_log？）——"
          "請改以「arm 結束時刻＋LA_ARRIVAL_OFFSET_SEC」估算截圖時點")
    raise SystemExit(0)
iso = m.group(1)
t = datetime.datetime.strptime(iso.replace("Z", "+0000"), "%Y-%m-%dT%H:%M:%S.%f%z").timestamp()
now = time.time()
fmt = lambda x: time.strftime("%H:%M:%S", time.localtime(x))
print(f"[harness] 到站 {fmt(t)}（{t - now:+.0f} 秒）")
print(f"[harness] 保鮮期到期 arrival+{grace:.0f}s = {fmt(t + grace)}（{t + grace - now:+.0f} 秒）")
print(f"[harness] ⇒ 驗「零推播也會自己脫困」：{fmt(t + grace)} 之後截的那張應該是「資料未更新」；"
      f"{fmt(t)}～{fmt(t + grace)} 之間那張則應該還是倒數（那一段正是舊碼會永遠停住的畫面）")
PY
  sleep 3
  shot di0     # 解鎖態（動態島 compact）

  # 🔴 關鍵：殺掉 App。Live Activity 留在系統上，之後不可能再有任何本機 update。
  xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
  echo "[harness] App 已終止（之後零本機更新）。請鎖屏，再跑：$0 shots $TAG"
  ;;

shots)
  shot t0
  sleep "$W1"; shot t1
  sleep "$W2"; shot t2
  # 🔴 ${} 不可省：後面緊接全形「（」，裸 $SHOT_DIR 會把那個多位元組字元的頭一個 byte
  #    吃進變數名，在 set -u 下變成 "SHOT_DIR?: unbound variable" 而讓整支腳本在最後一行失敗。
  echo "[harness] 三張截圖完成，在 ${SHOT_DIR}（前綴 ${TAG}_）"
  ;;

restore)
  APPDIR="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" app)"
  [ -f "$APPDIR/public/index.html.orig" ] && cp "$APPDIR/public/index.html.orig" "$APPDIR/public/index.html"
  echo "[harness] index.html 已還原"
  ;;

*)
  sed -n '2,40p' "${BASH_SOURCE[0]}"
  exit 1
  ;;
esac
