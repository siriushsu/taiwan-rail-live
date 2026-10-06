/* 暗色材質集中在此。沿用底圖建築 footprint/height，不更改相機、軌道或列車位置。 */
(() => {
  const colorCache = new Map();
  function neon(color) {
    if (colorCache.has(color)) return colorCache.get(color);
    const parts = /^#([\da-f]{6})$/i.exec(color || '');
    if (!parts) return color;
    const rgb = [0,2,4].map(i => parseInt(parts[1].slice(i,i+2),16));
    const value = '#' + rgb.map(c => Math.round(c + (255-c)*.42).toString(16).padStart(2,'0')).join('');
    colorCache.set(color,value); return value;
  }
  function styleMap(raw, dark) {
    if (!dark) return;
    for (const layer of raw.getStyle().layers) {
      const id = layer.id, source = layer['source-layer'] || '';
      if (id.startsWith('track-') || id === 'building-3d') continue;
      if (layer.type === 'background') raw.setPaintProperty(id,'background-color','#0F1B30');
      else if (id === 'offline-land-fill') raw.setPaintProperty(id,'fill-color','#0C1322');
      else if (id === 'offline-land-line') raw.setPaintProperty(id,'line-color','#20344D');
      else if (layer.type === 'fill') {
        const color = /water/.test(source) ? '#0F1B30' : source === 'building' ? '#18263C' : /land|park/.test(source) ? '#0C1322' : null;
        if (color) raw.setPaintProperty(id,'fill-color',color);
        if (source === 'building') raw.setPaintProperty(id,'fill-outline-color','#253851');
      } else if (layer.type === 'line' && /transportation/.test(source)) {
        const major = /motorway|trunk|primary|secondary/.test(id);
        raw.setPaintProperty(id,'line-color',major ? '#35465F' : '#243249');
      } else if (layer.type === 'symbol' && layer.layout?.['text-field']) {
        raw.setPaintProperty(id,'text-color','#8296B4'); raw.setPaintProperty(id,'text-halo-color','#0C1322');
      }
    }
  }
  // 原生 extrusion 負責透明牆面，這層只補屋頂輪廓、垂直角線與稀疏樓層線。
  // loaded source features 僅在圖磚到貨/鏡頭移動結束重建；每幀只有一個 drawArrays。
  function installGlass(raw) {
    if (raw.getLayer('building-glass-edges')) return;
    const layer = {
      id:'building-glass-edges', type:'custom', renderingMode:'3d',
      onAdd(raw, gl) {
        this.raw=raw; this.gl=gl; this.count=0; this.origin=[0,0,0]; this.disposed=false; this.tiles=null; this.movedAt=0; this.deferSince=0; this.autoAt=0; this.builtAt=0;
        this.selection=new Map();this.targets=[];this.fadeStart=0;this.fadeDuration=360;this.fading=false;
        const shader = (type,source) => { const s=gl.createShader(type); gl.shaderSource(s,source); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
        const modern=!!gl.createVertexArray;
        const vs=shader(gl.VERTEX_SHADER,(modern?'#version 300 es\nin':'attribute')+' vec4 position; '+(modern?'in':'attribute')+' vec2 transition; uniform mat4 matrix; uniform float progress; uniform float zoomOpacity; '+(modern?'out':'varying')+' float alpha; void main(){gl_Position=matrix*vec4(position.xyz,1.0);alpha=position.w*mix(transition.x,transition.y,smoothstep(0.0,1.0,progress))*zoomOpacity;}');
        const fs=shader(gl.FRAGMENT_SHADER,(modern?'#version 300 es\n':'')+'precision mediump float; '+(modern?'in':'varying')+' float alpha; '+(modern?'out vec4 color;':'')+' void main(){'+(modern?'color':'gl_FragColor')+'=vec4(vec3(.588,.745,1.0)*alpha,alpha);}');
        this.program=gl.createProgram(); gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);
        gl.deleteShader(vs);gl.deleteShader(fs);
        if(!gl.getProgramParameter(this.program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
        this.attribute=gl.getAttribLocation(this.program,'position'); this.matrix=gl.getUniformLocation(this.program,'matrix');
        this.transitionAttribute=gl.getAttribLocation(this.program,'transition');this.progress=gl.getUniformLocation(this.program,'progress');this.zoomOpacity=gl.getUniformLocation(this.program,'zoomOpacity');
        this.buffer=gl.createBuffer();this.transitionBuffer=gl.createBuffer(); this.vao=gl.createVertexArray?.();
        // 與 rail-3d/station-layer.js 的遮罩同一條規則:手指拖曳／慣性／飛行動畫距上次移動 <400ms 就先不重建,
        // 最多延後 15s。地形圖磚到貨會改高度,整批快取作廢。
        // 跟車是程式每幀 jumpTo(沒有 originalEvent、也不在 easing),不能等相機停:否則要等 15s 上限或靠站
        // 才重建,前進中近景大多沒有線(2026-09-23 使用者回報;桌面實測近景有線比例 7s 後掉到 34%)。
        // 跟車改成最多每 1s 重建一次;快取路徑一次重建桌面 4x 降速約 14–44ms。
        this.schedule=e=>{if(e?.sourceId && e.sourceId!=='openmaptiles'&&e.sourceId!=='terrain')return; if(e?.sourceId==='terrain')this.tiles=null; if(this.timer||this.disposed)return; this.timer=setTimeout(()=>{this.timer=null;this.settle();},240);};
        this.settle=()=>{const now=performance.now();if(now-(this.movedAt||0)<400){if(!this.deferSince)this.deferSince=now;if(now-this.deferSince<15000){this.timer=setTimeout(()=>{this.timer=null;this.settle();},150);return;}}if(now-this.autoAt<400&&now-this.builtAt<1000){this.timer=setTimeout(()=>{this.timer=null;this.settle();},1000-(now-this.builtAt));return;}this.deferSince=0;this.rebuild();};
        this.noteMove=e=>{if(e?.originalEvent||raw.isEasing())this.movedAt=performance.now();else this.autoAt=performance.now();};
        raw.on('moveend',this.schedule);raw.on('sourcedata',this.schedule);raw.on('move',this.noteMove);this.schedule();
        this.restore=()=>{this.onRemove(raw,gl);this.onAdd(raw,gl);};
        raw.on('webglcontextrestored',this.restore);
      },
      // 解碼與畫線都依圖磚快取:每棟只解碼一次、第一次進畫面時算一次線段,之後重建只是把畫面內的
      // 建物接起來送 GPU(2026-09-08 桌面 6x 實測:整批重算一次 210–290ms,其中解碼佔一半)。
      // 頂點用固定原點的相對座標保 float32 精度,原點離相機 >0.05° 才換;換原點、跨 15.5 樓層線門檻、
      // 地形到貨都整批作廢。圖磚緩衝區會讓同一棟出現在兩張圖磚,用完整外環鍵去重。
      rebuild() {
        if(this.disposed)return;
        this.builtAt=performance.now();
        const raw=this.raw, z=raw.getZoom();
        if(z<14||!raw.getSource('openmaptiles')){this.count=0;this.buildings=0;this.selection.clear();this.targets=[];this.fading=false;return;}
        const center=raw.getCenter(), floors=z>=15.5, terrain=!!raw.getTerrain();
        // 關掉地形不會再送地形圖磚事件；此時也必須清掉帶有舊高程的線段。
        const invalidated=!this.tiles||this.floors!==floors||this.terrain!==terrain||Math.abs(center.lng-this.originLL[0])+Math.abs(center.lat-this.originLL[1])>.05;
        if(invalidated){
          const o=maplibregl.MercatorCoordinate.fromLngLat(center);this.origin=[o.x,o.y,0];this.originLL=[center.lng,center.lat];this.floors=floors;this.terrain=terrain;this.tiles=new Map();}
        const origin=this.origin, tiles=this.tiles, live=new Set(), order=[], fresh=new Map();
        for(const f of raw.querySourceFeatures('openmaptiles',{sourceLayer:'building'})){const k=f.tile.z+'/'+f.tile.x+'/'+f.tile.y;if(!live.has(k)){live.add(k);order.push(k);}if(tiles.has(k))continue;if(!fresh.has(k))fresh.set(k,[]);fresh.get(k).push(f);}
        // 每棟初次解碼時存完整鍵；避免短雜湊碰撞把不同建築誤當重複而漏畫。
        const hash=ring=>JSON.stringify(ring);
        for(const [k,feats] of fresh){const list=[];
          for(const feature of feats){const p=feature.properties||{},height=Number(p.render_height??p.height??8),base=Number(p.render_min_height??p.min_height??0);
            if(!Number.isFinite(height)||height<=base||height>1000)continue;
            const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates:[];
            for(const polygon of polygons){const ring=polygon[0];if(!ring||ring.length<4||ring.length>180)continue;
              let [bw,bs]=ring[0],[be,bn]=ring[0];for(const [x,y] of ring){if(x<bw)bw=x;if(x>be)be=x;if(y<bs)bs=y;if(y>bn)bn=y;}
              const key=hash(ring);let seed=2166136261;for(let i=0;i<key.length;i++)seed=Math.imul(seed^key.charCodeAt(i),16777619);
              list.push({ring,height,base,bounds:[bw,bs,be,bn],hash:key,seed:seed>>>0,v:null});}}
          tiles.set(k,list);}
        for(const k of tiles.keys())if(!live.has(k))tiles.delete(k);
        const bounds=raw.getBounds(), sw=bounds.getSouthWest(), ne=bounds.getNorthEast();
        const cap=matchMedia('(any-pointer:coarse)').matches?700:1600;this.cap=cap;
        const edges=b=>{const out=[],ring=b.ring;
          // 同一頂點的屋頂、垂直線和各層樓都站在同一地表，一次建置只查一次 DEM。
          // 圖磚到貨仍由 schedule 清掉整份頂點快取，不跨不同地形資料保留高度。
          const ground=ring.map((xy,i)=>i===ring.length-1&&xy[0]===ring[0][0]&&xy[1]===ring[0][1]?null:terrain?raw.queryTerrainElevation(xy):0);
          if(ring.at(-1)[0]===ring[0][0]&&ring.at(-1)[1]===ring[0][1])ground[ring.length-1]=ground[0];
          const point=(i,height,alpha)=>{if(ground[i]==null)return null;const p=maplibregl.MercatorCoordinate.fromLngLat(ring[i],height+ground[i]);return [p.x-origin[0],p.y-origin[1],p.z,alpha];};
          const edge=(a,c,ha,hb,alpha)=>{const p=point(a,ha,alpha),q=point(c,hb,alpha);if(p&&q)out.push(...p,...q);};
          for(let i=0;i<ring.length-1;i++){edge(i,i+1,b.height,b.height,.40);edge(i,i,b.base,b.height,.24);
            if(floors){const step=Math.max(4,Math.ceil((b.height-b.base)/10));for(let h=b.base+step;h<b.height-1;h+=step)edge(i,i+1,h,h,.10);}}
          return new Float32Array(out);};
        // 中央最近 20 棟優先，其餘額度分給整個可見畫面的格子，避免縮小後只剩中央一個圓。
        // 每格用建物固定鍵排序；圖磚回傳順序、重建次數不會讓選取名單隨機跳動。
        // 投影／排序仍只在重建時執行，逐幀只調整淡入淡出的 uniform。
        const canvas=raw.getCanvas(), width=canvas.clientWidth, height=canvas.clientHeight;
        const candidates=[],picked=new Set();
        for(const k of order)for(const b of tiles.get(k)){
          const [bw,bs,be,bn]=b.bounds;
          if(be<sw.lng||bw>ne.lng||bn<sw.lat||bs>ne.lat||picked.has(b.hash))continue;
          picked.add(b.hash);
          const p=raw.project([(bw+be)/2,(bs+bn)/2]);
          let visible=p.x>=0&&p.x<=width&&p.y>=0&&p.y<=height;
          if(!visible){
            // 中心在畫面外的大樓仍可能露出一部分；用投影外框保留跨畫面邊緣的建築。
            const corners=[[bw,bs],[bw,bn],[be,bs],[be,bn]].map(xy=>raw.project(xy));
            visible=Math.max(...corners.map(p=>p.x))>=0&&Math.min(...corners.map(p=>p.x))<=width&&
              Math.max(...corners.map(p=>p.y))>=0&&Math.min(...corners.map(p=>p.y))<=height;
          }
          const dx=p.x-width/2,dy=p.y-height/2;
          candidates.push({b,visible,distance:dx*dx+dy*dy,cell:Math.min(7,Math.max(0,Math.floor(p.x/Math.max(1,width)*8)))+8*Math.min(5,Math.max(0,Math.floor(p.y/Math.max(1,height)*6)))});
        }
        candidates.sort((a,b)=>Number(b.visible)-Number(a.visible)||a.distance-b.distance||
          (a.b.hash<b.b.hash?-1:a.b.hash>b.b.hash?1:0));
        const priority=candidates.filter(c=>c.visible).slice(0,20),central=new Set(priority.map(c=>c.b.hash)),cells=new Map();
        for(const c of candidates)if(c.visible&&!central.has(c.b.hash)){if(!cells.has(c.cell))cells.set(c.cell,[]);cells.get(c.cell).push(c);}
        const buckets=[...cells.entries()].sort((a,b)=>((a[0]%8-3.5)**2+(Math.floor(a[0]/8)-2.5)**2)-((b[0]%8-3.5)**2+(Math.floor(b[0]/8)-2.5)**2)||a[0]-b[0]).map(([,list])=>list.sort((a,b)=>a.b.seed-b.b.seed||(a.b.hash<b.b.hash?-1:a.b.hash>b.b.hash?1:0)));
        for(let i=0,more=true;more;i++){more=false;for(const list of buckets)if(i<list.length){priority.push(list[i]);more=true;}}
        for(const c of candidates)if(!c.visible)priority.push(c);
        const targets=[];let total=0;
        for(const {b} of priority){b.v=b.v||edges(b);if(!b.v.length||total+b.v.length>640000)continue;targets.push(b);total+=b.v.length;if(targets.length>=cap)break;}
        // 留下的舊線也必須使用新原點／地形／樓層，不能把舊的相對座標套到新 matrix。
        if(invalidated){const wanted=new Set(targets.map(b=>b.hash));for(const {b} of this.selection.values())if(!wanted.has(b.hash))b.v=edges(b);}
        this.targets=targets;this.applySelection(performance.now());
      },
      applySelection(now) {
        const t=Math.max(0,Math.min(1,(now-this.fadeStart)/this.fadeDuration)),ease=t*t*(3-2*t);
        const wanted=new Map(this.targets.map(b=>[b.hash,b])),selection=new Map();let total=0;
        const add=(b,from,to)=>{if(selection.size>=this.cap||!b.v.length||total+b.v.length>640000)return false;selection.set(b.hash,{b,from,to});total+=b.v.length;return true;};
        // 先保留仍在顯示的線，離開名單的先淡出；空出的額度才補新線，過渡期間也不超額。
        for(const [key,item] of this.selection){const b=wanted.get(key),alpha=item.from+(item.to-item.from)*ease;
          if(b||alpha>0)add(b||item.b,alpha,b?1:0);}
        for(const b of this.targets)if(!selection.has(b.hash))add(b,0,1);
        const vertices=new Float32Array(total),transitions=new Float32Array(total/2);let off=0;
        for(const {b,from,to} of selection.values()){vertices.set(b.v,off);for(let i=off/2;i<(off+b.v.length)/2;i+=2){transitions[i]=from;transitions[i+1]=to;}off+=b.v.length;}
        this.selection=selection;this.fadeStart=now;this.fading=[...selection.values()].some(s=>s.from!==s.to);this.count=total/4;this.buildings=selection.size;
        const gl=this.gl,previous=gl.getParameter(gl.ARRAY_BUFFER_BINDING);
        gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER,this.transitionBuffer);gl.bufferData(gl.ARRAY_BUFFER,transitions,gl.STATIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,previous);
        this.raw.triggerRepaint();
      },
      render(gl,args) {
        if(!this.count||this.raw.getZoom()<14||document.documentElement.dataset.theme!=='dark'||this.raw.getLayoutProperty('building-3d','visibility')!=='visible')return;
        // 本站 MapLibre 4.7 傳 matrix；新版才傳 projection input。
        const source=Array.isArray(args)||ArrayBuffer.isView(args)?args:args.defaultProjectionData?.mainMatrix; if(!source)return;
        const now=performance.now();if(this.fading&&now-this.fadeStart>=this.fadeDuration)this.applySelection(now);
        const matrix=Array.from(source), o=this.origin;
        for(let i=0;i<4;i++)matrix[12+i]=source[i]*o[0]+source[4+i]*o[1]+source[8+i]*o[2]+source[12+i];
        gl.useProgram(this.program);gl.bindVertexArray?.(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
        gl.enableVertexAttribArray(this.attribute);gl.vertexAttribPointer(this.attribute,4,gl.FLOAT,false,16,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,this.transitionBuffer);gl.enableVertexAttribArray(this.transitionAttribute);gl.vertexAttribPointer(this.transitionAttribute,2,gl.FLOAT,false,8,0);
        gl.uniform1f(this.progress,Math.max(0,Math.min(1,(now-this.fadeStart)/this.fadeDuration)));
        const zoom=Math.max(0,Math.min(1,(this.raw.getZoom()-14)/.7));gl.uniform1f(this.zoomOpacity,zoom*zoom*(3-2*zoom));
        gl.uniformMatrix4fv(this.matrix,false,matrix);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.lineWidth(1);gl.drawArrays(gl.LINES,0,this.count);gl.bindVertexArray?.(null);
        if(this.fading)this.raw.triggerRepaint();
      },
      onRemove(raw,gl) {
        this.disposed=true;clearTimeout(this.timer);raw.off('moveend',this.schedule);raw.off('sourcedata',this.schedule);raw.off('move',this.noteMove);this.tiles=null;this.selection=null;this.targets=null;this.fading=false;
        raw.off('webglcontextrestored',this.restore);
        gl.deleteBuffer(this.buffer);gl.deleteBuffer(this.transitionBuffer);if(this.vao)gl.deleteVertexArray(this.vao);gl.deleteProgram(this.program);
      },
    };
    const layers=raw.getStyle().layers;
    let lastBase=-1;
    layers.forEach((item,i)=>{if(item.type!=='symbol'&&!item.id.startsWith('track-')&&!item.id.startsWith('aligndot'))lastBase=i;});
    // 初次 boot 時軌道可能尚未安裝。先放在最後一個底圖層之上、標籤之下，
    // 後續 glTracksInstall 插入同一錨點時會自然排在玻璃線之上。
    const before=layers.find(l=>l.id.startsWith('track-'))?.id||layers.slice(lastBase+1).find(l=>l.type==='symbol')?.id;
    raw.addLayer(layer,before);
  }
  window.RailNightMap={neon,styleMap,installGlass};
})();
