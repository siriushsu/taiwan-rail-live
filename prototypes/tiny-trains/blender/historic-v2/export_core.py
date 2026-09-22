"""軌島建築原生 Blender 建模。米制、獨立部件、地圖近景與遠景網格。"""
import bpy,bmesh,math,json,struct,hashlib,sys,os
from pathlib import Path
from mathutils import Vector,Matrix
P=Path(__file__).resolve().parent
M={};OB=[];PART='main';DETAIL=False;SC=None
COLORS={'stone':'C9BDA6','white':'E5E3D9','glass':'527A82','blueglass':'557684','green':'438985','metal':'A9B5B7','dark':'394851','red':'984B3D','tile':'B85842','gold':'C99438','blue':'2C527D','brown':'988475','cream':'DCD4C1','roof':'A8B6B5','grass':'718B60','smoke':'777F83'}
def mat(key):
 h=COLORS[key];rgb=[int(h[i:i+2],16)/255 for i in (0,2,4)];rgb=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
 m=bpy.data.materials.new(key);m.use_nodes=True;m.diffuse_color=(*rgb,1);p=m.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=(*rgb,1);p.inputs['Roughness'].default_value=.3 if 'glass' in key or key=='green' else .57;p.inputs['Metallic'].default_value=.45 if key=='metal' else .22 if 'glass' in key or key=='green' else .05;return m

def reset(spec):
 global M,OB,PART,DETAIL,SC
 bpy.ops.wm.read_factory_settings(use_empty=True);SC=bpy.context.scene;SC.unit_settings.system='METRIC';SC.unit_settings.scale_length=1;SC.world=bpy.data.worlds.new('紙白柔光');SC.world.use_nodes=True;SC.world.node_tree.nodes['Background'].inputs[0].default_value=(.65,.72,.8,1);SC.world.node_tree.nodes['Background'].inputs[1].default_value=.6
 bpy.context.preferences.filepaths.save_version=0;M={k:mat(k) for k in COLORS};OB=[];PART='main';DETAIL=False
 SC['model_id']=spec['id'];SC['axes']='X right / Y back / Z up; station complexes already ENU';SC['geometry_scope']='地圖外觀模型，非測繪、結構或室內模型';SC['source_photos_included']=False

def mesh(name,v,f,material,bevel=0,smooth=False):
 if not f:return None
 d=bpy.data.meshes.new(name);d.from_pydata(v,[],f);d.update();bm=bmesh.new();bm.from_mesh(d);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(d);bm.free();o=bpy.data.objects.new(name,d);SC.collection.objects.link(o);d.materials.append(M[material]);o['component_id']=PART;o['near_only']=DETAIL;OB.append(o)
 if smooth:
  for p in d.polygons:p.use_smooth=True
 if bevel:
  b=o.modifiers.new('地圖尺度倒角','BEVEL');b.width=bevel;b.segments=2;o.modifiers.new('平面加權法線','WEIGHTED_NORMAL')
 return o

def box(name,x,y,z,w,d,h,m,bevel=0):
 if min(w,d,h)<=0:raise ValueError(name)
 v=[(x+a*w/2,y+b*d/2,z+c*h/2) for a,b,c in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]]
 return mesh(name,v,[(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)],m,bevel)

def rod(name,a,b,r,m,n=6):
 axis=Vector(b)-Vector(a)
 if axis.length<1e-6:return
 u=axis.normalized().cross(Vector((0,0,1)))
 if u.length<.01:u=axis.normalized().cross(Vector((0,1,0)))
 u.normalize();w=axis.normalized().cross(u);v=[tuple(Vector(p)+r*(math.cos(i*2*math.pi/n)*u+math.sin(i*2*math.pi/n)*w)) for p in [a,b] for i in range(n)]
 return mesh(name,v,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],m,smooth=True)

def polyextrude(name,poly,z,h,m):
 n=len(poly);return mesh(name,[(x,y,zz) for zz in [z,z+h] for x,y in poly],[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],m)

def taper(name,x,y,z,w,d,topw,topd,h,m):
 v=[(x+xx*ww/2,y+yy*dd/2,zz) for ww,dd,zz in [(w,d,z),(topw,topd,z+h)] for xx,yy in [(-1,-1),(1,-1),(1,1),(-1,1)]]
 return mesh(name,v,[(3,2,1,0),(4,5,6,7)]+[(i,(i+1)%4,(i+1)%4+4,i+4) for i in range(4)],m)

def facade(x,y,z,w,d,h,glass='glass',frame='metal',floor=5,vertical=8):
 global DETAIL
 box('帷幕量體',x,y,z+h/2,w,d,h,glass)
 for zz in range(1,max(2,int(h/floor))):
  zp=z+h*zz/max(2,int(h/floor));box('水平樓板線',x,y,zp,w+.18,d+.18,.34,frame)
 DETAIL=True
 for side in [-1,1]:
  for i in range(1,max(2,int(w/vertical))):box('正背立面豎框',x-w/2+w*i/max(2,int(w/vertical)),y+side*(d/2+.16),z+h/2,.38,.26,h,frame)
  for i in range(1,max(2,int(d/vertical))):box('側立面豎框',x+side*(w/2+.16),y-d/2+d*i/max(2,int(d/vertical)),z+h/2,.26,.38,h,frame)
 DETAIL=False

def line(name,pts,r,m):
 # 屋面細線採兩面薄帶，避免每條瓦壟都變成數十節圓管。
 if any(k in name for k in ['瓦壟','屋面肋條','紅瓦屋脊','鈦板縱向','蛋殼環向']):
  if len(pts)<2:return
  v=[]
  for i,p in enumerate(pts):
   before=pts[max(0,i-1)];after=pts[min(len(pts)-1,i+1)];dx=after[0]-before[0];dy=after[1]-before[1];length=max(math.hypot(dx,dy),1e-6)
   v.extend([(p[0]-dy/length*r,p[1]+dx/length*r,p[2]),(p[0]+dy/length*r,p[1]-dx/length*r,p[2])])
  return mesh(name,v,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(pts)-1)],m)
 for a,b in zip(pts,pts[1:]):rod(name,a,b,r,m)

def roof(name,w,d,eave,rise,m='gold',gable=False,xy=(0,0),ribs=True):
 """曲線出簷的四坡頂；歇山頂增加垂直三角山牆。"""
 global DETAIL
 x0,y0=xy;ridge=max(0,w*.5-d*.36);rings=10
 def pos(side,t,u):
  # t=0 為屋脊，t=1 為出簷。
  a=ridge+(w/2-ridge)*t;b=d/2*t
  if side==0:x,y=u*a,-b
  elif side==1:x,y=a,u*b
  elif side==2:x,y=-u*a,b
  else:x,y=-a,-u*b
  z=eave+rise*(1-t)**1.7+rise*.17*(abs(u)**5)*t**6
  return (x+x0,y+y0,z)
 for side in range(4):
  v=[pos(side,i/rings,j/12*2-1) for i in range(rings+1) for j in range(13)];f=[(i*13+j,i*13+j+1,(i+1)*13+j+1,(i+1)*13+j) for i in range(rings) for j in range(12)];mesh(name+' 曲面',v,f,m)
  line('簷口收邊',[pos(side,1,j/24*2-1) for j in range(25)],.35,m)
  if ribs:
   DETAIL=True
   for j in range(0,25,2):line('瓦壟', [pos(side,i/rings,j/24*2-1) for i in range(rings+1)],.10,m)
   DETAIL=False
 if gable:
  # 歇山的上段兩端豎直山牆與兩片坡頂；下層四面出簷仍保留。
  for sx in [-1,1]:
   x=x0+sx*(ridge+3);mesh('歇山頂三角山牆',[(x,y0-d*.23,eave+rise*.37),(x,y0+d*.23,eave+rise*.37),(x,y0,eave+rise*1.04)],[(0,1,2)],'red')
  for sy in [-1,1]:mesh('歇山上層斜坡',[(x0-ridge-4,y0,eave+rise*1.04),(x0+ridge+4,y0,eave+rise*1.04),(x0+ridge+4,y0+sy*d*.25,eave+rise*.37),(x0-ridge-4,y0+sy*d*.25,eave+rise*.37)],[(0,1,2,3)],m)
 line('屋脊',[(-ridge+x0,y0,eave+rise),(ridge+x0,y0,eave+rise)],.55,m)

def steps(x,y,w,d,h,n=12):
 for i in range(n):box('入口階梯',x,y+d*i/(2*n),h*(i+.5)/n,w,d*(1-i/n),h/n,'white')

def arch(x,y,z,w,h,m='dark'):
 # 平面的凹口陰影與立體弧形邊框，地圖尺度不需建造內部隧道。
 pts=[(x-w/2,y,z),(x+w/2,y,z)]+[(x+math.cos(i*math.pi/12)*w/2,y,z+h-w/2+math.sin(i*math.pi/12)*w/2) for i in range(13)]
 mesh('拱形門窗',pts,[tuple(range(len(pts)))],m)
 line('拱形門窗石框',[(px,py-.18,pz) for px,py,pz in pts[2:]],.35,'white')

def colonnade(w,d,z,h,m='red',n=10,side_n=None):
 side_n=side_n or n
 for s in [-1,1]:
  for i in range(n):
   x=-w/2+w*i/(n-1);rod('柱廊圓柱',(x,s*d/2,z),(x,s*d/2,z+h),.85,m,10);box('柱頭斗拱',x,s*d/2,z+h,2.8,2.5,1,'green')
  for i in range(1,side_n-1):
   y=-d/2+d*i/(side_n-1);rod('側廊柱',(s*w/2,y,z),(s*w/2,y,z+h),.85,m,10)


exec(compile((P/"geometry.py").read_text(),str(P/"geometry.py"),"exec"))
def export(s):
 out=P/'models'/s['id'];out.mkdir(parents=True,exist_ok=True);deps=bpy.context.evaluated_depsgraph_get();inventory=[]
 for o in OB:o['asset_id']=s['id'];inventory.append({'name':o.name,'component':o['component_id'],'nearOnly':bool(o['near_only'])})
 levels={};bounds=None
 for level in ['near','far']:
  buckets={};lo=Vector((math.inf,)*3);hi=-lo
  for o in OB:
   if level=='far' and o['near_only']:continue
   ev=o.evaluated_get(deps);d=ev.to_mesh();d.calc_loop_triangles();wm=o.matrix_world;nm=wm.to_3x3().inverted_safe().transposed()
   for tri in d.loop_triangles:
    if tri.area<1e-8:continue
    m=d.materials[tri.material_index];key=(o['component_id'],m.name);item=buckets.setdefault(key,{'material':m,'v':[]})
    for li in tri.loops:
     p=wm@d.vertices[d.loops[li].vertex_index].co;n=(nm@d.corner_normals[li].vector).normalized()
     if not all(math.isfinite(k) for k in (*p,*n)):raise ValueError('網格含非有限座標')
     item['v'].extend((*p,*n))
     for j in range(3):lo[j]=min(lo[j],p[j]);hi[j]=max(hi[j],p[j])
   ev.to_mesh_clear()
  data=bytearray();groups=[];count=0;exports=[];col=bpy.data.collections.new('90 匯出暫存 '+level);SC.collection.children.link(col)
  for (comp,name),it in buckets.items():
   v=it['v'];n=len(v)//6;m=it['material'];bs=m.node_tree.nodes['Principled BSDF'];data.extend(struct.pack('<%sf'%len(v),*v));groups.append({'component':comp,'name':name,'start':count,'count':n,'color':list(bs.inputs['Base Color'].default_value)[:3],'metalness':bs.inputs['Metallic'].default_value,'roughness':bs.inputs['Roughness'].default_value});count+=n
   d=bpy.data.meshes.new(comp+' '+name);d.from_pydata([v[i:i+3] for i in range(0,len(v),6)],[],[(i,i+1,i+2) for i in range(0,n,3)]);d.materials.append(m);d.update();d.normals_split_custom_set_from_vertices([v[i+3:i+6] for i in range(0,len(v),6)]);o=bpy.data.objects.new(comp+' '+name,d);col.objects.link(o);o['component_id']=comp;exports.append(o)
  (out/f'{level}.mesh.bin').write_bytes(data);bpy.ops.object.select_all(action='DESELECT')
  for o in exports:o.select_set(True)
  bpy.context.view_layer.objects.active=exports[0];bpy.ops.export_scene.gltf(filepath=str(out/f'{level}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_normals=True,export_texcoords=False,export_extras=True)
  levels[level]={'file':f'{level}.mesh.bin','glb':f'{level}.glb','sha256':hashlib.sha256(data).hexdigest(),'glbSha256':hashlib.sha256((out/f'{level}.glb').read_bytes()).hexdigest(),'strideBytes':24,'vertexCount':count,'triangleCount':count//3,'drawGroups':groups,'byteLength':len(data)}
  if level=='near':bounds={'min':list(lo),'max':list(hi)}
  for o in exports:bpy.data.objects.remove(o,do_unlink=True)
  bpy.data.collections.remove(col)
 size=[bounds['max'][i]-bounds['min'][i] for i in range(3)];meta={k:v for k,v in s.items() if k not in ['components']};meta.update(version=1,application=bpy.app.version_string,axes={'up':'+Z','right':'+X','front':'-Y','units':'meters','groundAnchor':[0,0,0]},gltfAxes={'up':'+Y','toZUp':'rotateX(+PI/2)'},orientationMode=s.get('orientationMode','local-facade'),facadeBearingDeg=s.get('facadeBearingDeg'),absoluteGroundAltitudeM=None,engineeringDimensionsM=None,bounds=bounds,sizeM=size,lods=levels,nativeObjectCount=len(OB),sourcePhotosIncluded=False,operatorLogoIncluded=False,modelUse='map-exterior',components=[{k:v for k,v in c.items() if k not in ['polygons','roofTriangles']} for c in s['components']])
 if s.get('orientationMode')=='ENU-baked':meta['axes']={'up':'+Z','east':'+X','north':'+Y','front':None,'units':'meters','groundAnchor':[0,0,0]}
 (out/'model.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n');(out/'objects.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2)+'\n')
 # 原生物件和材質保留；攝影棚不進入 glb / raw。
 SC.render.engine='CYCLES';SC.cycles.samples=8;SC.cycles.use_denoising=True;SC.view_settings.view_transform='AgX';SC.render.resolution_x=660;SC.render.resolution_y=540;SC.render.resolution_percentage=100
 extent=max(size);mid=(Vector(bounds['min'])+Vector(bounds['max']))/2
 floor=box('展示地面，不匯出',0,0,-.12,extent*12,extent*12,.2,'cream');OB.remove(floor);floor['is_studio']=True
 def area(name,loc,energy,sz):
  d=bpy.data.lights.new(name,'AREA');o=bpy.data.objects.new(name,d);SC.collection.objects.link(o);o.location=loc;d.energy=energy;d.shape='DISK';d.size=sz;o.rotation_euler=(mid-o.location).to_track_quat('-Z','Y').to_euler()
 area('主光',mid+Vector((extent,-extent,extent*1.8)),extent*extent*65,extent*1.5);area('補光',mid+Vector((-extent,extent*.3,extent)),extent*extent*30,extent)
 d=bpy.data.cameras.new('地圖近景正交相機');cam=bpy.data.objects.new('地圖近景相機',d);SC.collection.objects.link(cam);SC.camera=cam;d.type='ORTHO';d.clip_end=extent*30;cam.location=mid+Vector((extent*1.6,-extent*2,extent*1.4));cam.rotation_euler=(mid-cam.location).to_track_quat('-Z','Y').to_euler();d.ortho_scale=max(math.hypot(size[0],size[1])*1.10,size[2]*1.34)
 for screen in bpy.data.screens:
  for a in screen.areas:
   if a.type=='VIEW_3D':a.spaces.active.region_3d.view_distance=extent*1.8;a.spaces.active.region_3d.view_location=mid;a.spaces.active.region_3d.view_rotation=cam.rotation_euler.to_quaternion()
 bpy.ops.object.select_all(action='DESELECT');OB[0].select_set(True);bpy.context.view_layer.objects.active=OB[0];bpy.ops.wm.save_as_mainfile(filepath=str(out/(s['id']+'.blend')))
 if os.environ.get('LANDMARK_RENDER','1')=='1':SC.render.image_settings.file_format='PNG';SC.render.filepath=str(out/'hero.png');bpy.ops.render.render(write_still=True)
 print('BUILDING_OK '+json.dumps({'id':s['id'],'triangles':{k:v['triangleCount'] for k,v in levels.items()},'objects':len(OB)},ensure_ascii=False),flush=True)
 return meta

