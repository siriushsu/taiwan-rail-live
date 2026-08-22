#!/bin/bash
# 地圖動畫定時巡檢（2026-08-17 使用者要求：「需要有一個定時掃過的機制，確認地圖上的動畫
# 是否正常，若有問題才能及時重置」）。由 launchd 每小時叫一次，見
# ~/Library/LaunchAgents/com.sirius.railisland.mapscan.plist
#
# 刻意只告警不自動重置：重置＝清掉 D1 的 official_roster_v4 讓它冷啟動，那會把全線的
# 車重排一次，是有代價的動作。要不要重置該由人看過明細再決定，不是掃描器自己決定。
#
# 營運時段判斷放在排程層（plist 只掛 06–23 點），掃描器本身保持單純：它對「畫面零台車」
# 一律回 2，那在收班後是正常的、不該變成每天半夜一次的假警報。
set -uo pipefail

# 不依賴呼叫端的 cwd（launchd 給的 cwd 是 /）
cd "$(dirname "$0")/.." || exit 2
ROOT="$(pwd)"

URL="${TRTC_SCAN_URL:-https://railisland.tw/}"
LOG="$HOME/.railisland-mapscan.log"
OUTDIR="$HOME/.railisland-mapscan"
mkdir -p "$OUTDIR"
STAMP="$(date +%Y%m%d-%H%M)"
JSON="$OUTDIR/$STAMP.json"

# node 走絕對路徑：launchd 給的 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin，找不到 /usr/local/bin/node
NODE="${NODE_BIN:-/usr/local/bin/node}"
[ -x "$NODE" ] || NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  printf '%s exit=2 找不到 node\n' "$(date '+%F %T')" >> "$LOG"; exit 2
fi

# 🔴 追 main。2026-08-17 實測發現這裡原本**完全沒有 pull**：巡檢樹停在 e72553d，當天下午
# 之後的四項判準改動一項都沒生效——包含唯一能抓到「整批官方資料停更、畫面照舊快照繼續演」
# 的第七條（那個狀態實測可持續 148 秒，而其餘六條判準全綠），以及倒退門檻的解析度地板
# （一像素＝69m 遠大於舊門檻 15m ⇒ 會誠實地誤報倒退）。而日誌看起來一切正常。
# ＝心得 32 的重演：巡檢跑到釘死的舊樹，全綠驗的是舊檔案。
# ff-only：這棵樹若有本機未推的 commit 就不硬併，記一行警告、照舊跑手上這版，不要靜默失敗。
if ! { git -C "$ROOT" fetch --quiet origin 2>/dev/null && \
       git -C "$ROOT" merge --ff-only --quiet origin/main 2>/dev/null; }; then
  printf '%s ⚠️ 巡檢樹沒能追上 origin/main，跑的是 %s\n' "$(date '+%F %T')" \
    "$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')" >> "$LOG"
fi

# manifest 閘門（2026-08-22）：捷運快照同步曾兩次動了 data/ 沒重產 manifest（6e515e4、a7fbe17），
# 閘門紅著躺在 main 上沒人看得到——它不在任何 cron 也不在 hook。這裡是唯一每小時醒來的地方，
# 掛在 ff-only 之後＝驗的就是 origin/main 現況。本地純雜湊、零網路，斷網時它的紅仍可信。
# 綠也要印一行（「沒發現」不能跟「沒跑」長一樣）；紅不擋地圖掃描——兩者是獨立維度。
MANI_OUT="$("$NODE" "$ROOT/scripts/verify_data_manifest.mjs" 2>&1 && "$NODE" "$ROOT/scripts/verify_data_provenance.mjs" 2>&1)"
MANI_CODE=$?

# 網路類失敗不是產品異常。2026-08-17 17:20 實例：本機網路斷一下 ⇒ page.goto 拋
# ERR_INTERNET_DISCONNECTED ⇒ node 未捕捉例外 ⇒ exit=1 ⇒ 通知標題寫「偵測到異常」。
# 假警報會磨掉告警本身的可信度（同族教訓：北捷斷訊徽章量錯對象也是假警報）。
# ⇒ 重試一次；仍是網路類失敗就回 2（「掃描沒跑起來」），不冒充產品異常。
NETFAIL='net::ERR_|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_|ERR_TIMED_OUT|getaddrinfo'
# 尾端不接管道，保留真實離開碼（管道會把它換成最後一段的）
OUT="$("$NODE" "$ROOT/scripts/scan_map_health.mjs" "$URL" --json "$JSON" --gap 25 2>&1)"
CODE=$?
if [ "$CODE" -ne 0 ] && printf '%s' "$OUT" | grep -qE "$NETFAIL"; then
  sleep 30
  OUT="$("$NODE" "$ROOT/scripts/scan_map_health.mjs" "$URL" --json "$JSON" --gap 25 2>&1)"
  CODE=$?
  if [ "$CODE" -ne 0 ] && printf '%s' "$OUT" | grep -qE "$NETFAIL"; then CODE=2; fi
fi

if [ "$MANI_CODE" -ne 0 ]; then
  OUT="${OUT}
❌ manifest 閘門紅：main 的 data/ 與清單不同步（改 data/ 那輪要跑 npm run build-manifest；紅行見明細）
${MANI_OUT}"
  CODE=1  # 本地雜湊的紅是可信異常，優先於「掃描沒跑起來」
else
  OUT="${OUT}
✅ manifest 閘門一致"
fi

SUMMARY="$(printf '%s\n' "$OUT" | grep -E '^[✅❌]' | tr '\n' ' ')"
printf '%s exit=%s %s\n' "$(date '+%F %T')" "$CODE" "$SUMMARY" >> "$LOG"

# 只留最近 200 份明細，其餘刪掉（每小時一份，約八天）
ls -1t "$OUTDIR"/*.json 2>/dev/null | tail -n +201 | while read -r f; do rm -f "$f"; done

if [ "$CODE" -ne 0 ]; then
  # 全文留檔，通知只帶一行——通知欄放不下，也不該逼人在通知裡讀明細
  printf '%s\n' "$OUT" > "$OUTDIR/last-failure.txt"
  TITLE="軌島地圖巡檢：$([ "$CODE" = 2 ] && echo '掃描沒跑起來' || echo '偵測到異常')"
  MSG="$(printf '%s\n' "$OUT" | grep -E '^❌' | head -2 | tr '\n' ' ')"
  osascript -e "display notification \"${MSG//\"/}\" with title \"${TITLE}\" sound name \"Basso\"" >/dev/null 2>&1
fi

exit "$CODE"
