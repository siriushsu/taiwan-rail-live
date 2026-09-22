// 實體股道路網：節點身分與道岔決定連接，不以座標接近合併股道。
import {distanceM} from '../integration/train-path.js';

export function railwaySystem(tags) {
  const text=[tags.operator,tags.network,tags.name].filter(Boolean).join(' ');
  if (/阿里山/.test(text)&&tags.railway==='narrow_gauge') return 'afr_sched';
  if (/三鶯/.test(text)) return 'sanying';
  if (/安坑/.test(text)) return 'ntalrt';
  if (/淡海/.test(text)) return 'ntdlrt';
  if (/桃園捷運|桃園機場捷運/.test(text)) return 'tymc';
  if (/臺中捷運|台中捷運/.test(text)) return 'tmrt';
  if (/高雄捷運|高雄環狀輕軌/.test(text)) return 'krtc';
  if (/臺北大眾捷運|台北捷運|捷運環狀線|文湖線/.test(text)) return 'mrt';
  if (/高速鐵路|台灣高鐵|THSR/.test(text)) return 'thsr_sched';
  if (tags.railway==='rail' && (tags.gauge==='1067' || /臺灣鐵路|臺鐵|Taiwan Railway/.test(text))) return 'tra_sched';
  return null;
}

export function makeTopology(data) {
  const nodes=new Map(Object.entries(data.nodes).map(([id,coordinate])=>[String(id),{id:String(id),coordinate,edges:[],tags:data.nodeTags?.[id]||{}}]));
  const edges=new Map(),wayNodes=new Map();
  // 月台線常省略 operator/gauge；只在整個未知連通組唯一連到一個已知系統時補配。
  const systemByWay=new Map(data.ways.map(w=>[String(w.id),data.systemByWay?.[w.id]||railwaySystem(w.tags)])),waysAt=new Map(),seen=new Set();
  for(const way of data.ways)for(const id of way.nodes){const key=String(id);if(!waysAt.has(key))waysAt.set(key,[]);waysAt.get(key).push(way);}
  for(const way of data.ways){const id=String(way.id);if(systemByWay.get(id)||seen.has(id))continue;
    const component=[],boundary=new Set(),pending=[way];
    while(pending.length){const item=pending.pop(),key=String(item.id);if(seen.has(key))continue;seen.add(key);component.push(key);
      for(const node of item.nodes)for(const neighbor of waysAt.get(String(node))||[]){const n=String(neighbor.id),system=systemByWay.get(n);if(system&&neighbor.tags.railway===item.tags.railway)boundary.add(system);else if(neighbor.tags.railway===item.tags.railway&&(!neighbor.tags.gauge||!item.tags.gauge||neighbor.tags.gauge===item.tags.gauge)&&!seen.has(n))pending.push(neighbor);}
    }
    if(boundary.size===1)for(const key of component)systemByWay.set(key,[...boundary][0]);
  }
  for (const way of data.ways) {
    const system=systemByWay.get(String(way.id));
    if (!system) continue;
    wayNodes.set(String(way.id),way.nodes.map(String));
    for (let i=1;i<way.nodes.length;i++) {
      const a=nodes.get(String(way.nodes[i-1])),b=nodes.get(String(way.nodes[i]));
      if (!a||!b||a===b) continue;
      const length=distanceM(a.coordinate,b.coordinate);
      if (!(length>0)) continue;
      // 重複 way 的相同節點對仍共用一個佔用資源，不能冒充第二股。
      const resource=[system,...[a.id,b.id].sort()].join(':');
      const id=way.id+':'+(i-1),edge={id,resource,a:a.id,b:b.id,length,wayId:String(way.id),system,tags:way.tags};
      edges.set(id,edge);a.edges.push(edge);b.edges.push(edge);
    }
  }
  const trackGroups=new Map();
  for(const node of nodes.values()) {
    if(trackGroups.has(node.id)||node.edges.length===0)continue;
    const neighbors=new Set(node.edges.map(e=>e.a===node.id?e.b:e.a));
    if(neighbors.size>2||node.tags.railway==='switch')continue;
    const pending=[node.id],members=[];
    while(pending.length){const id=pending.pop();if(trackGroups.has(id))continue;const n=nodes.get(id),ends=new Set(n.edges.map(e=>e.a===id?e.b:e.a));
      if(ends.size>2||n.tags.railway==='switch')continue;
      trackGroups.set(id,node.id);members.push(id);for(const next of ends)if(!trackGroups.has(next))pending.push(next);
    }
  }
  function vector(a,b) {const x=nodes.get(a).coordinate,y=nodes.get(b).coordinate;return [(y[0]-x[0])*Math.cos(x[1]*Math.PI/180),y[1]-x[1]];}
  function cosine(a,b) {return (a[0]*b[0]+a[1]*b[1])/(Math.hypot(...a)*Math.hypot(...b)||1);}
  function directed(edge,from) {
    const oneway=edge.tags.oneway;
    return !(oneway==='-1'&&from===edge.a || ['yes','1','true'].includes(oneway)&&from===edge.b);
  }
  function stableVector(from,to,edge) {
    // OSM 橋面接頭偶有十幾公分的反向碎段。只沿唯一的同系統接續取較長切線，
    // 保留來源節點與線形；不把小碎段誤判成整股軌道不可通行。
    const origin=from;let current=to,prior=from,walked=edge.length,last=edge;
    for(let i=0;walked<2&&i<8;i++){
      const next=nodes.get(current).edges.filter(e=>e.system===edge.system&&e.resource!==last.resource);
      const unique=[...new Map(next.map(e=>[e.resource,e])).values()];
      if(unique.length!==1||nodes.get(current).tags.railway==='switch')break;
      const e=unique[0],end=e.a===current?e.b:e.a;if(end===prior)break;
      walked+=e.length;prior=current;current=end;last=e;
    }
    return vector(origin,current);
  }
  function canTurn(from,via,to,incoming,outgoing) {
    if (from===to||incoming.system!==outgoing.system) return false;
    const reverse=stableVector(via,from,incoming),ahead=stableVector(via,to,outgoing),alignment=cosine([-reverse[0],-reverse[1]],ahead);
    const node=nodes.get(via),kind=node.tags.railway;
    if (kind==='buffer_stop') return false;
    if (incoming.wayId===outgoing.wayId) return true; // 同一來源曲線可包含真實髮夾彎。
    const neighbors=new Set(node.edges.filter(e=>e.system===incoming.system).map(e=>e.a===via?e.b:e.a));
    if(neighbors.size===2)return true; // 明確的來源接頭，不是可任意轉線的道岔。
    if (alignment<0) return false; // 不可倒車轉進道岔另一支。
    if (kind==='switch') return true;
    if (['railway_crossing','crossing'].includes(kind)) {
      // 平面交叉不是道岔。只接行进方向最直的一支；每個穿越共用衝突資源。
      const options=node.edges.filter(e=>e.system===incoming.system&&e.resource!==incoming.resource).map(e=>({edge:e,score:cosine(vector(from,via),vector(via,e.a===via?e.b:e.a))}));
      const best=Math.max(...options.map(x=>x.score));
      return alignment>.95&&alignment>=best-1e-8;
    }
    // 未標記的兩段 way 接頭可直通；有分岔但沒有道岔證據時不猜。
    // 未標記三叉點僅在一股分成兩條同向、近乎平行的支線時推估為道岔。
    // 四叉交會仍不猜可轉線；源節點相同也不能把 X 交叉當成換軌。
    if(neighbors.size===3&&alignment>.7){
      const rays=[...neighbors].map(n=>vector(via,n));
      return rays.some((a,i)=>rays.some((b,j)=>i<j&&cosine(a,b)>.85));
    }
    return false;
  }
  function shortestPath({from,to,system,blocked=new Set(),penalties=new Map(),maxLength=Infinity,allowYard=false,edgeAllowed=()=>true,startVector=null,endVector=null}) {
    from=String(from);to=String(to);
    if (!nodes.has(from)||!nodes.has(to)) return null;
    const queue=new MinHeap(),best=new Map(),previous=new Map();
    const start=from+'|';queue.push({node:from,key:start,cost:0,length:0,via:null,from:null});best.set(start,0);
    let end=null;
    while(queue.size) {
      const q=queue.pop();if(q.cost!==best.get(q.key))continue;
      if(q.node===to){end=q;break;}
      for(const edge of nodes.get(q.node).edges) {
        if(edge.system!==system||blocked.has(edge.resource)||!directed(edge,q.node)||!edgeAllowed(edge,q.node))continue;
        if(!allowYard&&['yard','spur'].includes(edge.tags.service))continue;
        const next=edge.a===q.node?edge.b:edge.a;
        if(!q.via&&startVector&&cosine(vector(q.node,next),startVector)<.2)continue;
        if(next===to&&endVector&&cosine(vector(q.node,next),endVector)<.2)continue;
        if(q.via&&!canTurn(q.from,q.node,next,q.via,edge))continue;
        const length=q.length+edge.length;if(length>maxLength)continue;
        const cost=q.cost+edge.length+(penalties.get(edge.resource)||0)+(edge.tags.service==='crossover'?edge.length*4:0);
        const key=next+'|'+edge.id;if(cost>=(best.get(key)??Infinity))continue;
        best.set(key,cost);previous.set(key,{key:q.key,node:q.node,edge:edge.id});queue.push({node:next,key,cost,length,via:edge,from:q.node});
      }
    }
    if(!end)return null;
    const nodeIds=[to],edgeIds=[];let key=end.key;
    while(previous.has(key)){const p=previous.get(key);edgeIds.push(p.edge);nodeIds.push(p.node);key=p.key;}
    nodeIds.reverse();edgeIds.reverse();
    // 搜尋以「來向」為狀態，仍不可用繞一圈偷渡方向限制。
    if(new Set(nodeIds).size!==nodeIds.length)return null;
    return {nodeIds,edgeIds,coordinates:nodeIds.map(id=>nodes.get(id).coordinate),lengthM:end.length,cost:end.cost};
  }
  function stopCandidates(station,system) {
    const normalize=x=>String(x||'').replaceAll('臺','台').replace(/\s*[（(].*?[）)]/g,'').replace(/(火車站|車站)$/,'').replace(/-環島$/,'').trim();
    const name=typeof station==='string'?station:station.name,coordinate=typeof station==='object'?[station.lon,station.lat]:null;
    const matches=[...nodes.values()].filter(n=>{
      if(n.tags.railway!=='stop'||!n.edges.some(e=>e.system===system))return false;
      const named=normalize(n.tags.name),matches=named===normalize(name);
      if(!coordinate)return matches;
      // 同站匿名停車點可按官方站點位置補配；不同站名與不同系統不可混入。
      return (!named||matches)&&distanceM(n.coordinate,coordinate)<(matches?500:300);
    }).map(n=>({nodeId:n.id,trackGroup:system+':'+(trackGroups.get(n.id)||n.id),coordinate:n.coordinate,source:n.tags._source||'osm-stop-position',trackRefs:[...new Set(n.edges.filter(e=>e.system===system).map(e=>e.tags['railway:track_ref']).filter(Boolean))]}));
    const groups=new Map();
    for(const c of matches){const old=groups.get(c.trackGroup);if(!old||coordinate&&distanceM(c.coordinate,coordinate)<distanceM(old.coordinate,coordinate))groups.set(c.trackGroup,c);}
    return [...groups.values()];
  }
  return {nodes,edges,wayNodes,trackGroups,canTurn,shortestPath,stopCandidates};
}

class MinHeap {
  values=[];
  get size(){return this.values.length;}
  push(v){const a=this.values;a.push(v);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p].cost<=v.cost)break;a[i]=a[p];i=p;}a[i]=v;}
  pop(){const a=this.values,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let k=i*2+1;if(k+1<a.length&&a[k+1].cost<a[k].cost)k++;if(a[k].cost>=last.cost)break;a[i]=a[k];i=k;}a[i]=last;}return first;}
}
