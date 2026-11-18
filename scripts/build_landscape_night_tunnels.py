"""沿用地景來源倉原有夜燈演算法，僅在暫存副本裁掉地下里程，儲存有變化的像素。
用法：python scripts/build_landscape_night_tunnels.py 地景來源倉 暫存目錄（內含 night-lines.json）
"""
import sys,json,subprocess,shutil,os,hashlib
from pathlib import Path
from collections import defaultdict
from PIL import Image,ImageDraw
import numpy as np

CUTTER="""
const tunnelById = JSON.parse(await readFile(process.env.TUNNEL_LINES,'utf8'));
function daylightParts(id,a,b) {
  const lines=tunnelById[id]; if(!lines) return [[a,b]];
  const lx=b[0]-a[0],ly=b[1]-a[1],l=Math.hypot(lx,ly);if(!l)return [];
  const dx=lx/l,dy=ly/l, cuts=[];
  for(const line of lines) for(let j=1;j<line.length;j++){
    const u=line[j-1],v=line[j],vx=v[0]-u[0],vy=v[1]-u[1],vl=Math.hypot(vx,vy);
    if(!vl||Math.abs(dx*vx+dy*vy)<.94*vl)continue;
    const lateral=p=>(p[1]-a[1])*dx-(p[0]-a[0])*dy, cu=lateral(u),cv=lateral(v);
    let t0=0,t1=1;
    if(Math.abs(cv-cu)<1e-8){if(Math.abs(cu)>1.8)continue;}
    else{const ends=[(-1.8-cu)/(cv-cu),(1.8-cu)/(cv-cu)].sort((m,n)=>m-n);t0=Math.max(0,ends[0]);t1=Math.min(1,ends[1]);if(t1<=t0)continue;}
    const s=(u[0]-a[0])*dx+(u[1]-a[1])*dy, delta=vx*dx+vy*dy, ss=[s+delta*t0,s+delta*t1].sort((m,n)=>m-n);
    const low=Math.max(0,ss[0]),high=Math.min(l,ss[1]);if(high>low)cuts.push([low,high]);
  }
  const parts=[],at=s=>[a[0]+dx*s,a[1]+dy*s];let last=0;
  for(const [s,t] of cuts.sort((m,n)=>m[0]-n[0])){if(s-last>.35)parts.push([at(last),at(s)]);last=Math.max(last,t);}
  if(l-last>.35)parts.push([at(last),b]);return parts;
}
"""


def run(source,scratch):
    root=source/'tiles';scratch=scratch.resolve(); build=scratch/'night-bake';build.mkdir(exist_ok=True)
    lines=scratch/'night-lines.json';data=json.loads(lines.read_bytes());index=json.loads((root/'index.json').read_bytes())
    output=Path(__file__).resolve().parents[1]/'landscape-web/places/night'
    flags=defaultdict(list)
    for roads in data.values():
        for line in roads:
            xs,ys=zip(*line)
            for level,m in enumerate((5120,20480,81920),1):
                for x in range(int((min(xs)-350)//m),int((max(xs)+350)//m)+1):
                    for y in range(int((min(ys)-350)//m),int((max(ys)+350)//m)+1):
                        flags[level,f'F{x}_{y}'].append(line)
    shutil.copyfile(root/'index.json',build/'index.json')
    for level,rows in [(1,index['far']),(2,index['farLod']['levels']['2']['blocks']),(3,index['farLod']['levels']['3']['blocks'])]:
        directory='far' if level==1 else 'far'+str(level)
        for name in rows:
            dest=build/directory/name;dest.mkdir(parents=True,exist_ok=True)
            for file in ('far.json','mask.png'):
                shutil.copyfile(root/directory/name/file,dest/file)
    selected=','.join(name for lv,name in flags if lv==2 and name in index['farLod']['levels']['2']['blocks'])
    env=dict(os.environ,TILES_DIR=str(build),TUNNEL_LINES=str(lines))
    for script in ('far-night','far-nightmap'):
        code=(source/'landscape/bake'/(script+'.mjs')).read_text()
        code=code.replace("from '../", "from '"+(source/'landscape').as_uri()+"/")
        token="const segCache ="
        if code.count(token)!=1:raise ValueError(token)
        code=code.replace(token,CUTTER+token)
        start='const a = pr(c[0], c[1]), q = pr(c[2], c[3]);'
        end="keys.push(nm ?" if script=='far-nightmap' else 'arr.push(a[0], a[1], q[0], q[1], w);'
        stop=code.index(';',code.index(end))+1
        code=code[:stop]+' }'+code[stop:]
        assert code.count(start)==1
        code=code.replace(start,"for(const [a,q] of daylightParts(p.id,pr(c[0],c[1]),pr(c[2],c[3]))) {")
        f=build/(script+'.mjs');f.write_text(code)
        subprocess.run(['node',str(f),'--l2',selected],check=True,env=env)
    updates={}
    for (lv,name),rays in flags.items():
        d='far' if lv==1 else 'far'+str(lv);ix,iy=map(int,name[1:].split('_'));m=5120*4**(lv-1)
        for rel in ([f'night/{d}/{name}.png'] if lv<3 else [])+[f'{d}/{name}/mask.png']:
            if not (root/rel).exists() or not (build/rel).exists():continue
            with Image.open(root/rel) as im: old=np.array(im.convert('RGB'))
            with Image.open(build/rel) as im: new=np.array(im.convert('RGB'))
            size=len(old);is_mask=rel.endswith('mask.png')
            if is_mask and not np.array_equal(old[:,:,1:],new[:,:,1:]):raise ValueError(rel)
            mask=Image.new('1',(size,size));draw=ImageDraw.Draw(mask)
            for line in rays:
                xy=[((x/m-ix)*size,(iy+1-y/m)*size) for x,y in line]
                draw.line(xy,fill=1,width=max(2,round(2*280/m*size)))
            changed=np.any(old!=new,axis=2)&np.array(mask,dtype=bool)
            if not np.any(changed):continue
            rgba=np.zeros((size,size,4),dtype=np.uint8);rgba[changed,:3]=new[changed];rgba[changed,3]=255
            dest=output/rel;dest.parent.mkdir(parents=True,exist_ok=True)
            Image.fromarray(rgba).save(dest,optimize=True)
            updates[rel]=[(root/rel).stat().st_size,hashlib.sha256((root/rel).read_bytes()).hexdigest()[:24]]
    (output/'index.json').write_text(json.dumps(updates,separators=(',',':'))+'\n')
    print('夜景差異圖磚',len(updates),flush=True)


if __name__=='__main__':run(Path(sys.argv[1]),Path(sys.argv[2]))
