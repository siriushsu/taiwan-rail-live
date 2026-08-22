#!/bin/bash
# 第二批突變:證明後補的 T2a-2(空轉迴圈)與 T3(原生沒回應)兩項判準有牙。
# 這兩項是發現「原本十項測不到修法 3」之後才補的,不自證有牙就跟原本的盲點同一個等級。
set -u
cd "$(dirname "$0")/.." || exit 1
ORIG_MD5=$(md5 -q index.html)
cp index.html /tmp/_wait_fix_orig2.html

run_mutation () {
  local name="$1" expect="$2" pyexpr="$3"
  cp /tmp/_wait_fix_orig2.html index.html
  python3 -c "$pyexpr" || { echo "突變 [$name] 套用失敗"; cp /tmp/_wait_fix_orig2.html index.html; return 1; }
  local out; out=$(timeout 600 node scripts/verify_metro_wait_start.mjs 2>&1 | tail -2)
  local failed; failed=$(echo "$out" | grep '^未過:' | sed 's/未過: //')
  echo "── 突變 [$name]"
  echo "   預期紅: $expect"
  echo "   實際紅: ${failed:-(全綠!判準沒有牙)}"
  cp /tmp/_wait_fix_orig2.html index.html
}

# M5 把 document.hidden 放回空轉迴圈條件 → 只有 T2a-2 應紅
run_mutation "空轉迴圈放回 document.hidden" "T2a-2" "
s=open('index.html').read()
old='      for (let i = 0; i < 66 && !state.ready; i++) {'
new='      for (let i = 0; i < 66 && (document.hidden || !state.ready); i++) {'
assert old in s
open('index.html','w').write(s.replace(old,new))
"

# M6 拿掉開卡的逾時包裝 → 只有 T3 應紅
run_mutation "開卡不設逾時" "T3" "
s=open('index.html').read()
old='  try { res = await metroWaitCall(p.start(payload)); }'
new='  try { res = await p.start(payload); }'
assert old in s
open('index.html','w').write(s.replace(old,new))
"

NEW_MD5=$(md5 -q index.html)
if [ "$ORIG_MD5" = "$NEW_MD5" ]; then echo "✅ index.html 已還原(md5 相符 $ORIG_MD5)"; else echo "🔴 還原失敗! $ORIG_MD5 -> $NEW_MD5"; fi
