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
        this.raw=raw; this.gl=gl; this.count=0; this.origin=[0,0,0]; this.disposed=false; this.tiles=null; this.movedAt=0; this.deferSince=0;
        const shader = (type,source) => { const s=gl.createShader(type); gl.shaderSource(s,source); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
        const modern=!!gl.createVertexArray;
        const vs=shader(gl.VERTEX_SHADER,(modern?'#version 300 es\nin':'attribute')+' vec4 position; uniform mat4 matrix; '+(modern?'out':'varying')+' float alpha; void main(){gl_Position=matrix*vec4(position.xyz,1.0);alpha=position.w;}');
        const fs=shader(gl.FRAGMENT_SHADER,(modern?'#version 300 es\n':'')+'precision mediump float; '+(modern?'in':'varying')+' float alpha; '+(modern?'out vec4 color;':'')+' void main(){'+(modern?'color':'gl_FragColor')+'=vec4(vec3(.588,.745,1.0)*alpha,alpha);}');
        this.program=gl.createProgram(); gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);
        gl.deleteShader(vs);gl.deleteShader(fs);
        if(!gl.getProgramParameter(this.program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
        this.attribute=gl.getAttribLocation(this.program,'position'); this.matrix=gl.getUniformLocation(this.program,'matrix');
        this.buffer=gl.createBuffer(); this.vao=gl.createVertexArray?.();
        // 與 rail-3d/station-layer.js 的遮罩同一條規則:相機距上次移動 <400ms 就先不重建(手指還在拖),
        // 最多延後 15s(跟車時相機每幀都動,不能永遠不更新)。地形圖磚到貨會改高度,整批快取作廢。
        this.schedule=e=>{if(e?.sourceId && e.sourceId!=='openmaptiles'&&e.sourceId!=='terrain')return; if(e?.sourceId==='terrain')this.tiles=null; if(this.timer||this.disposed)return; this.timer=setTimeout(()=>{this.timer=null;this.settle();},240);};
        this.settle=()=>{const now=performance.now();if(now-(this.movedAt||0)<400){if(!this.deferSince)this.deferSince=now;if(now-this.deferSince<15000){this.timer=setTimeout(()=>{this.timer=null;this.settle();},150);return;}}this.deferSince=0;this.rebuild();};
        this.noteMove=()=>{this.movedAt=performance.now();};
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
        const raw=this.raw, z=raw.getZoom();
        if(z<14||!raw.getSource('openmaptiles')){this.count=0;return;}
        const center=raw.getCenter(), floors=z>=15.5, terrain=!!raw.getTerrain();
        // 關掉地形不會再送地形圖磚事件；此時也必須清掉帶有舊高程的線段。
        if(!this.tiles||this.floors!==floors||this.terrain!==terrain||Math.abs(center.lng-this.originLL[0])+Math.abs(center.lat-this.originLL[1])>.05){
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
              list.push({ring,height,base,bounds:[bw,bs,be,bn],hash:hash(ring),v:null});}}
          tiles.set(k,list);}
        for(const k of tiles.keys())if(!live.has(k))tiles.delete(k);
        const bounds=raw.getBounds(), sw=bounds.getSouthWest(), ne=bounds.getNorthEast();
        const cap=matchMedia('(any-pointer:coarse)').matches?700:1600;
        const point=(xy,height,alpha)=>{const ground=raw.getTerrain()?raw.queryTerrainElevation(xy):0;if(ground==null)return null;const p=maplibregl.MercatorCoordinate.fromLngLat(xy,height+ground);return [p.x-origin[0],p.y-origin[1],p.z,alpha];};
        const edges=b=>{const out=[],ring=b.ring,edge=(a,c,ha,hb,alpha)=>{const p=point(a,ha,alpha),q=point(c,hb,alpha);if(p&&q)out.push(...p,...q);};
          for(let i=0;i<ring.length-1;i++){edge(ring[i],ring[i+1],b.height,b.height,.40);edge(ring[i],ring[i],b.base,b.height,.24);
            if(floors){const step=Math.max(4,Math.ceil((b.height-b.base)/10));for(let h=b.base+step;h<b.height-1;h+=step)edge(ring[i],ring[i+1],h,h,.10);}}
          return new Float32Array(out);};
        // 預算先分給畫面內的近景，不能由圖磚回傳順序決定；斜視時遠方圖磚可能先填滿上限。
        // 下緣中央是可見地面的近端；俯視時用畫面中心。只在重建時投影／排序，逐幀仍只 drawArrays。
        const canvas=raw.getCanvas(), width=canvas.clientWidth, height=canvas.clientHeight;
        const near=raw.unproject([width/2,raw.getPitch()>0?height:height/2]);
        const lngScale=Math.cos(center.lat*Math.PI/180), candidates=[],picked=new Set();
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
          const dx=(Math.max(bw,Math.min(be,near.lng))-near.lng)*lngScale;
          const dy=Math.max(bs,Math.min(bn,near.lat))-near.lat;
          candidates.push({b,visible,distance:dx*dx+dy*dy});
        }
        candidates.sort((a,b)=>Number(b.visible)-Number(a.visible)||a.distance-b.distance||
          (a.b.hash<b.b.hash?-1:a.b.hash>b.b.hash?1:0));
        const parts=[];let buildings=0,total=0;
        for(const {b} of candidates){b.v=b.v||edges(b);if(!b.v.length)continue;parts.push(b.v);total+=b.v.length;if(++buildings>=cap||total>640000)break;}
        // 與原版一樣，達到上限時仍保留最後一棟的完整輪廓。
        const vertices=new Float32Array(total);let off=0;for(const a of parts){vertices.set(a,off);off+=a.length;}
        this.count=off/4; this.buildings=buildings;
        const gl=this.gl, previous=gl.getParameter(gl.ARRAY_BUFFER_BINDING);
        gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,off===vertices.length?vertices:vertices.subarray(0,off),gl.STATIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,previous);
        raw.triggerRepaint();
      },
      render(gl,args) {
        if(!this.count||this.raw.getZoom()<14||document.documentElement.dataset.theme!=='dark'||this.raw.getLayoutProperty('building-3d','visibility')!=='visible')return;
        // 本站 MapLibre 4.7 傳 matrix；新版才傳 projection input。
        const source=Array.isArray(args)||ArrayBuffer.isView(args)?args:args.defaultProjectionData?.mainMatrix; if(!source)return;
        const matrix=Array.from(source), o=this.origin;
        for(let i=0;i<4;i++)matrix[12+i]=source[i]*o[0]+source[4+i]*o[1]+source[8+i]*o[2]+source[12+i];
        gl.useProgram(this.program);gl.bindVertexArray?.(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
        gl.enableVertexAttribArray(this.attribute);gl.vertexAttribPointer(this.attribute,4,gl.FLOAT,false,16,0);
        gl.uniformMatrix4fv(this.matrix,false,matrix);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.lineWidth(1);gl.drawArrays(gl.LINES,0,this.count);gl.bindVertexArray?.(null);
      },
      onRemove(raw,gl) {
        this.disposed=true;clearTimeout(this.timer);raw.off('moveend',this.schedule);raw.off('sourcedata',this.schedule);raw.off('move',this.noteMove);this.tiles=null;
        raw.off('webglcontextrestored',this.restore);
        gl.deleteBuffer(this.buffer);if(this.vao)gl.deleteVertexArray(this.vao);gl.deleteProgram(this.program);
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
