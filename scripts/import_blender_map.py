"""唯讀 Blender 車庫 Raw，產生地圖 LOD／中間車／輕軌分節；不改來源 blend 或 GLB。"""
import bpy,json,hashlib,struct,math,array,sys,argparse,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source',type=Path,default=ROOT/'prototypes/tiny-trains/blender/fleet-v1')
parser.add_argument('--models',nargs='+',required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
SRC=args.source.resolve()
OUT=ROOT/'rail-3d/assets/blender-map-v1';OUT.mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
catalog=json.loads((SRC/'catalog.json').read_text())
manifest={'schema':'railisland.blender-map-fleet/1','source':{'file':'prototypes/tiny-trains/blender/fleet-v1/release.json','sha256':sha((SRC/'release.json').read_bytes())},'axes':{'front':'+X','left':'+Y','up':'+Z','groundAnchor':[0,0,0]},'illustrative':True,'note':'Blender 精修車庫的地圖衍生 LOD。編組／真實長度由行車端管理；中間車沿用後半車體鏡射，分節不是完整剛性列車。','models':{},'meshes':{}}

requested=args.models
unknown=set(requested)-{m['id'] for m in catalog}
if unknown:raise ValueError('找不到來源車型：'+','.join(sorted(unknown)))
if requested:
 manifest=json.loads((OUT/'manifest.json').read_text());catalog=[m for m in catalog if m['id'] in requested]

def clip(tri,bound,above):
 out=[]
 for a,b in zip(tri,tri[1:]+tri[:1]):
  aa=a[0]>=bound if above else a[0]<=bound;bb=b[0]>=bound if above else b[0]<=bound
  if aa:out.append(a)
  if aa!=bb:
   t=(bound-a[0])/(b[0]-a[0]);out.append(tuple(x+(y-x)*t for x,y in zip(a,b)))
 return [out[:1]+out[i:i+2] for i in range(1,len(out)-1)]

def sliced(tris,lo,hi):
 for tri,mat in tris:
  for t in clip(tri,lo,True):
   for q in clip(t,hi,False):yield q,mat

def export(id,tris,groups,source,translate=0):
 values=array.array('f');mins=[math.inf]*3;maxs=[-math.inf]*3
 for tri,mat in tris:
  a,b,c=tri;u=[b[k]-a[k] for k in range(3)];v=[c[k]-a[k] for k in range(3)];face=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];fn=math.sqrt(sum(n*n for n in face))
  group=groups[mat];linear=group['color'];rgb=[12.92*x if x<=.0031308 else 1.055*x**(1/2.4)-.055 for x in linear];gloss=1-group.get('roughness',.5)
  for p in tri:
   xyz=[p[0]-translate,p[1],max(0,p[2])];normal=p[3:6];norm=math.sqrt(sum(n*n for n in normal))
   if norm<1e-8:normal=[n/fn for n in face] if fn>1e-12 else [0,0,1];norm=1
   values.extend([*xyz,*[n/norm for n in normal],*rgb,gloss])
   for k in range(3):mins[k]=min(mins[k],xyz[k]);maxs[k]=max(maxs[k],xyz[k])
 if not values:raise ValueError(id+' 空網格')
 data=values.tobytes();(OUT/(id+'.bin')).write_bytes(data)
 manifest['meshes'][id]={'file':id+'.bin','sha256':sha(data),'byteLength':len(data),'vertexCount':len(values)//10,'min':mins,'max':maxs,'source':source,'appearance':'blender-map-lod'}

for item in catalog:
 id=item['id'];path=(SRC/item['metadata']).resolve();meta=json.loads(path.read_text());rawpath=path.parent/meta['mesh']['file'];raw=rawpath.read_bytes()
 if sha(raw)!=meta['mesh']['sha256']:raise ValueError(id+' 來源雜湊不符')
 source={'metadata':'prototypes/tiny-trains/blender/fleet-v1/'+os.path.relpath(path,SRC),'rawSha256':sha(raw),'engineeringDimensionsM':meta.get('engineeringDimensionsM'),'releaseSha256':sha((SRC/'release.json').read_bytes())}
 data=list(struct.iter_unpack('<6f',raw));groups=meta['mesh']['drawGroups'];identity=meta.get('identityMaterial') or meta.get('fleetNumberMaterial')
 vertices=[];faces=[];indices={};materials=[];normals=[]
 for gi,g in enumerate(groups):
  if identity and g['name']==identity:continue
  for i in range(g['start'],g['start']+g['count'],3):
   face=[]
   for p in data[i:i+3]:
    key=tuple(round(x,6) for x in p[:3])
    if key not in indices:indices[key]=len(vertices);vertices.append(p[:3])
    face.append(indices[key])
   a,b,c=[vertices[j] for j in face];u=[b[k]-a[k] for k in range(3)];v=[c[k]-a[k] for k in range(3)];cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
   if len(set(face))<3 or sum(x*x for x in cross)<1e-18:continue
   faces.append(face);materials.append(gi);normals.extend(p[3:] for p in data[i:i+3])
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 mesh=bpy.data.meshes.new(id);mesh.from_pydata(vertices,[],faces);mesh.update()
 for g in groups:mesh.materials.append(bpy.data.materials.new(g['name']))
 for p,gi in zip(mesh.polygons,materials):p.material_index=gi;p.use_smooth=True
 if not mesh.validate() and len(normals)==len(mesh.loops):mesh.normals_split_custom_set(normals)
 obj=bpy.data.objects.new(id,mesh);bpy.context.collection.objects.link(obj);bpy.context.view_layer.objects.active=obj;obj.select_set(True)
 dec=obj.modifiers.new('地圖 LOD','DECIMATE');dec.ratio=min(1,8000/len(faces));dec.use_collapse_triangulate=True
 bpy.ops.object.modifier_apply(modifier=dec.name)
 mesh=obj.data;mesh.calc_loop_triangles();tris=[]
 for tri in mesh.loop_triangles:
  coords=[]
  for vi,li in zip(tri.vertices,tri.loops):coords.append(tuple(mesh.vertices[vi].co)+tuple(mesh.corner_normals[li].vector))
  tris.append((coords,tri.material_index))
 export(id,tris,groups,source)
 family=item['family'];parts=[{'mesh':id,'flip':False}];articulated=family=='tram'
 if articulated:
  centers=meta['specification']['articulationCenters'];cuts=[manifest['meshes'][id]['min'][0]]
  for a,b in zip(centers,centers[1:]):cuts.append((a['centerX']+a['length']/2+b['centerX']-b['length']/2)/2)
  cuts.append(manifest['meshes'][id]['max'][0]);parts=[]
  for i in range(5):
   k=4-i;pid=id+'-section-'+str(i);export(pid,sliced(tris,cuts[k],cuts[k+1]),groups,source,(cuts[k]+cuts[k+1])/2);parts.append({'mesh':pid,'flip':False})
 elif family in ['metro','railcar','express']:
  # 柴油客車兩端有駕駛室，不偽裝無駕駛室中間車。
  if id in ['dr1000','dr2700']:mid=id
  else:
   mid=id+'-mid';rear=list(sliced(tris,manifest['meshes'][id]['min'][0],0));mirrored=[([(-p[0],p[1],p[2],-p[3],p[4],p[5]) for p in reversed(t)],mat) for t,mat in rear];export(mid,rear+mirrored,groups,source)
  parts=[{'mesh':id,'flip':False},{'mesh':mid,'flip':False},{'mesh':id,'flip':True}]
 elif id=='e1000':parts=[{'mesh':id,'flip':False},{'mesh':'ppcoach','flip':False},{'mesh':id,'flip':True}]
 elif family in ['forestloco','hood','electric']:
  coach='alicoach' if family=='forestloco' else 'bluecoach' if id=='blue' else 'mingricoach' if id=='mingri' else 'juguang'
  parts=[{'mesh':id,'flip':False},{'mesh':coach,'flip':False},{'mesh':coach,'flip':False}]
 elif family in ['coach','forestcoach']:parts=[{'mesh':id,'flip':False}]*3
 manifest['models'][id]={'id':id,'name':item['name'],'family':family,'articulated':articulated,'parts':parts,'illustrative':True,'appearance':'blender-map-lod','source':source,'sources':item.get('sources',[])}
 print(id,len(tris),'三角形',flush=True)
 bpy.data.meshes.remove(mesh) if mesh.users==0 else None
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('完成',len(manifest['models']),len(manifest['meshes']),flush=True)
