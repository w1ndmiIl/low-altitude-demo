'use strict';
// 只改变抢占权限，复用已落盘的 FIFO 与完整优先组，避免重复运行相同试验。
const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
const {runOperations}=require('../demo/operations.js');
const out=path.resolve(__dirname,'../results'),reference=JSON.parse(fs.readFileSync(path.join(out,'operations-experiments.json'),'utf8'));
const rows=[],incidents=[],runs=[];
for(const seed of [42,43,44]){
  const start=performance.now(),{result,ops}=runOperations({policy:'priority',preemptionEnabled:false,seed,duration:650}),elapsed=performance.now()-start;
  rows.push({...result,variant:'priority_no_preemption',preemption_enabled:false,...ops.schedulerStats,node_wall_ms:+elapsed.toFixed(2)});
  incidents.push(...ops.incidents.map(i=>({variant:'priority_no_preemption',seed,type:i.type,status:i.status,dispatch_wait_s:i.assignedAt===null?null:+(i.assignedAt-i.createdAt).toFixed(2),air_response_s:i.airArrivedAt===null?null:+(i.airArrivedAt-i.createdAt).toFixed(2),resolved_s:i.resolvedAt===null?null:+(i.resolvedAt-i.createdAt).toFixed(2)})));
  runs.push(ops.export());console.log(`仅优先级 seed=${seed}: 应急${result.emergency_completed}/4，等待${result.mean_dispatch_delay_s}s，搜索${ops.schedulerStats.pathSearches}次`);
}
const baselineRows=reference.rows.map(r=>({...r,variant:r.policy==='fifo'?'fifo':'priority_preemption',preemption_enabled:r.policy==='priority'}));
const baselineIncidents=reference.incidents.map(r=>({...r,variant:r.policy==='fifo'?'fifo':'priority_preemption'}));
const bundle={additionalRunCount:rows.length,totalSchedulingRuns:reference.runCount+rows.length,duration_s:650,seeds:[42,43,44],method:'同一地图、需求、8机、心跳种子和650s窗口。复用FIFO与优先+抢占组；新增优先但禁止抢占，单独考察抢占贡献。node_wall_ms为本机无图形整次运营耗时，包括地图初始化、交通与所有飞行器执行，并非一次调度耗时。诊断计数仅计dispatch内A*，不含飞行器重规划。',rows:[...baselineRows,...rows],incidents:[...baselineIncidents,...incidents],additionalRuns:runs};
fs.writeFileSync(path.join(out,'scheduler-ablation.json'),JSON.stringify(bundle,null,2));
function csv(file,data){const keys=[...new Set(data.flatMap(r=>Object.keys(r)))],escape=v=>'"'+String(v??'').replaceAll('"','""')+'"';fs.writeFileSync(path.join(out,file),'\uFEFF'+[keys.map(escape).join(','),...data.map(r=>keys.map(k=>escape(r[k])).join(','))].join('\r\n'));}
csv('scheduler-ablation.csv',bundle.rows);csv('scheduler-ablation-incidents.csv',bundle.incidents);
console.log('新增3次调度消融，原始日志与诊断计数已保存。');
