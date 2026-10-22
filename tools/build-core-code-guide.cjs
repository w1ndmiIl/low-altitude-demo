'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),sections=[];
const squash=s=>s.replace(/\s/g,'');
function section(title,file,anchor,code,explain,tests){const src=fs.readFileSync(path.join(root,file),'utf8'),index=src.indexOf(anchor);assert.ok(index>=0,file+': '+anchor);assert.ok(squash(src).includes(squash(code)),title+' 摘录必须来自当前源码');const line=src.slice(0,index).split('\n').length;sections.push(`## ${title}\n\n源码：[${file}:${line}](../${file}#L${line})。以下为原代码摘录，仅调整空白与换行。\n\n\`\`\`javascript\n${code.trim()}\n\`\`\`\n\n${explain}\n\n验证入口：${tests.map(f=>'['+f+'](../'+f+')').join('、')}。\n`);}
section('1. 调度策略：谁先被处理','demo/mixed-operations.js','this.queue.sort((a,b)=>',`this.queue.sort((a,b)=>
  this.policy==='priority'
    ? b.priority-a.priority || a.createdAt-b.createdAt
    : a.createdAt-b.createdAt
);`,`输入是待派任务队列，输出是本轮处理顺序。优先级策略先比较 priority，同级按创建时间；FIFO只比较创建时间。之后逐任务筛选并派单，派出一项就更新机队，属于贪心指派，不能称为多机全局最优。

三策略配置：FIFO为 policy='fifo'；优先不抢占为 policy='priority'、preemptionEnabled=false；优先允许抢占为 policy='priority'、preemptionEnabled=true。基础无人机 Operations 也使用同样的排序规则。`,['tests/operations.test.js','tests/mixed.test.js']);
section('2. 异构机队：任务能力先于代价','demo/mixed-operations.js','if(task.requiredType?',`if(task.requiredType ? task.requiredType!==a.aircraftType : !a.skills?.includes(task.type)) {
  this.mixedStats.typeRejected++;
  record.reason='任务能力不符';
  continue;
}
if(task.people>p.seats || task.payloadKg>p.payloadKg) {
  this.mixedStats.capacityRejected++;
  record.reason='座位 / 载荷不足';
  continue;
}`,`任务指定机型时检查 requiredType，否则检查技能集合；随后检查座位和载荷。完整 dispatch 还检查通信、补能/返航状态、起降设施、航路和能源。每个被拒绝候选保留首个拒绝原因。

课件第7页的0秒人员转运案例中，18架因能力不符退出，两架直升机参与代价比较。不能把这18架的退出解释成“距离太远”。`,['tests/mixed.test.js','tests/dispatch-view.test.js']);
section('3. 抢占资格：什么任务可以被打断','demo/mixed-operations.js','const preempt=a.status',`const preempt = a.status==='FLYING'
  && this.preemptionEnabled
  && this.policy==='priority'
  && task.emergency
  && a.task
  && !a.task.emergency
  && a.task.people===0
  && !a.payloadLocked
  && a.task.priority<task.priority;`,`允许抢占需要所有条件同时成立。原任务须为低优先级非应急任务，飞机在飞行阶段、没有人员任务且载荷未锁定；现场服务、起降等状态不在这个抢占入口中。任务抢占与资源优先排队是两件事：高优先级不会强制驱逐航路当前占用者。`,['tests/mixed.test.js','tests/operations.test.js','tests/audit.test.js']);
section('4. 派单代价：比较什么数值','demo/mixed-operations.js','const routeCost=r.cost',`const routeCost=r.cost*25/p.speed,
      penalty=preempt?10:0,
      cost=routeCost+wait+penalty;`,`20机异构模型先通过风险A*取得 r.cost，再乘25米网格尺度、除以机型速度，并加入场站占用惩罚 wait 和抢占惩罚。每个任务关联场站若被其他机占用，当前实现加12；抢占加10。这是用于候选排序的教学代价，包含风险权重与人为惩罚，不是预测到达时间。

注意8机固定无人机基准位于 operations.js，使用 r.cost × cellMeters +（在途抢占时120），没有同一套按机型速度归一化和场站惩罚。两套总代价数值不可直接比较。课件H01=11.8、H02=64.0来自异构模型的固定决策快照。`,['tests/mixed.test.js','tests/dispatch-view.test.js']);
section('5. 能源预算：为什么电量高也可能拒绝','demo/mixed-operations.js','const required=length*',`const required = length*(p.energyMeter+p.energySecond/p.speed)
  + (task.serviceSeconds+task.waypoints.length*(p.departure+3))*p.energySecond
  + p.reserve
  + (this.verticalBudget?.(a,task)||0);`,`length包含当前A*航段、后续航点间的近似距离和返场近似距离；后续与返场用欧氏距离乘1.25。预算再加入作业/起降时间能耗、机型储备及地面模式的垂直爬升能耗。battery低于required就拒绝派单。

这比单一电量阈值更完整，但后续路程依然是近似估计，不是对整个任务的最优三维路径证明，也不能用于推断真实续航。`,['tests/mixed.test.js','tests/ground.test.js']);
section('6. 被抢占任务如何恢复','demo/operations.js','if(actor.task){const old=actor.task;',`if(actor.task) {
  const old=actor.task;
  old.state='QUEUED'; old.actor=null; old.interruptions++;
  old.distance+=actor.sim?.distance||0;
  actor.totalDistance+=actor.sim?.distance||0;
  this.queue.push(old); this.preemptions++;
  this.log('WARN','应急任务抢占',
    \`\${actor.name} 暂停 \${old.title}，执行 \${task.title}。未完成的日常任务保留原阶段。\`);
}`,`原任务对象重新进入队列，已经执行到的stage和任务信息保留，航程先累计；新任务绑定到飞机当前位置继续规划。任务保留不意味着立刻恢复，何时恢复仍取决于后续调度与可用机队。`,['tests/operations.test.js','tests/dispatch-view.test.js']);
section('7. 风险A*：路线为什么绕行','demo/planner.js','const r1=risk(nx,ny)',`const r1=risk(nx,ny), length=Math.hypot(dx,dy);
const cost=length*(1
  + weights.ground*(r0.ground+r1.ground)/2
  + weights.link*(r0.link+r1.link)/2);
const candidate=g[k]+cost;
if(candidate+1e-9<g[nk]) {
  g[nk]=candidate; parent[nk]=k;
  heap.push({id:nk,g:candidate,f:candidate+octile({x:nx,y:ny},goal)});
}`,`输入为网格、起终点、占据判断和风险函数，输出为path、cost与expanded。边代价在几何步长上叠加两端平均人口/通信代理风险。权重为零可退化为几何距离A*；八邻域使用octile启发式，禁止从两障碍之间对角穿角，最小堆按f=g+h取节点。

启发式的依据是非负风险项使边代价不小于几何步长。此处讨论的是当前静态网格的搜索，不代表动态多机全过程全局最优。第11页风险秒是另一个执行统计量 Σ风险值×dt，不能与A*总代价混为同一单位。`,['tests/core.test.js','tests/adaptive.test.js']);
section('8. 资源排队：已经派单为何仍要等','demo/mixed-operations.js','grant(time){',`grant(time) {
  for(const r of this.items.values())
    for(const q of [...r.requests.values()].sort((a,b)=>
      b.priority-a.priority || a.time-b.time || a.actor.localeCompare(b.actor))) {
      if(r.holders.size>=r.capacity) break;
      r.holders.add(q.actor); r.requests.delete(q.actor);
      this.history.push({t:time,resource:r.id,actor:q.actor,action:'acquire',priority:q.priority});
    }
}`,`Resources中holders保存当前占用者，requests保存请求。grant只补充剩余容量，已占用时不会替换持有者。请求顺序为优先级、任务创建时间，再以航空器编号打破同值。release清除占用并写入历史，下一轮再放行。

第9页实际例子：36.3秒V01持有跨江资源、V02等待；135.1秒V01释放后V02获得资源，记录见 results/classroom-resource-queue.json。这两项客运同为优先级45，该例证明容量与放行时序，不单独证明应急优先的收益。`,['tests/mixed.test.js']);
section('9. 后台改线：避免旧请求覆盖新任务','demo/simulation.js','if(epoch!==this.planEpoch)return;if(message.cancelled',`if(epoch!==this.planEpoch) return;
if(message.cancelled || terminal.has(this.state) || intent!==this.intent()) {
  this.pendingPlanner=null;
  this.planningStats.stale++;
  return;
}`,`requestPlan为每次意图生成epoch，回包时先判断是否仍属于当前任务和状态。PlannerService通过Blob Worker执行A*；reconnect再用当前世界的segmentClear从当前位置接回路径，避免位置跳跃。旧路线仍安全时继续飞，没有安全前缀则等待。

不是所有地图版本变化都简单丢弃回包：成功路径会在当前世界重新检查能否安全接入；无路径结果如果来自过期几何或旧起点，会触发重试。仅风险优化且旧航路安全时，新代价还须低于旧代价的0.88才采用，减少无收益改线。`,['tests/adaptive.test.js']);
section('10. 安全状态：为什么会暂停或返航','demo/safety.js','function decision({battery,age,returning}',`function decision({battery,age,returning},config) {
  if(battery<=0) return 'LAND';
  if(returning) return 'RETURN';
  if(battery<=config.lowBattery || age>=config.returnSeconds) return 'RETURN';
  if(age>=config.holdSeconds) return 'HOLD';
  return 'MISSION';
}`,`判断优先级是能源耗尽、返航锁定、低电量或长失联、短失联、正常任务。导航异常在执行层另外检查。恢复通信不会自动把已触发返航改回配送。

LAND是模型动作名，不能据此宣称实现了真实紧急降落控制。地面/垂直执行还会处理泊位、补能和中止；耗尽等异常终态不会被计作业务成功。`,['tests/core.test.js','tests/audit.test.js','tests/ground.test.js']);
section('11. 起降执行：有资源才允许垂直移动','demo/ground-operations.js','if(site?.resourceId&&this.resources',`if(site?.resourceId && this.resources && !this.resources.owns(site.resourceId,a.id)) {
  a.holdReason='等待 '+site.name+' 放行';
  return;
}`,`GroundedMixedOperations把地面与楼顶执行加在MixedOperations之上。takeoff设置起飞准备，verticalStep逐步改变高度，抵达巡航层后才转FLYING。它同时核查物理泊位claim、资源owns及cylinderConflict三维扫掠冲突；不满足条件就保留等待原因。

资源容量与物理净空不同：前者限制谁获准使用，后者检查运动过程中是否安全。水平路径仍使用保守网格，不是完整三维航路搜索。消防任务按模型火场位置在屋顶上方25米执行侦察/投放。`,['tests/ground.test.js','tests/stage-model.test.js']);
section('12. 江北接驳：接货后实际送达才算完成','demo/ground-operations.js',"if(leg.stage==='HANDOFF'","if(leg.stage==='HANDOFF'&&this.time-incident.handoffStartedAt>=leg.handoffSeconds-1e-9){\n        this.world.traffic.continueTrip(car,car.deliveryItinerary);incident.handoffCompletedAt=this.time;leg.stage='DELIVERING';incident.status='GROUND_DELIVERY';\n        this.log('INFO','江北末端配送出发','同一辆接驳车从接货路口继续行驶至江北医疗需求点。');\n      }\n      if(leg.stage==='DELIVERING'&&car.arrived){\n        car.parked=true;leg.stage='DELIVERED';incident.groundDeliveredAt=car.arrivedAt;incident.resolvedAt=this.time;incident.status='RESOLVED';\n        this.log('INFO','跨江运输与江北配送完成','空运物资已交给江北接驳车，并实际送达江北需求点；不是空中和车辆各自跨江后会合。');\n      }","当前实时场景采用江南空运、江北接货与末端配送。groundArrivedAt仅代表接驳区到场；空中服务完成且车辆到场后交接8秒，再由同一辆车从原路口继续行驶。只有车辆实际送达江北需求点后，groundDeliveredAt和resolvedAt才写入，不能把到站接货当作整项任务完成。车辆的两个航段都限制在江北实际路网，不经过跨江隧道或桥梁。原operations.js的updateCrossRiverIncident仍保留固定实验的旧双支路模型，旧统计不套用到新场景。",['tests/last-mile.test.js','tests/ground.test.js','tests/stage-model.test.js']);

section('13. 持续运营：上一轮结束后再续发','demo/mixed-operations.js','const cooldown=cycle.template.type',`const cooldown=cycle.template.type==='passenger'?90:['patrol','inspection'].includes(cycle.template.type)?40:30;
if(this.time-(cycle.last.completedAt??cycle.last.endedAt??this.time)<cooldown)continue;`,`enableContinuousOperations按初始日常任务建立循环，保存真实路线、设施和能力约束。replenishRoutine每5仿真秒检查，只有上一轮COMPLETED/FAILED/ABORTED且冷却结束才生成新任务。每个循环最多一项未完成任务；保留返场、补能和应急预留，不为热闹强行驱动全部飞机。

该模式仅在实时地面混合模式中默认开启；固定8机/20机实验与逐步定格模式保持原需求。连续讲解中下一步只改变讲解重点，决策快照固定而模型继续运行。`,['tests/continuous.test.js','tests/classroom-demo.test.js']);
section('14. 全机型局部让行：优先级与安全条件分开','demo/priority-traffic.js','function order(a,b,policy)',`function order(a,b,policy){return Number(!!b.sim.returning)-Number(!!a.sim.returning)
  ||(policy==='priority'?(b.task?.priority||0)-(a.task?.priority||0):0)
  ||(a.task?.createdAt||0)-(b.task?.createdAt||0)
  ||a.id.localeCompare(b.id);}`,`返航安全优先；优先策略按任务priority，再按创建时间和编号形成稳定次序。plan检查5秒未来航段和高度间隔，只对相互影响的航空器施加局部等待，不再只识别应急直升机。

资源、导航或通信已阻塞的飞机不再预占未来航段；只有较低顺位飞机停在当前位置不会挡住较高顺位航迹，才采用该让行。无冲突或高度已分离时继续正常运行。这是局部让行规则，没有把A*改成完整多机三维时空预约，也不保证全局最优或消除所有死锁。`,['tests/continuous.test.js']);
const intro=`# 核心代码导读：调度、规划与安全执行

更新：2026-10-13。用于课堂汇报和答辩读码，片段由 tools/build-core-code-guide.cjs 与当前源码核对后生成。行号对应当前版本，函数名是后续维护的稳定定位方式。

## 先看整体调用关系

界面事件进入 app.js，任务进入 GroundedMixedOperations。该类由 ground-operations.js 给 MixedOperations 增加地面/楼顶执行，MixedOperations又继承Operations。派单调用planner.js的A*；实时飞行改线可走adaptive-planning.js的Worker；仿真每步由safety.js和地面执行守卫检查安全。界面读取决策记录、任务和事件，避免另写一套派单结果。

| 汇报主题 | 主要文件/入口 | 推荐阅读 |
|---|---|---|
| 三种调度策略、候选与抢占 | mixed-operations.js dispatch；operations.js dispatch/assign | 本文1–6，第5–7页 |
| 风险A* | planner.js astar/octile/MinHeap | 本文7，第10–11页 |
| 场站和航路资源 | mixed-operations.js Resources/intents/tick | 本文8，第8–9页 |
| Worker与连续接入 | adaptive-planning.js PlannerService/reconnect；simulation.js requestPlan/adaptiveReview | 本文9，第10页 |
| 安全状态与地面起降 | safety.js decision；ground-operations.js verticalStep/tick | 本文10–11，第12页 |
| 空地交接与完成语义 | operations.js completeTask/tick；ground-operations.js completeTask/finishReturn | 本文12，第13/15页 |
| 可解释界面与标准流程 | dispatch-view.js Explainer；classroom-demo.js Controller；app.js hooks | 文末辅助入口 |
| 持续日常运营、全机型局部让行 | mixed-operations.js replenishRoutine；priority-traffic.js plan | 本文13–14 |

**先区分两套条件。** 课件三策略统计来自8机固定巡航、650秒、3个心跳种子的实验；现场是20机异构地面与楼顶模式。基础排序规则相同，但代价公式、资源和执行模型不同，不能拿现场用时替换固定基准数据。

基本变量：task是任务，actor/a是航空器，queue是待派队列，stage是任务航点阶段；25为当前网格米尺度。priority>=80被定义为应急，属于课程设定。
`;
const ending=`
## 辅助入口与最短演示顺序

- [demo/app.js](../demo/app.js)：模式初始化、按钮事件、课堂流程hooks和requestAnimationFrame主循环。主循环推进模型后刷新界面；倍率是目标加速，繁忙时实际倍率会下降。
- [demo/dispatch-view.js](../demo/dispatch-view.js)：Explainer按任务入队、候选筛选、代价比较和派单结果展示模型记录。
- [demo/classroom-demo.js](../demo/classroom-demo.js)：Controller.start/next/tick/watchAgain。默认连续讲解，背景运营持续；主动暂停才冻结。逐步定格保留旧教学方式，超过上限不伪造成功。
- [demo/operations.js](../demo/operations.js)：decisionContext/candidateSnapshot/recordDecision保存检查时的值。后续飞行不能改写历史候选位置、电量和代价。
- [tools/run-scheduler-ablation.js](../tools/run-scheduler-ablation.js)：固定种子和窗口，关闭抢占获得对照，再与FIFO和完整优先组比较。
- [results/scheduler-ablation.json](../results/scheduler-ablation.json)：派单等待196.61/74.49/0秒，应急完成3/3/4。0秒不含飞行与服务，未完成不算零响应。
- [results/experiments.json](../results/experiments.json)：距离/风险A*、消融与权重实验；地图固定，种子主要改变链路丢包。

课堂只展示三个代码片段时，推荐第1节队列排序、第7节风险边代价、第12节空地完成条件，分别回答“先处理谁、怎么走、什么时候算完成”。第4/8/10节作为追问备用。

## 按模块复现

运行环境已有Node时，从项目根目录运行（正常演示不需要Node）：

\`\`\`powershell
node --test tests/operations.test.js tests/mixed.test.js tests/dispatch-view.test.js
node --test tests/core.test.js tests/adaptive.test.js
node --test tests/ground.test.js tests/audit.test.js tests/stage-model.test.js
node tools/presentation/prepare-final-evidence.cjs
\`\`\`

前三条分别检查调度、规划、执行与安全；最后一条重建第9页真实排队证据，不改变业务源码。重新生成本文运行 node tools/build-core-code-guide.cjs；脚本会核对摘录是否仍来自当前代码。

个人报告中的姓名、实际改动和复现经历仍由本人填写；上面的源码与公共测试不能自动视作某位成员的个人贡献。
`;
fs.mkdirSync(path.join(root,'docs'),{recursive:true});fs.writeFileSync(path.join(root,'docs/核心代码导读.md'),intro+'\n'+sections.join('\n')+ending);console.log(JSON.stringify({sections:sections.length,verifiedExcerpts:true,output:'docs/核心代码导读.md'}));
