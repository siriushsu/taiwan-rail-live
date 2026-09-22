// 林業署公開說明的四處之字形爬升點；僅限同一來源節點、同股反向。
// https://recreation.forest.gov.tw/Railway/Introduce
export const AFR_TURNBACKS=new Set(['第一分道','第二分道','神木','阿里山']);
export function isScheduledTurnback(system,name,a,b){
 return system==='afr_sched'&&AFR_TURNBACKS.has(name)&&a.to===b.from&&a.nodeIds.at(-2)===b.nodeIds[1];
}
