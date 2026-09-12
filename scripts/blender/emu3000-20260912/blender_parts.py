"""Blender 原生可編修網格工坊。材質皆為自行指定的 PBR 色值，無相片貼圖。"""
import bpy,math,bmesh,json,struct,hashlib,os
from pathlib import Path
from mathutils import Vector,Matrix
MODEL=[];COL={};ACTIVE=None;M={};SCENE=None

def reset(spec):
 global MODEL,COL,ACTIVE,M,SCENE
 bpy.ops.wm.read_factory_settings(use_empty=True)
 SCENE=bpy.context.scene;SCENE.world=bpy.data.worlds.new('柔光環境');SCENE.world.use_nodes=True
 SCENE.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.76,.80,.84,1)
 SCENE.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.38
 SCENE.unit_settings.system='METRIC';SCENE.unit_settings.scale_length=1
 bpy.context.preferences.filepaths.save_version=0
 MODEL=[];COL={}
 for n in ['01 車殼與塗裝','02 窗門與細框','03 燈組與車頭','04 底盤與輪軸','05 車頂與機構','06 可換識別牌','07 編組接合','90 攝影棚']:
  c=bpy.data.collections.new(n);SCENE.collection.children.link(c);COL[n[:2]]=c
 ACTIVE=COL['01'];M={}
 colors={'body':spec['body'],'accent':spec['accent'],'frame':'172329','glass':'183544','metal':'97A7AC','roof':'B6BFC0','chassis':'34424A','rubber':'20272A','white':'F0ECD9','lamp':'FFF2C9','red':'B03733','blue':'245799','yellow':'ECC147','gold':'B89A5A','dark':'303E45','cream':'E9DEBE','orange':'E77C33','wood':'AE7645'}
 for key,h in colors.items():
  metallic=.64 if key=='metal' else .37 if key in ['roof','chassis'] else .26 if key=='glass' else .10
  rough=.19 if key=='glass' else .77 if key=='rubber' else .38
  M[key]=mat(key,h,metallic,rough,.42 if key=='glass' else .18)
 # 識別牌的材質獨立；不得把車型名稱當即時車籍號。
 M['identity']=mat('可移除車型示意牌','E8E1CC',.1,.4,0)
 SCENE['model_id']=spec['id'];SCENE['axes']='front +X / left +Y / up +Z';SCENE['units']='Q-proportioned meters';SCENE['source_photos_included']=False
 return SCENE

def use(key):
 global ACTIVE
 ACTIVE=COL[key]
def linear(v):return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
def mat(name,h,metal=0,rough=.4,coat=0):
 rgb=[linear(int(h[i:i+2],16)/255) for i in (0,2,4)]
 m=bpy.data.materials.new(name);m.diffuse_color=(*rgb,1);m.use_nodes=True;p=m.node_tree.nodes['Principled BSDF']
 p.inputs['Base Color'].default_value=(*rgb,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;p.inputs['Coat Weight'].default_value=coat
 return m

def finish(o,material,bevel=0,smooth=False):
 o.data.materials.append(M.get(material,material))
 if smooth:
  for p in o.data.polygons:p.use_smooth=True
 if bevel:
  m=o.modifiers.new('可調倒角','BEVEL');m.width=bevel;m.segments=3
  m=o.modifiers.new('面加權法線','WEIGHTED_NORMAL');m.keep_sharp=True
 return o

def mesh(name,verts,faces,material,bevel=0,smooth=False,model=True):
 d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update()
 bm=bmesh.new();bm.from_mesh(d);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(d);bm.free()
 o=bpy.data.objects.new(name,d);ACTIVE.objects.link(o)
 if model:MODEL.append(o)
 return finish(o,material,bevel,smooth)
def box(name,loc,dims,material,bevel=.02,model=True):
 x,y,z=loc;a,b,c=[v/2 for v in dims]
 return mesh(name,[(x+i*a,y+j*b,z+k*c) for i,j,k in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]],[(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)],material,min(bevel,min(dims)/3),model=model)
def cyl(name,loc,r,depth,material,axis='Z',n=28,bevel=.006):
 v=[]
 for d in [-depth/2,depth/2]:
  for i in range(n):
   a=2*math.pi*i/n;u=r*math.cos(a);w=r*math.sin(a)
   p=(d,u,w) if axis=='X' else (u,d,w) if axis=='Y' else (u,w,d)
   v.append(tuple(loc[k]+p[k] for k in range(3)))
 faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 return mesh(name,v,faces,material,bevel,True)
def rod(name,a,b,r,material,n=10):
 va,vb=Vector(a),Vector(b);delta=vb-va
 if delta.length<1e-7:return
 axis=delta.normalized();u=axis.cross(Vector((0,0,1)))
 if u.length<.01:u=axis.cross(Vector((0,1,0)))
 u.normalize();v=axis.cross(u);verts=[]
 for p in [va,vb]:
  for i in range(n):verts.append(tuple(p+r*(math.cos(2*math.pi*i/n)*u+math.sin(2*math.pi*i/n)*v)))
 faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 return mesh(name,verts,faces,material,0,True)
def line(name,points,r,material):
 for a,b in zip(points,points[1:]):rod(name,a,b,r,material)
def rounded(w,h,r,steps=5):
 r=min(r,w/2,h/2);p=[]
 for cx,cy,base in [(w/2-r,h/2-r,0),(-w/2+r,h/2-r,90),(-w/2+r,-h/2+r,180),(w/2-r,-h/2+r,270)]:
  for i in range(steps+1):
   a=math.radians(base+90*i/steps);p.append((cx+r*math.cos(a),cy+r*math.sin(a)))
 return p

def panel(name,center,w,h,material,plane='side',r=.055,depth=.018,surface=None):
 pts=rounded(w,h,r);v=[]
 for d in [-depth/2,depth/2]:
  for u,z in pts:
   if plane=='side':v.append((center[0]+u,center[1]+d,center[2]+z))
   else:
    yy=center[1]+u;zz=center[2]+z
    v.append(((surface(yy,zz) if surface else center[0])+d,yy,zz))
 n=len(pts);faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 # 凹凸車鼻的面片切成條帶，避免單一 n-gon 把曲面跨平。
 if surface:
  rows=16;cols=16;verts=[]
  for iz in range(rows+1):
   zz=center[2]-h/2+h*iz/rows;dz=abs(zz-center[2]);half=w/2
   if dz>h/2-r:half=w/2-r+math.sqrt(max(0,r*r-(dz-(h/2-r))**2))
   for iy in range(cols+1):
    yy=center[1]+half*(2*iy/cols-1);verts.append((surface(yy,zz)+depth/2,yy,zz))
  faces=[(i*(cols+1)+j,i*(cols+1)+j+1,(i+1)*(cols+1)+j+1,(i+1)*(cols+1)+j) for i in range(rows) for j in range(cols)]
  return mesh(name,verts,faces,material,0,True)
 return mesh(name,v,faces,material)

def text_label(value,loc,size=.16,axis='front',side=1):
 use('06');d=bpy.data.curves.new('可編修車型字牌','FONT');d.body=value;d.size=size;d.align_x='CENTER';d.align_y='CENTER';d.extrude=.001;d.bevel_depth=.0005;d.resolution_u=4
 o=bpy.data.objects.new('識別牌 '+value,d);ACTIVE.objects.link(o);MODEL.append(o);o.location=loc
 if axis=='front':o.rotation_euler=Matrix(((0,0,1),(1,0,0),(0,1,0))).to_euler()
 else:o.rotation_euler=Matrix(((-side,0,0),(0,0,side),(0,1,0))).to_euler()
 d.materials.append(M['identity']);o['identity_is_live']=False;o['identity_axis']=axis
 return o

def torus_y(name,center,R,r,material,n=36,m=6):
 v=[]
 for i in range(n):
  a=2*math.pi*i/n
  for j in range(m):
   b=2*math.pi*j/m;rr=R+r*math.cos(b);v.append((center[0]+rr*math.cos(a),center[1]+r*math.sin(b),center[2]+rr*math.sin(a)))
 return mesh(name,v,[(i*m+j,((i+1)%n)*m+j,((i+1)%n)*m+(j+1)%m,i*m+(j+1)%m) for i in range(n) for j in range(m)],material,0,True)

def wheel(x,y,r=.40,z=None,rubber=False,spoked=False):
 z=r if z is None else z;s=1 if y>0 else -1
 o=torus_y('鏤空蒸機動輪輪箍',(x,y,z),r-.045,.045,'chassis',n=40,m=10) if spoked else cyl('承重輪胎' if rubber else '鋼輪輪盤',(x,y,z),r,.20,'rubber' if rubber else 'chassis','Y',32)
 o['wheel_center']=True;o['radius']=r
 torus_y('輪緣',(x,y+s*.105,z),r*.90,.025,'metal' if not rubber else 'rubber')
 if spoked:
  for k in range(12):
   a=2*math.pi*k/12;rod('動輪輻條',(x,y+s*.12,z),(x+math.cos(a)*r*.85,y+s*.12,z+math.sin(a)*r*.85),.026,'chassis')
 cyl('輪軸端蓋',(x,y+s*.13,z),r*.27,.055,'metal','Y',24)
 return o

def bogies(L,W,axles=2,r=.40,rubber=False,centers=None):
 use('04');centers=centers or [-L*.31,L*.31]
 for b,c in enumerate(centers):
  xs=[c+(i-(axles-1)/2)*(.9 if axles==3 else 1.05) for i in range(axles)]
  box('轉向架構架',(c,0,.57),((max(xs)-min(xs))+.75,W*.64,.23),'chassis',.07)
  for x in xs:
   cyl('輪軸',(x,0,r),.10,W*.78,'chassis','Y',16)
   for y in [-W*.35,W*.35]:wheel(x,y,r,rubber=rubber)
  for s in [-1,1]:
   box('轉向架側樑',(c,s*W*.33,.64),(max(xs)-min(xs)+.73,.13,.22),'chassis',.045)
   for x in [c-.34,c+.34]:
    cyl('空氣彈簧',(x,s*W*.28,.85),.18,.16,'rubber',n=20)
    rod('煞車與避震連桿',(x-.18,s*W*.38,.42),(x+.20,s*W*.38,.78),.032,'metal')
 box('車底主梁',(0,0,.86),(L*.89,W*.72,.30),'chassis',.04)
 for i,x in enumerate([-.75,.55]):
  box('車下獨立設備箱',(x,0,.62),(.90,W*.6,.48),'roof',.04)
  for s in [-1,1]:
   for k in range(4):box('設備箱通風格柵',(x-.3+k*.2,s*(W*.30+.006),.62),(.06,.015,.30),'chassis',.004)

def coupler(x,W,end=1,z=.67,gangway=False):
 use('07');box('車鉤緩衝座',(x,0,z),(.32,.68,.26),'chassis',.035)
 box('密著車鉤頭',(x+end*.23,0,z),(.25,.43,.23),'metal',.045)
 for y in [-.10,.10]:cyl('車鉤接孔',(x+end*.363,y,z),.055,.012,'frame','X',20,0)
 for s in [-1,1]:line('柔性連接線',[(x,s*.47,z+.24),(x+end*.10,s*.53,z-.08),(x+end*.25,s*.36,z-.14)],.020,'rubber')
 if gangway:
  panel('端牆貫通門',(x,0,2.00),.87,1.75,'frame','front',r=.12)
  for i in range(5):panel('風琴接合折線',(x+end*(.05+i*.045),0,2.00),1.04,1.89,'rubber','front',r=.13,depth=.022)

def grille(name,x,y,z,w,h,side=True,n=10,vertical=False):
 use('05');panel(name+' 黑色底槽',(x,y,z),w,h,'frame','side' if side else 'front',r=.02)
 for i in range(n):
  if side:
   if vertical:box(name+' 窄直柵',(x-w*.46+w*.92*i/max(1,n-1),y*1.003,z),(.025,.017,h*.92),'roof',.003)
   else:box(name+' 百葉',(x,y*1.003,z-h*.43+h*.86*i/max(1,n-1)),(w*.94,.022,.021),'roof',.002)
  else:box(name+' 百葉',(x+.015,y,z-h*.43+h*.86*i/max(1,n-1)),(.022,w*.94,.021),'chassis',.002)

def roof_units(L,W,H,kind):
 use('05')
 if kind in ['flush','arch']:return
 if kind=='old-vents':
  for x in [-L*.33,-L*.16,0,L*.16,L*.33]:
   box('舊式低頂通風器',(x,0,H+.065),(.42,.54,.14),'roof',.045)
  return
 for i,x in enumerate([-L*.23,L*.19]):
  low=kind in ['twin-low','val-grilles'];z=H+.10;length=1.8 if L>8 else 1.35
  box('斜肩空調設備罩',(x,0,z),(length,W*.64,.22 if low else .31),'roof',.11)
  for s in [-1,1]:grille('空調側格柵',x,s*W*.315,z,length*.8,.14,True,6)
  for k in range(8):box('空調頂部細格柵',(x-length*.37+k*length*.105,0,z+.12 if low else z+.165),(.035,W*.48,.009),'chassis',.002)
  for off in [-length*.41,length*.41]:box('罩體邊框',(x+off,0,z+.11),( .035,W*.60,.05),'metal',.008)

def pantograph(x,H,diamond=False):
 use('05')
 for y in [-.43,.43]:
  for dx in [-.32,.32]:cyl('受電弓瓷瓶',(x+dx,y,H+.14),.074,.26,'cream',n=16)
 box('受電弓底架',(x,0,H+.30),(.94,1.03,.09),'chassis',.025)
 if diamond:
  for s in [-1,1]:
   a=(x-.47,s*.26,H+.36);b=(x+.47,s*.26,H+.36);c=(x-.73,s*.26,H+.79);d=(x+.73,s*.26,H+.79);e=(x,s*.26,H+1.19)
   line('菱形升弓連桿',[a,c,e,d,b],.025,'chassis')
 else:
  for s in [-1,1]:line('單臂受電弓',[(x-.4,s*.15,H+.34),(x+.59,s*.15,H+.82),(x-.13,s*.15,H+1.19)],.028,'chassis')
 box('碳滑板',(x if diamond else x-.13,0,H+1.21),(.13,1.72,.064),'metal',.013)
 for s in [-1,1]:line('滑板彎角',[(x, s*.85,H+1.21),(x,s*1.01,H+1.12)],.023,'metal')

def lamp(name,xfun,y,z,r=.105,red=False):
 use('03');x=xfun(y,z)+.075
 cyl(name+' 鍍鉻圈',(x+.022,y,z),r+.025,.045,'metal','X',32)
 cyl(name+' 黑色內襯',(x+.049,y,z),r+.01,.023,'frame','X',28,.002)
 cyl(name+' 透鏡',(x+.066,y,z),r,.017,'red' if red else 'lamp','X',28,.003)
def wiper(f,y,z,extent=.64):
 use('03');a=(f(y,z)+.145,y,z);b=(f(y-.10,z+extent*.53)+.145,y-.10,z+extent*.53);c=(f(y-.12,z+extent)+.145,y-.12,z+extent)
 line('獨立雨刷臂',[a,b],.012,'chassis');line('雨刷膠條',[b,c],.014,'frame')

def hazard(x,W,z=.61,height=.54):
 use('03');box('端梁警戒底色',(x,0,z),(.055,W*.92,height),'yellow',.015)
 # 每一條斜紋在底板邊界裁切，不伸出車體。
 for i in range(-6,7):
  ys=[i*.38-.15,i*.38+.03,i*.38+.03+.38,i*.38-.15+.38]
  poly=[(ys[0],z+height/2),(ys[1],z+height/2),(ys[2],z-height/2),(ys[3],z-height/2)]
  for boundary,sgn in [(-W*.46,1),(W*.46,-1)]:
   result=[]
   for a,b in zip(poly,poly[1:]+poly[:1]):
    ain=(a[0]-boundary)*sgn>=0;bin=(b[0]-boundary)*sgn>=0
    if ain:result.append(a)
    if ain!=bin:
     t=(boundary-a[0])/(b[0]-a[0]);result.append((boundary,a[1]+t*(b[1]-a[1])))
   poly=result
   if not poly:break
  if len(poly)>2:mesh('黑色斜警戒紋',[(x+.035,y,zz) for y,zz in poly],[tuple(range(len(poly)))],'frame')

def export_model(s,out,reference):
 out=Path(out);out.mkdir(parents=True,exist_ok=True);(out/'renders').mkdir(exist_ok=True)
 SCENE['reference_page']=reference.get('source','');SCENE['family']=s['family'];SCENE['model_parts']=len(MODEL)
 SCENE.render.engine='CYCLES';SCENE.cycles.samples=int(os.environ.get('FLEET_SAMPLES','24'));SCENE.cycles.use_denoising=True
 SCENE.view_settings.view_transform='AgX';SCENE.render.image_settings.file_format='PNG';SCENE.render.film_transparent=False
 deps=bpy.context.evaluated_depsgraph_get();buckets={};bounds=[Vector((math.inf,)*3),Vector((-math.inf,)*3)]
 object_inventory=[]
 for obj in MODEL:
  if obj.type not in ['MESH','FONT','CURVE']:continue
  obj['asset_model_id']=s['id'];ev=obj.evaluated_get(deps);d=ev.to_mesh();d.calc_loop_triangles();wm=obj.matrix_world;nm=wm.to_3x3().inverted_safe().transposed()
  object_inventory.append({'name':obj.name,'type':obj.type,'polygons':len(d.polygons),'modifiers':[m.type for m in obj.modifiers]})
  for tri in d.loop_triangles:
   material=d.materials[tri.material_index] if d.materials else M['body'];key=material.name
   if key not in buckets:buckets[key]={'material':material,'values':[]}
   vals=buckets[key]['values']
   for li in tri.loops:
    pos=wm@d.vertices[d.loops[li].vertex_index].co;normal=(nm@d.corner_normals[li].vector).normalized()
    if not all(math.isfinite(v) for v in (*pos,*normal)):raise ValueError('非有限網格 '+obj.name)
    vals.extend((*pos,*normal))
    for j in range(3):bounds[0][j]=min(bounds[0][j],pos[j]);bounds[1][j]=max(bounds[1][j],pos[j])
  ev.to_mesh_clear()
 raw=bytearray();draw=[];count=0;exp=bpy.data.collections.new('80 合併匯出副本・不渲染');SCENE.collection.children.link(exp);exp.hide_render=True;exports=[]
 for name,item in buckets.items():
  vals=item['values'];n=len(vals)//6
  if not n:continue
  material=item['material'];node=material.node_tree.nodes['Principled BSDF'];raw.extend(struct.pack('<%sf'%len(vals),*vals))
  draw.append({'name':name,'start':count,'count':n,'color':list(node.inputs['Base Color'].default_value)[:3],'metalness':node.inputs['Metallic'].default_value,'roughness':node.inputs['Roughness'].default_value,'clearcoat':node.inputs['Coat Weight'].default_value});count+=n
  d=bpy.data.meshes.new('EXPORT '+name);d.from_pydata([vals[i:i+3] for i in range(0,len(vals),6)],[],[(i,i+1,i+2) for i in range(0,n,3)]);d.materials.append(material);d.update()
  for poly in d.polygons:poly.use_smooth=True
  d.normals_split_custom_set_from_vertices([vals[i+3:i+6] for i in range(0,len(vals),6)])
  ob=bpy.data.objects.new('EXPORT '+name,d);exp.objects.link(ob);exports.append(ob)
 id=s['id'];(out/f'{id}.mesh.bin').write_bytes(raw)
 meta={'modelId':id,'name':reference['name'],'version':1,'application':bpy.app.version_string,'family':s['family'],'axes':{'front':'+X','left':'+Y','up':'+Z','groundAnchor':[0,0,0],'units':'meters'},'gltfAxes':{'front':'+X','left':'-Z','up':'+Y','toENU':'rotateX(+PI/2)'},'style':'Q-proportions-photo-informed','sourcePhotosIncluded':False,'operatorLogoIncluded':False,'numberIsLiveIdentity':False,'identityMaterial':'可移除車型示意牌','engineeringDimensionsM':None,'bounds':{'min':list(bounds[0]),'max':list(bounds[1])},'sizeM':list(bounds[1]-bounds[0]),'mesh':{'file':f'{id}.mesh.bin','sha256':hashlib.sha256(raw).hexdigest(),'encoding':'float32-le','strideBytes':24,'vertexCount':count,'triangleCount':count//3,'drawGroups':draw},'nativeObjectCount':len(MODEL),'features':{'sideDoorGroups':s.get('doors',0),'doorLeavesPerGroup':s.get('doorLeaves',2),'pantographsOnThisAsset':s.get('pantos',0),'axlesPerBogie':s.get('axles',2),'articulatedSections':s.get('sections',1),'steamDriversPerSide':s.get('drivers',0)},'specification':s,'reference':{'source':reference.get('source'),'detail':reference.get('detail'),'photoUse':'visual-study-only-not-redistributed'},'formation':{'default':'single-vehicle' if s['family']!='tram' else 'five-section-tram','illustrative':True,'liveAssignment':False,'shortFormation':None}}
 meta['identityMaterial']='可移除車型示意牌' if any(g['name']=='可移除車型示意牌' for g in draw) else None
 (out/f'{id}.model.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n');(out/'objects.json').write_text(json.dumps(object_inventory,ensure_ascii=False,indent=2)+'\n')
 bpy.ops.object.select_all(action='DESELECT')
 for ob in exports:ob.select_set(True)
 bpy.context.view_layer.objects.active=exports[0]
 bpy.ops.export_scene.gltf(filepath=str(out/f'{id}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_normals=True,export_texcoords=False,export_materials='EXPORT',export_extras=True)
 exp.hide_viewport=True
 use('90');floor=box('展示台',(0,0,-.060),(200,200,.10),mat('攝影棚紙白','F0EBDF',0,.8),.02,model=False)
 def area(name,loc,energy,size):
  data=bpy.data.lights.new(name,'AREA');o=bpy.data.objects.new(name,data);ACTIVE.objects.link(o);o.location=loc;data.energy=energy;data.shape='DISK';data.size=size;o.rotation_euler=(Vector((0,0,1.4))-o.location).to_track_quat('-Z','Y').to_euler()
 area('主柔光',(4,-6,10),1600,7);area('車頭補光',(8,4,6),1000,5);area('頂部輪廓光',(-5,2,8),1800,6)
 camdata=bpy.data.cameras.new('工坊正交相機');camera=bpy.data.objects.new('工坊相機',camdata);ACTIVE.objects.link(camera);SCENE.camera=camera;camdata.type='ORTHO'
 mid=(bounds[0]+bounds[1])/2;size=bounds[1]-bounds[0]
 def view(loc,target,scale,res=(1200,800)):
  camera.location=Vector(loc)+mid;camera.rotation_euler=(Vector(target)+mid-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=scale
  SCENE.render.resolution_x,SCENE.render.resolution_y=res;SCENE.render.resolution_percentage=100
 heroScale=max(size.x*.96,size.z*2.4,8.5);view((11,-16,10),(0,0,0),heroScale)
 for screen in bpy.data.screens:
  for a in screen.areas:
   if a.type=='VIEW_3D':a.spaces.active.region_3d.view_distance=heroScale;a.spaces.active.region_3d.view_location=mid;a.spaces.active.region_3d.view_rotation=camera.rotation_euler.to_quaternion()
 bpy.ops.object.select_all(action='DESELECT');MODEL[0].select_set(True);bpy.context.view_layer.objects.active=MODEL[0]
 bpy.ops.wm.save_as_mainfile(filepath=str(out/f'{id}.blend'))
 def render(file):SCENE.render.filepath=str(out/'renders'/file);bpy.ops.render.render(write_still=True)
 if os.environ.get('FLEET_RENDER','1')=='1':
  render('hero.png')
  view((22,0,0),(0,0,0),max(size.y,size.z)*1.18,(800,800));floor.hide_render=True;render('front.png');floor.hide_render=False
  view((0,-24,.65),(0,0,0),size.x*1.10,(1400,650));render('side.png')
 print('FLEET_MODEL_OK '+json.dumps({'id':id,'objects':len(MODEL),'triangles':count//3,'sha256':meta['mesh']['sha256']},ensure_ascii=False),flush=True)
 return meta
