#!/bin/bash
# 突變測試:把每一條修法各自改壞一次,確認 verify_metro_wait_start.mjs 紅在預期的那幾項。
# 全綠不等於判準有牙(judgment 心得 35/37)——沒有這一步就不知道測法能不能抓到回歸。
set -u
cd "$(dirname "$0")/.." || exit 1
ORIG_MD5=$(md5 -q index.html)
cp index.html /tmp/_wait_fix_orig.html

run_mutation () {
  local name="$1" expect="$2" pyexpr="$3"
  cp /tmp/_wait_fix_orig.html index.html
  python3 -c "$pyexpr" || { echo "突變 [$name] 套用失敗"; cp /tmp/_wait_fix_orig.html index.html; return 1; }
  local out; out=$(timeout 480 node scripts/verify_metro_wait_start.mjs 2>&1 | tail -2)
  local failed; failed=$(echo "$out" | grep '^未過:' | sed 's/未過: //')
  echo "── 突變 [$name]"
  echo "   預期紅: $expect"
  echo "   實際紅: ${failed:-(全綠!判準沒有牙)}"
  cp /tmp/_wait_fix_orig.html index.html
}

# M1 拿掉時鐘閘門自救 → T1b/T1c 應紅
run_mutation "拿掉時鐘閘門自救" "T1b, T1c" "
import re
s=open('index.html').read()
old=\"  if (sys === 'trtc' && !sourceBundle && !trtcOfficialBoardRealNow()) {\n    jumpToNow();\n    showToast('已把時間帶回「現在」才能追蹤這站');\n  }\n\"
assert old in s
open('index.html','w').write(s.replace(old,''))
"

# M2 拿掉背景擋下 → 背景會直接呼叫 start,T2a/T2b-2 應紅
run_mutation "拿掉背景擋下" "T2a, T2b-2" "
s=open('index.html').read()
old='  if (document.hidden) {\n    _mwPendingOpen = { sys, station: st && st.name, dest, durationMin, at: Date.now() };\n    return;\n  }\n'
assert old in s
open('index.html','w').write(s.replace(old,''))
"

# M3 回前景不補開 → T2b 應紅
run_mutation "回前景不補開" "T2b" "
s=open('index.html').read()
old='    metroWaitFlushPending();   // 背景期間被擋下的開卡請求,回前景補開(見 _mwPendingOpen)\n'
assert old in s
open('index.html','w').write(s.replace(old,''))
"

# M4 待辦不看保鮮期 → 過期也補開,T2c 應紅
run_mutation "待辦不看保鮮期" "T2c" "
s=open('index.html').read()
old='  if (Date.now() - pend.at > MW_PENDING_OPEN_MAX_MS) return;'
assert old in s
open('index.html','w').write(s.replace(old,'  if (false) return;'))
"

NEW_MD5=$(md5 -q index.html)
if [ "$ORIG_MD5" = "$NEW_MD5" ]; then echo "✅ index.html 已還原(md5 相符 $ORIG_MD5)"; else echo "🔴 還原失敗! $ORIG_MD5 -> $NEW_MD5"; fi
