from pathlib import Path
P=Path(__file__).resolve().parent
exec(compile((P/'export_core.py').read_text(),str(P/'export_core.py'),'exec'))
exec(compile((P/'calibration.py').read_text(),str(P/'calibration.py'),'exec'))
exec(compile((P/'completion.py').read_text(),str(P/'completion.py'),'exec'))
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [];ids=set(args)
specs=json.loads((P/'catalog-source.json').read_text())
for s in sorted(specs,key=lambda v:v['priority']):
 if ids and s['id'] not in ids:continue
 reset(s);BUILDERS[s['kind']](s)
 if s['id'] in ['presidential-office','red-house','erjie-granary'] and s.get('footprintReference'):
  pts=[o.matrix_world@v.co for o in OB for v in o.data.vertices];xsize=max(v.x for v in pts)-min(v.x for v in pts);ysize=max(v.y for v in pts)-min(v.y for v in pts);ref=s['footprintReference'];xx,yy=(ref['shortSideM'],ref['longSideM']) if s['id']=='red-house' else (ref['longSideM'],ref['shortSideM']);scale=Matrix.Diagonal(Vector((xx/xsize,yy/ysize,1,1)))
  for o in OB:o.matrix_world=scale@o.matrix_world
  s['planCalibration']='OSM 輪廓包圍框校正平面尺度；內部翼樓與局部輪廓仍為估計'
 complete_exterior(s)
 apply_calibration(s)
 points=[o.matrix_world@v.co for o in OB for v in o.data.vertices]
 s['estimatedDimensionsM']={'width':max(v.x for v in points)-min(v.x for v in points),'depth':max(v.y for v in points)-min(v.y for v in points),'height':max(v.z for v in points)-min(v.z for v in points),'basis':'平面依各部件來源校正；高度仍為外觀建模估值'}
 s['referenceReviewDate']='2026-09-12' if s.get('completionReview') else ('2026-09-08' if s.get('reviewedPhotos') else None)
 if s['id']=='presidential-office':s['verifiedDimensionsM']={'centralTowerHeightApprox':60,'source':'https://www.president.gov.tw/Page/91'}
 export(s)
