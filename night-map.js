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
        this.raw=raw; this.gl=gl; this.count=0; this.origin=[0,0,0]; this.disposed=false;
        const shader = (type,source) => { const s=gl.createShader(type); gl.shaderSource(s,source); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
        const modern=!!gl.createVertexArray;
        const vs=shader(gl.VERTEX_SHADER,(modern?'#version 300 es\nin':'attribute')+' vec4 position; uniform mat4 matrix; '+(modern?'out':'varying')+' float alpha; void main(){gl_Position=matrix*vec4(position.xyz,1.0);alpha=position.w;}');
        const fs=shader(gl.FRAGMENT_SHADER,(modern?'#version 300 es\n':'')+'precision mediump float; '+(modern?'in':'varying')+' float alpha; '+(modern?'out vec4 color;':'')+' void main(){'+(modern?'color':'gl_FragColor')+'=vec4(vec3(.588,.745,1.0)*alpha,alpha);}');
        this.program=gl.createProgram(); gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);
        gl.deleteShader(vs);gl.deleteShader(fs);
        if(!gl.getProgramParameter(this.program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
        this.attribute=gl.getAttribLocation(this.program,'position'); this.matrix=gl.getUniformLocation(this.program,'matrix');
        this.buffer=gl.createBuffer(); this.vao=gl.createVertexArray?.();
        this.schedule=e=>{if(e?.sourceId && e.sourceId!=='openmaptiles')return; if(this.timer||this.disposed)return; this.timer=setTimeout(()=>{this.timer=null;this.rebuild();},240);};
        raw.on('moveend',this.schedule);raw.on('sourcedata',this.schedule);this.schedule();
        this.restore=()=>{this.onRemove(raw,gl);this.onAdd(raw,gl);};
        raw.on('webglcontextrestored',this.restore);
      },
      rebuild() {
        if(this.disposed)return;
        const raw=this.raw, z=raw.getZoom();
        if(z<14||!raw.getSource('openmaptiles')){this.count=0;return;}
        const center=raw.getCenter(), origin=maplibregl.MercatorCoordinate.fromLngLat(center);
        this.origin=[origin.x,origin.y,0];
        const bounds=raw.getBounds(), seen=new Set(), vertices=[];
        const cap=matchMedia('(any-pointer:coarse)').matches?700:1600;
        let buildings=0;
        const point=(xy,height,alpha)=>{const p=maplibregl.MercatorCoordinate.fromLngLat(xy,height);vertices.push(p.x-origin.x,p.y-origin.y,p.z,alpha);};
        const edge=(a,b,ha,hb,alpha)=>{point(a,ha,alpha);point(b,hb,alpha);};
        for(const feature of raw.querySourceFeatures('openmaptiles',{sourceLayer:'building'})) {
          const p=feature.properties||{}, height=Number(p.render_height??p.height??8), base=Number(p.render_min_height??p.min_height??0);
          if(!Number.isFinite(height)||height<=base||height>1000)continue;
          const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates:[];
          for(const polygon of polygons) {
            const ring=polygon[0]; if(!ring||ring.length<4||ring.length>180)continue;
            if(!ring.some(xy=>bounds.contains(xy)))continue;
            const key=JSON.stringify(ring); if(seen.has(key))continue;seen.add(key);
            for(let i=0;i<ring.length-1;i++) {
              edge(ring[i],ring[i+1],height,height,.40);
              edge(ring[i],ring[i],base,height,.24);
              if(z>=15.5) { const step=Math.max(4,Math.ceil((height-base)/10)); for(let h=base+step;h<height-1;h+=step) edge(ring[i],ring[i+1],h,h,.10); }
            }
            if(++buildings>=cap||vertices.length>640000)break;
          }
          if(buildings>=cap||vertices.length>640000)break;
        }
        this.count=vertices.length/4; this.buildings=buildings;
        const gl=this.gl, previous=gl.getParameter(gl.ARRAY_BUFFER_BINDING);
        gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,previous);
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
        this.disposed=true;clearTimeout(this.timer);raw.off('moveend',this.schedule);raw.off('sourcedata',this.schedule);
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
