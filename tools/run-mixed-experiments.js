'use strict';
const fs=require('node:fs'),path=require('node:path'),{MixedOperations}=require('../demo/mixed-operations.js');
const root=path.resolve(__dirname,'..'),runs=[];
for(const seed of [42,43,44])for(const policy of ['fifo','priority']){
  const o=new MixedOperations({seed,policy});o.start();o.step(650);
  const run={seed,...o.summary(),incidents:o.incidents.map(i=>({id:i.id,type:i.type,assigned_s:i.assignedAt==null?null:+(i.assignedAt-i.createdAt).toFixed(2),arrival_s:i.airArrivedAt==null?null:+(i.airArrivedAt-i.createdAt).toFixed(2),completed_s:i.resolvedAt==null?null:+(i.resolvedAt-i.createdAt).toFixed(2),status:i.status})),diagnostics:{...o.schedulerStats,...o.mixedStats},resources:o.resources.snapshot()};runs.push(run);console.log(JSON.stringify({seed,policy,emergency:run.emergency_completed,passenger:run.passenger_trips,people:run.people_transferred,handoff:run.cross_river_handoff_s,yield:run.yield_events}));
}
const result={schema:'lowair-mixed-experiments/v1',duration_s:650,fleet:{uav:16,helicopter:2,evtol:2},scenario:'固定OSM地图、初始客运2单、15s人员转运、30s火情、45s物资救援、60s跨江医疗、90s中继，每100s增加日常需求',comparison:'FIFO同时使用任务创建顺序申请资源；priority使用应急优先和允许的日常抢占。该比较改变多项策略，不用于单独归因容量或让行收益。三个种子只改变心跳随机序列。',runs};
fs.writeFileSync(path.join(root,'results/mixed-experiments.json'),JSON.stringify(result,null,2));
const keys=['seed','policy','daily_completed','emergency_completed','passenger_trips','people_transferred','mean_dispatch_delay_s','resource_hold_s','yield_events','yield_s','cross_river_handoff_s','safety_failures'];fs.writeFileSync(path.join(root,'results/mixed-experiments.csv'),'\uFEFF'+keys.join(',')+'\n'+runs.map(r=>keys.map(k=>r[k]??'').join(',')).join('\n')+'\n');
