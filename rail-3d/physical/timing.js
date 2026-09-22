import {AFR_TURNBACKS} from './turnbacks.js';
// 同一批來源路徑與班表做整列車資源預約；回傳推估安排，不宣稱是調度員的實際股道。
export const stationKey=(sys,name)=>sys+':'+String(name).replaceAll('臺','台').replace(/\s*[（(].*?[）)]/g,'').replace(/-環島$/,'').trim();
export function profileProgress(p,t){
 if(t<=0)return 0;if(t>=p.T)return 1;
 if(p.obs){let i=0,lo=0,hi=p.xs.length-2;while(lo<=hi){const m=(lo+hi)>>1;if(t<p.xs[m])hi=m-1;else{i=m;lo=m+1;}}const h=p.h[i],u=(t-p.xs[i])/h,u2=u*u,u3=u2*u;return Math.min(1,Math.max(0,((2*u3-3*u2+1)*p.ys[i]+(u3-2*u2+u)*h*p.m[i]+(-2*u3+3*u2)*p.ys[i+1]+(u3-u2)*h*p.m[i+1])/p.L));}
 let d;if(t<p.tAcc)d=.5*p.a*t*t;else if(t<p.tAcc+p.tCru)d=p.dAcc+p.vc*(t-p.tAcc);else if(t<p.tAcc+p.tCru+p.tCoast){const v=t-p.tAcc-p.tCru;d=p.dAcc+p.dCru+p.vc*v-.5*p.c*v*v;}else{const v=t-p.tAcc-p.tCru-p.tCoast;d=p.dAcc+p.dCru+p.dCoast+p.vb*v-.5*p.b*v*v;}return d/p.L;
}
const segmentTimes=new WeakMap();
export function segmentTime(st,next,f,{system}={}){
 if(system==='afr_sched'&&(AFR_TURNBACKS.has(st.name)||AFR_TURNBACKS.has(next.name))){let lo=0,hi=1;for(let i=0;i<28;i++){const m=(lo+hi)/2;if(turnbackProgress(m,st,next)<f)lo=m;else hi=m;}f=(lo+hi)/2;}
 if(f<=0)return 0;if(f>=1)return next.arrSec-st.depSec;if(!st.rp)return (next.arrSec-st.depSec)*f;
 let cache=segmentTimes.get(st);if(!cache){cache=new Map();segmentTimes.set(st,cache);}const key=Math.round(f*1e10);if(cache.has(key))return cache.get(key);
 const p=st.rp,target=(st.rpOff+f*st.rpSegKm*1000)/p.L,d=target*p.L;let t;
 if(target<=0)t=0;else if(target>=1)t=p.T;
 else if(p.obs){let lo=0,hi=p.T;for(let i=0;i<24;i++){const m=(lo+hi)/2;if(profileProgress(p,m)<target)lo=m;else hi=m;}t=(lo+hi)/2;}
 else if(d<p.dAcc)t=Math.sqrt(2*d/p.a);
 else if(d<p.dAcc+p.dCru)t=p.tAcc+(d-p.dAcc)/p.vc;
 else if(d<p.dAcc+p.dCru+p.dCoast){const dis=p.vc*p.vc-2*p.c*(d-p.dAcc-p.dCru);t=p.tAcc+p.tCru+(dis>0?(p.vc-Math.sqrt(dis))/p.c:p.tCoast);}
 else{const dis=p.vb*p.vb-2*p.b*(d-p.dAcc-p.dCru-p.dCoast);t=p.tAcc+p.tCru+p.tCoast+(dis>0?(p.vb-Math.sqrt(dis))/p.b:p.tDec);}
 const value=Math.max(0,Math.min(next.arrSec-st.depSec,t+st.rpDep-st.depSec));cache.set(key,value);return value;
}

// 公開班表未列出分道停車秒數：在同一站間時窗內漸停再起步，不捏造官方停留時刻。
export function turnbackProgress(f,st,next){
 const w=Math.min(.15,20/Math.max(1,next.arrSec-st.depSec));
 if(AFR_TURNBACKS.has(st.name)&&f<w){const u=f/w;return w*(2*u*u-u*u*u);}
 if(AFR_TURNBACKS.has(next.name)&&f>1-w){const u=(f-1+w)/w;return 1-w+w*(u+u*u-u*u*u);}
 return f;
}
