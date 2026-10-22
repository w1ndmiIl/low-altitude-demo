'use strict';
const fs=require('node:fs'),path=require('node:path');
const {benchmark,runExperiment}=require('../demo/simulation.js');
const output=path.join(__dirname,'..','results');fs.mkdirSync(output,{recursive:true});
const environment=process.argv.includes('--teaching')?'teaching':'qianjiang';
const seeds=Array.from({length:10},(_,i)=>42+i),matrix=benchmark({seeds,environment});
const ablations=[];
for(const seed of seeds)for(const [variant,groundWeight,linkWeight] of [['距离基线',0,0],['仅人口风险',3,0],['仅通信风险',0,2],['完整风险代价',3,2]])ablations.push({...runExperiment({scenario:'static',algorithm:'risk',groundWeight,linkWeight,seed,environment}).result,seed,variant,groundWeight,linkWeight});
const sweep=[0,0.5,1,2,3,5,8].map(groundWeight=>({...runExperiment({groundWeight,linkWeight:2,environment}).result,groundWeight,linkWeight:2}));
function csv(name,rows){const keys=Object.keys(rows[0]),escape=v=>'"'+String(v??'').replaceAll('"','""')+'"';fs.writeFileSync(path.join(output,name),'\uFEFF'+[keys.map(escape).join(','),...rows.map(r=>keys.map(k=>escape(r[k])).join(','))].join('\r\n'),'utf8');}
csv('seven-scenarios-10-seeds.csv',matrix);csv('ablation.csv',ablations);csv('weight-sweep.csv',sweep);
const metricKeys=['distance_m','time_s','ground_exposure_s','link_exposure_s','min_clearance_m','replans','collisions'];
function aggregate(group){const stats={runs:group.length,delivery_rate:group.filter(r=>r.state==='DELIVERED').length/group.length,return_rate:group.filter(r=>r.state==='RETURNED').length/group.length};for(const key of metricKeys){const values=group.map(r=>r[key]).filter(Number.isFinite),mean=values.reduce((a,b)=>a+b,0)/(values.length||1),sd=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/(values.length||1));stats[key]={mean:+mean.toFixed(4),sd:+sd.toFixed(4)};}return stats;}
const groups=[];for(const scenario of ['static','dynamic','link','battery','blocked','traffic','emergency'])for(const algorithm of ['distance','risk'])groups.push({scenario,algorithm,...aggregate(matrix.filter(r=>r.scenario===scenario&&r.algorithm===algorithm))});
const ablationGroups=['距离基线','仅人口风险','仅通信风险','完整风险代价'].map(variant=>({variant,...aggregate(ablations.filter(r=>r.variant===variant))}));
const bundle={environment,method:`固定${environment==='qianjiang'?'钱江世纪城公开地图':'合成教学地图'}，7 个场景 × 2 个算法 × 10 个链路种子。消融 4 组 × 10 种子，权重扫描 7 组。种子只改变链路丢包，未改变建筑道路地图或交通初始需求。`,runCount:matrix.length+ablations.length+sweep.length,seeds,matrix,groups,ablations,ablationGroups,sweep};
fs.writeFileSync(path.join(output,'experiments.json'),JSON.stringify(bundle,null,2));
fs.writeFileSync(path.join(output,'example-flight.json'),JSON.stringify(runExperiment({scenario:'emergency',algorithm:'risk',environment}).sim.export(),null,2));
const fmt=(r,k)=>`${r[k].mean.toFixed(2)} ± ${r[k].sd.toFixed(2)}`;
const report=['# 实测结果（钱江世纪城课程仿真）','',`运行数量：${bundle.runCount}。${bundle.method}`,'','下表为均值 ± 总体标准差。风险暴露是 ∫风险值 dt，单位 s，不代表真实事故概率。','', '| 场景 | 算法 | 配送率 | 返航率 | 航程 m | 时间 s | 人口暴露 s | 通信暴露 s | 重规划次数 | 碰撞数 |','|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',...groups.map(r=>`| ${r.scenario} | ${r.algorithm} | ${(r.delivery_rate*100).toFixed(0)}% | ${(r.return_rate*100).toFixed(0)}% | ${fmt(r,'distance_m')} | ${fmt(r,'time_s')} | ${fmt(r,'ground_exposure_s')} | ${fmt(r,'link_exposure_s')} | ${fmt(r,'replans')} | ${fmt(r,'collisions')} |`),'','## 消融实验','', '| 代价项 | 航程 m | 人口暴露 s | 通信暴露 s |','|---|---:|---:|---:|',...ablationGroups.map(r=>`| ${r.variant} | ${fmt(r,'distance_m')} | ${fmt(r,'ground_exposure_s')} | ${fmt(r,'link_exposure_s')} |`),'','## 结论边界','','- 返航完成说明异常处置成功，不能计为配送成功。无路场景拒绝起飞，不能计为配送成功。','- 当前街区来源于 OSM，道路建筑为公开数据，风险场、交通需求和缺失的高度来自仿真设定。','- 统计验证的是固定地图上对心跳随机种子的稳定性，没有证明对不同真实城市、天气或传感误差的泛化。','- 风险权重和风险图来自人为设定。在另一张地图或权重下，改进幅度可能不同。','- 连续线段检查与有限预测降低了本组场景的冲突，无法保证任意动态障碍下绝对安全。','- 电量是线性教学模型，未使用真实电池放电数据。','', '复现命令：`node tools/run-experiments.js`。'];
fs.writeFileSync(path.join(output,'实验结果说明.md'),report.join('\n'),'utf8');
console.log(`已完成 ${bundle.runCount} 次实验，输出到 ${output}`);console.log(JSON.stringify(groups.filter(r=>r.scenario==='static'),null,2));
