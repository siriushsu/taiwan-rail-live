"""離線股道與放行時間約束；標準輸出只用 JSON lines 與驗收器交換資料。"""
import json,sys
from ortools.sat.python import cp_model
source=json.load(open(sys.argv[1]));model=cp_model.CpModel();paths=[];holds=[];indicators={};constraints=set();last_answer=source.get('hints',{});assumptions={};assumption_ids={};freezes={};freeze_ids={}
for ti,tr in enumerate(source['trains']):
 pv=[];hv=[]
 for i,pair in enumerate(tr['pairs']):
  ids=source['pairs'][pair]
  v=model.new_int_var_from_domain(cp_model.Domain.from_values(ids),f'p{ti}_{i}');pv.append(v)
  if i:
   key=tr['pairs'][i-1]+'~'+pair
   model.add_allowed_assignments([pv[i-1],v],source['transitions'][key])
  hint=source.get('hints',{}).get(tr['id'],{}).get('pathIds',[])
  if i<len(hint) and hint[i] in ids:model.add_hint(v,hint[i])
 for i,st in enumerate(tr['stops']):
  h=model.new_int_var(0,source.get('maxWaitSec',600)*10,f'h{ti}_{i}');hv.append(h)
  if i:
   dwell=st['depSec']-st['arrSec']
   if dwell<.5:model.add(h==hv[i-1])
   else:model.add(h>=hv[i-1]-max(0,round((dwell-min(30,dwell))*10)))
  model.add_hint(h,0)
 paths.append(pv);holds.append(hv)
for link in source.get('handoffs',[]):
 a=link['a'];b=link['b'];model.add_allowed_assignments([paths[a][-1],paths[b][0]],link['allowed']);model.add(holds[a][-1]==holds[b][0]);model.add(holds[a][-2]==holds[b][0])
if source.get('focus'):
 for ti,tr in enumerate(source['trains']):
  hint=source.get('hints',{}).get(tr['id'],{}).get('pathIds',[])
  if len(hint)!=len(paths[ti]):continue
  flag=model.new_bool_var(f'freeze{ti}');freezes[ti]=flag;freeze_ids[flag.index]=ti
  for i,p in enumerate(hint):model.add(paths[ti][i]==p).only_enforce_if(flag)
model.minimize(sum(h for row in holds for h in row)*10**10+sum(v for row in paths for v in row))
def indicator(t,i,p):
 key=(t,i,p)
 if key not in indicators:
  b=model.new_bool_var(f'is{t}_{i}_{p}');model.add(paths[t][i]==p).only_enforce_if(b);model.add(paths[t][i]!=p).only_enforce_if(b.Not());indicators[key]=b
 return indicators[key]
def respond(value):
 print(json.dumps(value,separators=(',',':')),flush=True)
respond({'ready':True,'segments':sum(map(len,paths))})
for line in sys.stdin:
 request=json.loads(line)
 if request.get('stop'):break
 added=0
 for conflict in request.get('conflicts',[]):
  key=None if request.get('alreadyUnique') else hash(json.dumps(conflict,sort_keys=True,separators=(',',':')))
  if key is not None and key in constraints:continue
  if key is not None:constraints.add(key)
  added+=1;a=conflict['a'];b=conflict['b'];conditions=[]
  for r in [a,b]:
   for i,p in r['variables']:conditions.append(indicator(r['trainIndex'],i,p))
  def time(r,field):
   ref=r[field];return ref['base']+holds[r['trainIndex']][ref['stop']]
  pair=tuple(sorted([a['trainIndex'],b['trainIndex']]))
  if pair not in assumptions:
   flag=model.new_bool_var(f'pair{pair}');assumptions[pair]=flag;assumption_ids[flag.index]=pair;model.add_assumption(flag)
  if source.get('fixedOrder') or conflict.get('ordered'):
   if a['endRef']['base']<=b['endRef']['base']:
    model.add(time(a,'endRef')<=time(b,'startRef')).only_enforce_if(conditions+[assumptions[pair]])
   else:
    model.add(time(b,'endRef')<=time(a,'startRef')).only_enforce_if(conditions+[assumptions[pair]])
  else:
   first=model.new_bool_var(f'order{len(constraints)}a');second=model.new_bool_var(f'order{len(constraints)}b')
   model.add(time(a,'endRef')<=time(b,'startRef')).only_enforce_if(first)
   model.add(time(b,'endRef')<=time(a,'startRef')).only_enforce_if(second)
   model.add_bool_or([c.Not() for c in conditions]+[first,second,assumptions[pair].Not()])
 if request.get('addOnly'):
  respond({'added':added});continue
 # 每輪優先保留上一輪股道，避免無關路段在等成本解之間反覆換線。
 changes=[]
 if last_answer:
  for ti,tr in enumerate(source['trains']):
   for i,p in enumerate(last_answer.get(tr['id'],{}).get('pathIds',[])):
    if i<len(paths[ti]) and p in source['pairs'][tr['pairs'][i]]:changes.append(1-indicator(ti,i,p))
 model.minimize(sum(h for row in holds for h in row)*10**6+sum(changes))
 model.clear_assumptions()
 model.add_assumptions(list(assumptions.values()))
 active=set(request.get('focused',[]))
 model.add_assumptions([flag for ti,flag in freezes.items() if ti not in active])
 solver=cp_model.CpSolver();solver.parameters.max_time_in_seconds=request.get('seconds',20);solver.parameters.num_search_workers=4
 status=solver.solve(model);name=solver.status_name(status)
 if status==cp_model.INFEASIBLE:
  model.clear_objective();solver.parameters.num_search_workers=1;solver.parameters.core_minimization_level=2;solver.solve(model)
 if status not in [cp_model.OPTIMAL,cp_model.FEASIBLE]:respond({'status':name,'constraints':len(constraints),'added':added,'core':[[source['trains'][i]['id'] for i in assumption_ids[x]] for x in solver.sufficient_assumptions_for_infeasibility() if x in assumption_ids] if status==cp_model.INFEASIBLE else [],'release':[freeze_ids[x] for x in solver.sufficient_assumptions_for_infeasibility() if x in freeze_ids] if status==cp_model.INFEASIBLE else []});continue
 answer={tr['id']:{'pathIds':[solver.value(v)for v in paths[ti]],'departureHolds':[solver.value(h)/10 for h in holds[ti]],'officialDelaySec':tr.get('delaySec',0)}for ti,tr in enumerate(source['trains'])}
 last_answer=answer
 model.clear_hints()
 for row in paths+holds:
  for v in row:model.add_hint(v,solver.value(v))
 respond({'status':name,'constraints':len(constraints),'added':added,'objective':sum(solver.value(h) for row in holds for h in row)/10,'plans':answer})
