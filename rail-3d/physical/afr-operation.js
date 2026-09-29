// 機車所在端固定，推／拉隨行進方向改變；不是依瞬間坡度或車次奇偶翻轉。
// 查核來源與適用範圍：docs/afr-push-pull-0913.md。
const main = ['嘉義','北門','鹿麻產','竹崎','木履寮','樟腦寮','獨立山','梨園寮','交力坪','水社寮','奮起湖','多林','十字路','屏遮那','第一分道','第二分道','二萬平','神木','阿里山'];
const branches = [['阿里山','沼平','對高岳','祝山']];
const turns = new Set(['第一分道','第二分道','神木']);

export function afrInitialFacing(tr) {
  if ((tr.sys || tr.system) !== 'afr_sched') return 1;
  const [a,b] = (tr.stops || []).filter(s => !s._pass).slice(0,2).map(s => s.name);
  for (const line of [main,...branches]) {
    const from=line.indexOf(a),to=line.indexOf(b);
    if(from<0 || to<0 || from===to)continue;
    // 第一段所在的之字形區間。main 正序通常由車尾推進；過分道後交替。
    const forward=to>from,segment=forward?from:from-1;
    const reversals=line===main?line.slice(0,segment+1).filter(n=>turns.has(n)).length:0;
    return (forward?-1:1)*(reversals%2?-1:1);
  }
  return null; // 新路線／未知起點不可推論；驗收要求目前名冊與動態祝山班次全有依據。
}
