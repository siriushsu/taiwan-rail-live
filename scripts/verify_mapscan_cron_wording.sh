#!/bin/bash
# 驗 cron 殼的三種紅措辭與「崩潰原因進得了日誌」。
# 全程在假樹裡跑:HOME 指到 temp(日誌/明細落在那)、PATH 前置一個假 osascript(把通知標題寫檔,
# 不真的彈通知)、掃描器換成可控替身。真 git 一概碰不到。
set -uo pipefail
SRC="$1"                       # 已 patch 的 scan_map_health_cron.sh
BASE="$(mktemp -d)"
TREE="$BASE/tree"; FAKEHOME="$BASE/home"; BIN="$BASE/bin"
mkdir -p "$TREE/scripts" "$FAKEHOME" "$BIN"
cp "$SRC" "$TREE/scripts/scan_map_health_cron.sh"

cat > "$BIN/osascript" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "$NOTIFY_LOG"
EOF
chmod +x "$BIN/osascript"

# manifest 兩支替身:預設綠
printf 'process.exit(0)\n' > "$TREE/scripts/verify_data_manifest.mjs"
printf 'process.exit(0)\n' > "$TREE/scripts/verify_data_provenance.mjs"

NODE_REAL="$(command -v node)"
export NOTIFY_LOG="$BASE/notify.txt"; : > "$NOTIFY_LOG"

# 掃描器替身。crash=丟未捕捉例外(模擬 MapLibre 那次);green=印七條判準後 exit 0
scanner() {
  if [ "$1" = crash ]; then
    cat > "$TREE/scripts/scan_map_health.mjs" <<'EOF'
console.log('【掃描】https://railisland.tw/');
throw new Error('page.evaluate: Error: Invalid LngLat latitude value: must be between -90 and 90');
EOF
  else
    cat > "$TREE/scripts/scan_map_health.mjs" <<'EOF'
console.log('✅ 幽靈車：沒有方向與終點矛盾的車');
console.log('✅ 全部在門檻內｜警告 0 項');
process.exit(0);
EOF
  fi
}

run() { HOME="$FAKEHOME" PATH="$BIN:$PATH" NODE_BIN="$NODE_REAL" TRTC_SCAN_URL=http://x/ \
        bash "$TREE/scripts/scan_map_health_cron.sh" >/dev/null 2>&1; }

LOG="$FAKEHOME/.railisland-mapscan.log"
fails=0
chk() { # 名稱, 該出現的字串, 檔案
  if grep -qF "$2" "$3"; then echo "PASS  $1"; else echo "FAIL  $1  (找不到「$2」)"; fails=$((fails+1)); fi
}
nochk() { if grep -qF "$2" "$3"; then echo "FAIL  $1  (不該出現「$2」)"; fails=$((fails+1)); else echo "PASS  $1"; fi }

echo "── T1 掃描器當機三輪:原因要進日誌,標題要說是巡檢自己掛了,連續輪數要遞增 ──"
scanner crash; run; run; run
chk "T1a 崩潰原因進了日誌"      "Invalid LngLat latitude value" "$LOG"
chk "T1b 標題改口:巡檢自己掛了" "巡檢自己掛了" "$NOTIFY_LOG"
nochk "T1c 不再誤稱偵測到異常"   "偵測到異常" "$NOTIFY_LOG"
chk "T1d 連續輪數數到 3"        "連續 3 輪" "$LOG"

echo "── T2 掃描器恢復正常:連續計數歸零,且不發通知 ──"
: > "$NOTIFY_LOG"; scanner green; run
chk  "T2a 判準行進了日誌"   "全部在門檻內" "$LOG"
nochk "T2b 綠的一輪不發通知" "軌島地圖巡檢" "$NOTIFY_LOG"
if [ "$(cat "$FAKEHOME/.railisland-mapscan/.no-verdict-streak")" = "0" ]; then echo "PASS  T2c 連續計數歸零"; else echo "FAIL  T2c 連續計數沒歸零"; fails=$((fails+1)); fi

echo "── T3 迴歸:掃描器綠但 manifest 紅,措辭必須維持原本的「偵測到異常」──"
: > "$NOTIFY_LOG"; printf 'process.exit(1)\n' > "$TREE/scripts/verify_data_manifest.mjs"; run
chk "T3a 仍是偵測到異常"        "偵測到異常" "$NOTIFY_LOG"
nochk "T3b 不可誤報成巡檢掛了"  "巡檢自己掛了" "$NOTIFY_LOG"

echo
[ "$fails" -eq 0 ] && echo "全綠（$BASE）" || echo "$fails 項未過（$BASE）"
exit "$fails"
