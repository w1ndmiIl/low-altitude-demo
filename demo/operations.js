(function(root,factory){
  const api=typeof module==='object'&&module.exports?factory(require('./simulation.js'),require('./world.js'),require('./planner.js'),require('./safety.js'),require('./geo.js')):factory(root.LowAirSimulation,root.LowAirWorld,root.LowAirPlanner,root.LowAirSafety,root.LowAirGeo);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.LowAirOperations=api;
})(globalThis,function(S,W,P,Safety,G){
  'use strict';
  const kinds={parcel:'快递配送',food:'外卖配送',patrol:'城市巡逻',inspection:'设施巡检',routine_medical:'常规送样',supply:'补给配送',rescue:'救援物资投送',medical:'跨江医疗急送',fire:'消防巡查与模拟灭火',relay:'应急通信中继'};
  const statusNames={IDLE:'待命',FLYING:'执行任务',SERVICING:'现场作业',CHARGING:'模拟补能',DISABLED:'安全停止'};
  const specs=[
    {id:'U01',name:'快递01',color:'#149e88',home:[-987.5,962.5],skills:['parcel','supply']},
    {id:'U02',name:'外卖02',color:'#d7a42d',home:[-520,610],skills:['food','parcel']},
    {id:'U03',name:'巡逻03',color:'#567fc2',home:[-100,-90],skills:['patrol','inspection','fire']},
    {id:'U04',name:'医疗04',color:'#df657f',home:[-900,870],skills:['routine_medical','medical','rescue']},
    {id:'U05',name:'救援05',color:'#8e64b5',home:[-2930,-1150],skills:['rescue','medical','supply']},
    {id:'U06',name:'消防06',color:'#dc6d36',home:[-390,-80],skills:['fire','inspection']},
    {id:'U07',name:'保障07',color:'#3c9dad',home:[-670,360],skills:['supply','relay','rescue']},
    {id:'U08',name:'备勤08',color:'#7887a1',home:[-3120,-1340],skills:['patrol','inspection','parcel','rescue']}
  ];
  const xy=point=>{const p=G.toGrid(point);return {x:Math.round(p.x),y:Math.round(p.y)};};
  class Operations {
    constructor({policy='priority',seed=42,groundWeight=3,linkWeight=2,autoEvents=true,preemptionEnabled=true,fleetSize=8}={}){
      if(![8,16].includes(fleetSize))throw new Error('Fleet size must be 8 or 16');this.fleetSize=fleetSize;
      this.policy=policy;this.seed=seed;this.weights={ground:groundWeight,link:linkWeight};this.autoEvents=autoEvents;this.preemptionEnabled=preemptionEnabled;
      this.schedulerStats={dispatchCalls:0,pathSearches:0,expandedNodes:0,unreachableRejected:0,energyRejected:0,assignments:0,maxQueue:0};
      this.world=new W.World('traffic','qianjiang');this.world.relayCenters=[];this.time=0;this.active=false;this.tasks=[];this.queue=[];this.completed=[];this.events=[];this.incidents=[];this.preemptions=0;this.safetyFailures=0;this.minFleetSeparation=Infinity;this.idCounter=0;this.nextDemand=100;this.fired=new Set();
      this.stations=[{name:'江南配送站',point:this.safe(xy([-987.5,962.5])),bank:'south'},{name:'江北应急转运站',point:this.safe(xy([-2930,-1150])),bank:'north'},{name:'江南保障站',point:this.safe(xy([-670,360])),bank:'south'}];
      const extraHomes=[[-1210,820],[-310,580],[-680,140],[-1100,650],[-3170,-1490],[-190,120],[-860,480],[-3340,-1270]],extraColors=['#11a5d7','#f1ae29','#7366eb','#ee567f','#af59d5','#fa753f','#18bba2','#658ee8'];
      const allSpecs=[...specs,...specs.map((spec,i)=>({...spec,id:'U'+String(i+9).padStart(2,'0'),name:spec.name.slice(0,-2)+String(i+9).padStart(2,'0'),home:extraHomes[i],color:extraColors[i]}))];
      this.actors=allSpecs.slice(0,fleetSize).map((spec,i)=>({...spec,home:this.safe(xy(spec.home)),position:this.safe(xy(spec.home)),altitude:120+i*20,battery:100,status:'IDLE',task:null,sim:null,totalDistance:0,link:new Safety.HeartbeatLink(seed+i*17),chargeUntil:0,missionCount:0}));
      this.world.closestClearance(this.world.start,0);this.selectedId='U01';
      this.seedDailyTasks();this.dispatch();
      for(const actor of this.actors)if(!actor.sim){actor.sim=this.makeSimulation(actor,actor.home);actor.sim.state='READY';actor.sim.active=false;}
      this.log('INFO','两岸城市运营就绪',`${fleetSize}架无人机，120–${this.actors.at(-1).altitude}m教学飞层，20m垂直隔离；江北只保留40个抽样建筑。`);
    }
    log(level,title,detail=''){this.events.push({t:+this.time.toFixed(2),level,title,detail});}
    safe(p){if(this.world.inside(p.x,p.y)&&!this.world.blocked(p.x,p.y))return {...p};for(let r=1;r<22;r++)for(let y=p.y-r;y<=p.y+r;y++)for(let x=p.x-r;x<=p.x+r;x++)if(this.world.inside(x,y)&&!this.world.blocked(x,y))return {x,y};throw new Error('No safe mission point');}
    createTask(type,waypoints,{priority=30,title=kinds[type],incident=null,serviceSeconds=5}={}){
      const task={id:'T'+String(++this.idCounter).padStart(3,'0'),type,title,priority,emergency:priority>=80,waypoints:waypoints.map(p=>this.safe(p)),stage:0,state:'QUEUED',createdAt:this.time,firstAssignedAt:null,arrivedAt:null,completedAt:null,actor:null,incidentId:incident?.id||null,serviceSeconds,distance:0,interruptions:0};this.tasks.push(task);this.queue.push(task);return task;
    }
    seedDailyTasks(){
      this.createTask('parcel',[this.actors[0].home,xy([-410,690])],{priority:35,title:'江南快递：取件与送达'});
      this.createTask('food',[this.actors[1].home,xy([-20,460])],{priority:40,title:'外卖：餐点取货与投送'});
      this.createTask('patrol',[xy([-1310,305]),xy([-1160,520]),xy([-90,-120])],{priority:15,title:'江南道路与隧道口巡逻'});
      this.createTask('routine_medical',[this.actors[3].home,xy([-710,710])],{priority:35,title:'常规医疗样本配送'});
      this.createTask('supply',[this.actors[4].home,xy([-3140,-1430])],{priority:25,title:'江北应急站日常补给'});
      this.createTask('inspection',[xy([-70,140]),xy([-220,-50])],{priority:20,title:'消防设施日常巡检'});
      this.createTask('supply',[this.actors[6].home,xy([-410,690])],{priority:25,title:'江南站点补给'});
      this.createTask('inspection',[xy([-3300,-1300]),xy([-2790,-1350])],{priority:20,title:'江北设施巡检'});
      for(const [i,actor]of this.actors.slice(8).entries()){
        const type=['parcel','food','patrol','routine_medical','supply','inspection','supply','inspection'][i],north=i===4||i===7;
        const goal=north?xy([-3060+(i%2)*90,-1430+(i%3)*60]):xy([-1080+(i%4)*270,590-(i%3)*175]);
        this.createTask(type,[actor.home,goal],{priority:{parcel:35,food:40,patrol:15,routine_medical:35,supply:25,inspection:20}[type],title:actor.name+'：'+kinds[type]});
      }
    }
    get selected(){return this.actors.find(a=>a.id===this.selectedId)||this.actors[0];}
    select(id){if(this.actors.some(a=>a.id===id))this.selectedId=id;return this.selected;}
    start(){this.active=true;for(const a of this.actors)if(a.status==='FLYING')a.sim.active=true;this.log('INFO','城市运营开始',this.policy==='priority'?(this.preemptionEnabled?'应急优先、风险路径代价选择与低优先级任务抢占。':'应急优先、风险路径代价选择；禁止抢占在途任务。'):'FIFO 到达顺序，不抢占在途任务。');}
    togglePause(){this.active=!this.active;for(const a of this.actors)if(a.sim)a.sim.active=this.active&&a.status==='FLYING';}
    makeSimulation(actor,goal){
      const shadow=Object.create(this.world);shadow.config={...G.config,altitude:actor.altitude};shadow.start={...actor.home};shadow.goal={...goal};shadow.intruders=this.world.intruders;shadow.occupied=this.world.occupied;shadow.occupiedDirty=false;
      shadow.planningSource=this.world;
      const sim=new S.Simulation({scenario:'operations',environment:'qianjiang',algorithm:'risk',groundWeight:this.weights.ground,linkWeight:this.weights.link,seed:this.seed,externalClock:true,energyPerMeter:.008,energyPerSecond:.035,world:shadow,deferPlanning:true});
      sim.world=shadow;sim.config=shadow.config;sim.pos={...actor.position};sim.trace=[{...sim.pos}];sim.route=[];sim.initialRoute=[];sim.events=[];sim.time=this.time;sim.battery=actor.battery;sim.link=actor.link;sim.lastSample=this.time;
      if(this.planBackend){actor.sim?.cancelPlanning();sim.usePlanningBackend(this.planBackend,Number(actor.id.slice(1)));if(actor.status==='FLYING'&&W.distance(actor.position,goal)>1e-6&&actor.sim?.index<actor.sim?.route.length)sim.route=[{...sim.pos},...actor.sim.route.slice(actor.sim.index)];}
      sim.plan('任务航路规划',false);sim.state=sim.route.length?'FLYING':'BLOCKED';sim.active=this.active&&(sim.route.length>0||!!sim.pendingPlanner);return sim;
    }
    findDispatchPath(start,goal){this.dispatchCacheHit=false;const search=()=>P.astar({width:this.world.width,height:this.world.height,start,goal,blocked:(x,y)=>this.world.planningBlocked(x,y),risk:(x,y)=>this.world.planningRisk(x,y),weights:this.weights});if(!this.planBackend)return search();const key=[this.world.revision,this.world.geometryRevision,this.weights.ground,this.weights.link,start.x,start.y,goal.x,goal.y].join(':');this.dispatchCache??=new Map();if(this.dispatchCache.has(key)){this.dispatchCacheHit=true;this.schedulerStats.pathCacheHits=(this.schedulerStats.pathCacheHits||0)+1;return this.dispatchCache.get(key);}const result=search();this.dispatchCache.set(key,result);if(this.dispatchCache.size>96)this.dispatchCache.delete(this.dispatchCache.keys().next().value);return result;}
    assign(actor,task){
      if(actor.task){const old=actor.task;old.state='QUEUED';old.actor=null;old.interruptions++;old.distance+=actor.sim?.distance||0;actor.totalDistance+=actor.sim?.distance||0;this.queue.push(old);this.preemptions++;this.log('WARN','应急任务抢占',`${actor.name} 暂停 ${old.title}，执行 ${task.title}。未完成的日常任务保留原阶段。`);}
      actor.task=task;task.actor=actor.id;task.state='ASSIGNED';task.firstAssignedAt??=this.time;actor.status='FLYING';actor.sim=this.makeSimulation(actor,task.waypoints[task.stage]);this.log('INFO','派发任务',`${task.id} ${task.title}，${actor.name}，优先级 ${task.priority}，飞层 ${actor.altitude} m。`);
      if(task.emergency&&task.firstAssignedAt===this.time){const incident=this.incidents.find(i=>i.id===task.incidentId);if(incident)incident.assignedAt=this.time;}
    }
    decisionContext(task){return {t:+this.time.toFixed(2),taskId:task.id,title:task.title,priority:task.priority,composition:this.composition||'uav',policy:this.policy,preemptionEnabled:this.preemptionEnabled,task:{type:task.type,emergency:task.emergency,createdAt:task.createdAt,stage:task.stage,waypoints:task.waypoints.map(p=>({...p})),people:task.people||0,payloadKg:task.payloadKg||0,requiredType:task.requiredType||null,incidentId:task.incidentId||null},queue:this.queue.map(t=>({id:t.id,title:t.title,priority:t.priority,createdAt:t.createdAt,emergency:t.emergency})),resources:this.resources?.snapshot()||[],candidates:[],chosen:null};}
    candidateSnapshot(actor){return {id:actor.id,type:actor.aircraftType||'uav',name:actor.name,position:{...actor.position},altitude:actor.altitude,battery:+actor.battery.toFixed(2),status:actor.verticalState||actor.status,currentTaskId:actor.task?.id||null,currentTaskTitle:actor.task?.title||null,currentPriority:actor.task?.priority??null,skills:[...actor.skills],seats:actor.profile?.seats||0,payloadKg:actor.profile?.payloadKg||0,cost:null,reason:''};}
    recordDecision(decision){
      this.latestDecision=decision;this.decisionsByTask??=new Map();this.decisionsByTask.set(decision.taskId,decision);
      this.decisionRecords??=new Map();const records=this.decisionRecords.get(decision.taskId)||[],previous=records.at(-1);
      // Preserve the first check and recent changed checks; polling alone is not a new decision.
      const signature=d=>JSON.stringify([d.chosen,d.candidates.map(c=>[c.id,c.reason,c.cost,c.requiredEnergy,c.currentTaskId])]);
      if(!previous||signature(previous)!==signature(decision)){this.decisionSequence=(this.decisionSequence||0)+1;decision.sequence=this.decisionSequence;records.push(decision);if(records.length>24)records.splice(1,records.length-24);this.decisionRecords.set(decision.taskId,records);this.decisionHistory??=[];this.decisionHistory.push(decision);if(this.decisionHistory.length>200)this.decisionHistory.shift();}
    }
    dispatch(){
      this.schedulerStats.dispatchCalls++;this.queue=this.queue.filter(t=>t.state==='QUEUED');this.schedulerStats.maxQueue=Math.max(this.schedulerStats.maxQueue,this.queue.length);this.queue.sort((a,b)=>this.policy==='priority'?b.priority-a.priority||a.createdAt-b.createdAt:a.createdAt-b.createdAt);
      for(const task of [...this.queue]){
        const decision=this.decisionContext(task);decision.candidates=this.actors.map(a=>({...this.candidateSnapshot(a),reason:!a.skills.includes(task.type)?'任务能力不符':!this.linkReady(a)?'通信未恢复':a.battery<=35?'能源低于门槛':'执行任务 / 补能 / 返航'}));
        const candidates=this.actors.filter(a=>a.skills.includes(task.type)&&this.linkReady(a)&&a.status!=='CHARGING'&&a.status!=='DISABLED'&&!a.sim?.returning&&(a.status==='IDLE'||this.preemptionEnabled&&this.policy==='priority'&&task.emergency&&a.status==='FLYING'&&a.task&&!a.task.emergency&&!a.payloadLocked&&a.task.priority<task.priority)&&a.battery>35);
        candidates.sort((a,b)=>W.distance(a.position,task.waypoints[task.stage])-W.distance(b.position,task.waypoints[task.stage]));
        let chosen=null,best=Infinity;
        for(const actor of candidates){const record=decision.candidates.find(c=>c.id===actor.id);const start=this.safe({x:Math.round(actor.position.x),y:Math.round(actor.position.y)}),goal=task.waypoints[task.stage];if(this.planBackend){let bound=W.distance(start,goal)*25;for(let i=task.stage+1;i<task.waypoints.length;i++)bound+=W.distance(task.waypoints[i-1],task.waypoints[i])*25*1.25;const lower=bound*(.008+.035/12)+20;if(actor.battery<lower-1e-8){this.schedulerStats.energyRejected++;record.reason='剩余航程能源不足';record.requiredEnergy=+lower.toFixed(1);record.energyLowerBound=true;continue;}}const r=this.findDispatchPath(start,goal);if(!this.dispatchCacheHit){this.schedulerStats.pathSearches++;this.schedulerStats.expandedNodes+=r.expanded;}if(!r.path.length){this.schedulerStats.unreachableRejected++;record.reason='无可达航路';continue;}
          let budgetDistance=P.pathLength(r.path)*G.config.cellMeters;for(let i=task.stage+1;i<task.waypoints.length;i++)budgetDistance+=W.distance(task.waypoints[i-1],task.waypoints[i])*G.config.cellMeters*1.25;
          const required=budgetDistance*(.008+.035/12)+20;record.requiredEnergy=+required.toFixed(1);if(actor.battery<required){this.schedulerStats.energyRejected++;record.reason='剩余航程能源不足';continue;}
          const cost=r.cost*G.config.cellMeters+(actor.status==='FLYING'?120:0);record.cost=+cost.toFixed(2);record.pathCost=+(r.cost*25).toFixed(2);record.resourcePenalty=0;record.preemptionPenalty=actor.status==='FLYING'?120:0;record.reason='可用候选';if(cost<best){best=cost;chosen=actor;}}
        if(chosen){this.queue.splice(this.queue.indexOf(task),1);this.assign(chosen,task);this.schedulerStats.assignments++;decision.chosen=chosen.id;}
        this.recordDecision(decision);
      }
    }
    addDaily(type='parcel'){
      const n=this.tasks.filter(t=>t.type===type).length,bank=n%2;
      if(type==='food')this.createTask(type,[this.actors[1].home,xy([-130+(n%3)*140,410+(n%2)*120])],{priority:40});
      else if(type==='patrol')this.createTask(type,bank?[xy([-3300,-1300]),xy([-2820,-1300])]:[xy([-1310,305]),xy([-250,-120])],{priority:15});
      else this.createTask(type,[bank?this.stations[1].point:this.stations[0].point,bank?xy([-3190,-1490]):xy([-230,760])],{priority:35});this.log('INFO','新增日常需求',kinds[type]);this.dispatch();
    }
    trigger(type){
      const id='E'+(this.incidents.length+1),incident={id,type,createdAt:this.time,status:'WAITING',assignedAt:null,airArrivedAt:null,groundArrivedAt:null,resolvedAt:null,intensity:type==='fire'?100:0};
      if(type==='fire'){
        const building=G.data.buildings.filter(b=>b.height>=15&&b.height<=100&&!b.bank).map(b=>({b,p:xy([b.points.reduce((s,p)=>s+p[0],0)/b.points.length,b.points.reduce((s,p)=>s+p[1],0)/b.points.length])})).filter(o=>this.actors.every(a=>W.distance(a.position,o.p)>5)).sort((a,b)=>W.distance(a.p,this.actors[5].position)-W.distance(b.p,this.actors[5].position))[0];
        incident.position=building?building.p:this.safe(xy([-110,160]));incident.roofHeight=building?.b.height||30;incident.goal=this.safe({x:incident.position.x+4,y:incident.position.y});incident.cells=[];
        for(let y=incident.position.y-1;y<=incident.position.y+1;y++)for(let x=incident.position.x-1;x<=incident.position.x+1;x++)if(this.world.inside(x,y)){incident.cells.push({x,y,previous:this.world.get(x,y)});this.world.set(x,y,2);}
        this.createTask('fire',[incident.goal],{priority:110,title:'火情侦察与模拟灭火投放',incident,serviceSeconds:10});
      }else if(type==='medical'){
        incident.position={...this.stations[1].point};incident.goal={...incident.position};incident.crossRiver=true;
        const medicalTask=this.createTask('medical',[this.stations[0].point,incident.goal],{priority:105,title:'江南物资取货 / 跨江医疗急送',incident,serviceSeconds:8});
        incident.groundCar=this.createMedicalGround(incident,medicalTask);
        if(!incident.groundCar)this.log('ERROR','地面支路无可行路线','跨江联动不会被记录为完成。');
      }else if(type==='rescue'){
        incident.position=this.safe(xy([-2990,-1480]));incident.goal={...incident.position};this.createTask('rescue',[incident.goal],{priority:100,title:'江北求救点应急物资投送',incident,serviceSeconds:10});
      }else if(type==='relay'){
        incident.position=this.safe(xy([-500,260]));incident.goal={...incident.position};this.createTask('relay',[incident.goal],{priority:85,title:'应急通信中继驻留',incident,serviceSeconds:45});
      }else return null;
      this.incidents.push(incident);this.log('WARN','突发事件发布',`${id} ${type==='medical'?'跨江医疗协同':kinds[type]}，进入应急任务队列。`);this.dispatch();return incident;
    }
    createMedicalGround(){return this.world.traffic.spawnTrip([-1120,428],[-3050,-1240],'跨江救护车');}
    updateCrossRiverIncident(incident){
      if(incident.groundCar?.arrived)incident.groundArrivedAt??=incident.groundCar.arrivedAt;
      if(incident.airDeliveryCompleted&&incident.groundArrivedAt!==null&&incident.resolvedAt===null){incident.resolvedAt=this.time;incident.status='RESOLVED';this.log('INFO','跨江空地交接完成','无人机已完成物资投放，经博奥隧道到达的地面救护车也已到位。只表示仿真物资交接，不表示真实救治。');}
    }
    inject(type){const actor=this.selected;if(!actor.sim)return false;if(type==='disconnect'){actor.link.forced=!actor.link.forced;this.log('WARN',actor.link.forced?'机载心跳断链':'机载心跳恢复',actor.name);return true;}if(type==='battery'){actor.battery=19;actor.sim.forceLowBattery();if(actor.status==='IDLE'||actor.status==='CHARGING')this.beginCharge(actor);return true;}
      const ok=actor.sim.injectEvent(type);this.world.intruders=actor.sim.world.intruders;this.world.cells=actor.sim.world.cells;this.world.revision++;this.world.lastChange=type==='birds'?'dynamic':'geometry';this.world.occupiedDirty=true;this.log('WARN','飞行事件注入',`${actor.name}：${type}`);return ok;
    }
    completeTask(actor){
      const task=actor.task;task.state='COMPLETED';task.completedAt=this.time;actor.missionCount++;this.completed.push(task);this.log('INFO','任务完成',`${actor.name}：${task.title}，耗时 ${(this.time-task.createdAt).toFixed(1)} s。`);
      const incident=this.incidents.find(i=>i.id===task.incidentId);if(incident){incident.airArrivedAt??=this.time;incident.airDeliveryCompleted=true;incident.status=incident.crossRiver?'WAITING_GROUND':'RESOLVED';if(!incident.crossRiver)incident.resolvedAt=this.time;
        if(task.type==='fire'){incident.intensity=0;for(const p of incident.cells||[])if(this.world.get(p.x,p.y)===2)this.world.set(p.x,p.y,p.previous);this.log('INFO','模拟火情处置完成','强度指标降为零，不代表真实流体灭火能力。');}}
      if(task.type==='relay'){this.world.relayCenters=this.world.relayCenters.filter(p=>p.incidentId!==task.incidentId);this.world.revision++;this.world.lastChange='risk';this.world.lastRisk='link';this.log('INFO','中继驻留结束','撤销临时覆盖增益。');}
      actor.task=null;actor.status='IDLE';if(actor.battery<65)this.beginCharge(actor);
    }
    linkReady(actor){return !actor.link.forced&&this.time-actor.link.lastReceived<4;}
    clearRelay(task){if(task?.type!=='relay')return;this.world.relayCenters=this.world.relayCenters.filter(p=>p.incidentId!==task.incidentId);const incident=this.incidents.find(i=>i.id===task.incidentId);if(incident)incident.relayEnabled=false;this.world.revision++;this.world.lastChange='risk';this.world.lastRisk='link';}
    markTaskStopped(actor,state,reason){const task=actor.task;if(!task)return;task.state=state;task.endedAt=this.time;task.reason=reason;this.clearRelay(task);const incident=this.incidents.find(i=>i.id===task.incidentId);if(incident){incident.status=state;incident.endedAt=this.time;incident.reason=reason;}this.log('WARN',state==='ABORTED'?'任务安全中止':'任务安全停止',actor.name+'：'+reason);}
    finishReturn(actor){const task=actor.task;this.clearRelay(task);if(task.people>0&&task.stage>0)this.markTaskStopped(actor,'ABORTED','已接运人员随原机安全返航，转运中止，未计为送达。');else{task.state='QUEUED';task.actor=null;this.queue.push(task);const incident=this.incidents.find(i=>i.id===task.incidentId);if(incident)incident.status='WAITING';}actor.task=null;this.beginCharge(actor);}
    serviceSafety(actor,dt,age){
      const sim=actor.sim,action=Safety.decision({battery:actor.battery,age,returning:sim.returning},sim.config),navLost=this.time<sim.navLostUntil;
      if(action==='LAND'){sim.state='LANDED';sim.battery=actor.battery;actor.status='DISABLED';actor.serviceHold='能源耗尽，服务停止';this.safetyFailures++;this.markTaskStopped(actor,'FAILED',actor.serviceHold);return false;}
      if(action==='RETURN'&&!navLost){this.clearRelay(actor.task);actor.serviceHold='';actor.status='FLYING';actor.sim=this.makeSimulation(actor,actor.home);actor.sim.returning=true;if(actor.sim.planBackend)actor.sim.plan('服务中断后的返航航路',false);actor.sim.state='RETURNING';actor.sim.active=this.active;const incident=this.incidents.find(i=>i.id===actor.task.incidentId);if(incident)incident.status='RETURNING';this.log('WARN','现场服务中断并返航',actor.name+'：'+(actor.battery<=sim.config.lowBattery?'能源达到返航阈值':'持续心跳超时'));return false;}
      const reason=navLost?'导航异常，暂停服务':action==='HOLD'?'通信异常，暂停服务':'';
      if(reason){if(reason!==actor.serviceHold)this.log('WARN','现场服务暂停',actor.name+'：'+reason);actor.serviceHold=reason;actor.serviceUntil+=dt;sim.state=navLost?'NAV_HOLD':'COMM_HOLD';sim.battery=actor.battery;return false;}
      if(actor.serviceHold){this.log('INFO','现场服务恢复',actor.name);actor.serviceHold='';sim.state='DELIVERED';}sim.battery=actor.battery;return true;
    }
    beginCharge(actor){actor.status='CHARGING';actor.serviceHold='';actor.chargeUntil=this.time+20;actor.chargeStart=actor.battery;this.log('INFO','进入模拟补能',`${actor.name} 停止水平任务，20 s 简化补能。未模拟真实充电或燃油补给过程。`);}
    step(seconds){if(!Number.isFinite(seconds)||seconds<0)throw new Error('Invalid operations step');while(seconds>1e-9&&this.active){const dt=Math.min(.05,seconds);this.tick(dt);seconds-=dt;}}
    tick(dt){
      this.time+=dt;this.world.traffic.step(dt);this.world.intruders=this.world.intruders.filter(o=>!o.expires||o.expires>this.time);
      if(this.time-this.world.trafficSnapshotTime>=3){this.world.traffic.snapshot();this.world.trafficSnapshotTime=this.time;this.world.revision++;this.world.lastChange='risk';this.world.lastRisk='ground';}
      if(this.autoEvents)for(const [at,type]of [[30,'fire'],[45,'rescue'],[60,'medical'],[90,'relay']])if(this.time>=at&&!this.fired.has(type)){this.fired.add(type);this.trigger(type);}
      if(!this.continuousOperations&&this.time>=this.nextDemand){this.nextDemand+=100;this.addDaily(this.tasks.length%2?'food':'parcel');}
      if(this.world.occupiedDirty)this.world.closestClearance(this.world.start,this.time);
      for(const actor of this.actors){
        if(actor.sim&&actor.status!=='FLYING')actor.sim.time=this.time;
        if(actor.status==='CHARGING'){actor.battery=Math.min(100,actor.chargeStart+(100-actor.chargeStart)*((this.time-(actor.chargeUntil-20))/20));actor.link.tick(this.time,this.world.risk(actor.position.x,actor.position.y).link);if(this.time>=actor.chargeUntil){actor.battery=100;actor.status='IDLE';actor.sim=this.makeSimulation(actor,this.safe({x:Math.round(actor.position.x),y:Math.round(actor.position.y)}));actor.sim.state='READY';actor.sim.active=false;this.log('INFO','补能完成',actor.name);}continue;}
        if(actor.status==='IDLE'||actor.status==='DISABLED'){actor.link.tick(this.time,this.world.risk(actor.position.x,actor.position.y).link);continue;}
        const sim=actor.sim;sim.world.revision=this.world.revision;sim.world.lastChange=this.world.lastChange;sim.world.lastRisk=this.world.lastRisk;sim.world.intruders=this.world.intruders;sim.world.occupied=this.world.occupied;sim.world.occupiedDirty=false;
        if(actor.status==='FLYING'){
          sim.active=true;sim.step(dt);actor.position={...sim.pos};actor.battery=sim.battery;
          if(S.terminal.has(sim.state)){
            actor.totalDistance+=sim.distance;actor.task.distance+=sim.distance;
            if(sim.state==='DELIVERED'){actor.status='SERVICING';actor.serviceUntil=this.time+(actor.task.stage<actor.task.waypoints.length-1?3:actor.task.serviceSeconds);const incident=this.incidents.find(i=>i.id===actor.task.incidentId);if(actor.task.stage===actor.task.waypoints.length-1)actor.task.arrivedAt=this.time;if(incident&&actor.task.stage===actor.task.waypoints.length-1){incident.airArrivedAt??=this.time;incident.status='ON_SITE';}
              this.log('INFO','到达任务点',`${actor.name} ${actor.task.stage<actor.task.waypoints.length-1?'取件 / 巡检记录':'现场作业'}：${actor.task.title}`);}
            else if(sim.state==='RETURNED'){this.finishReturn(actor);}
            else{this.safetyFailures++;actor.status='DISABLED';this.markTaskStopped(actor,'FAILED','飞行安全停止 '+sim.state);this.log('ERROR','飞行安全停止',actor.name+' '+sim.state);}
          }
        }else if(actor.status==='SERVICING'){
          actor.battery=Math.max(0,actor.battery-dt*(actor.onGround?.002:(actor.profile?.energySecond??.035)));const age=actor.link.tick(this.time,this.world.risk(actor.position.x,actor.position.y).link);if(!this.serviceSafety(actor,dt,age))continue;const task=actor.task,incident=this.incidents.find(i=>i.id===task.incidentId);
          if(task.type==='fire'&&incident)incident.intensity=Math.max(0,incident.intensity-dt*12);
          if(task.type==='relay'&&incident&&!incident.relayEnabled){incident.relayEnabled=true;this.world.relayCenters.push({...actor.position,incidentId:incident.id});this.world.revision++;this.world.lastChange='risk';this.world.lastRisk='link';this.log('INFO','中继就位','200 m 仿真覆盖范围内通信风险代理值乘 0.35。');}
          if(this.time>=actor.serviceUntil){if(task.stage<task.waypoints.length-1){task.stage++;actor.status='FLYING';actor.sim=this.makeSimulation(actor,task.waypoints[task.stage]);}else this.completeTask(actor);}
        }
      }
      for(const incident of this.incidents)if(incident.crossRiver)this.updateCrossRiverIncident(incident,dt);
      for(let i=0;i<this.actors.length;i++)for(let j=i+1;j<this.actors.length;j++){const a=this.actors[i],b=this.actors[j],d=Math.hypot(W.distance(a.position,b.position)*G.config.cellMeters,a.altitude-b.altitude);this.minFleetSeparation=Math.min(this.minFleetSeparation,d);}
      if(Math.floor((this.time-dt)*2)!==Math.floor(this.time*2))this.dispatch();
    }
    summary(){const emergencies=this.tasks.filter(t=>t.emergency),assigned=emergencies.filter(t=>t.firstAssignedAt!==null),arrived=emergencies.filter(t=>t.arrivedAt!==null||this.incidents.find(i=>i.id===t.incidentId)?.airArrivedAt!==null);const delays=assigned.map(t=>t.firstAssignedAt-t.createdAt),responses=this.incidents.filter(i=>i.airArrivedAt!==null).map(i=>i.airArrivedAt-i.createdAt),cross=this.incidents.find(i=>i.crossRiver);
      return {policy:this.policy,time_s:+this.time.toFixed(2),fleet:this.actors.length,tasks_created:this.tasks.length,daily_completed:this.completed.filter(t=>!t.emergency).length,emergency_completed:this.completed.filter(t=>t.emergency).length,waiting:this.queue.length,preemptions:this.preemptions,mean_dispatch_delay_s:delays.length?+(delays.reduce((a,b)=>a+b,0)/delays.length).toFixed(2):null,mean_air_response_s:responses.length?+(responses.reduce((a,b)=>a+b,0)/responses.length).toFixed(2):null,cross_river_state:cross?.status||'NOT_REQUESTED',cross_river_air_s:cross?.airArrivedAt!==null&&cross?.airArrivedAt!==undefined?+(cross.airArrivedAt-cross.createdAt).toFixed(2):null,cross_river_ground_s:cross?.groundArrivedAt!==null&&cross?.groundArrivedAt!==undefined?+(cross.groundArrivedAt-cross.createdAt).toFixed(2):null,cross_river_handoff_s:cross?.resolvedAt!==null&&cross?.resolvedAt!==undefined?+(cross.resolvedAt-cross.createdAt).toFixed(2):null,distance_m:+this.actors.reduce((sum,a)=>sum+a.totalDistance+(a.status==='FLYING'?(a.sim?.distance||0):0),0).toFixed(2),safety_failures:this.safetyFailures,min_fleet_separation_m:Number.isFinite(this.minFleetSeparation)?+this.minFleetSeparation.toFixed(2):null};}
    export(){return {schema:'lowair-operations/v1',planningMode:this.planBackend?'adaptive-worker':'periodic-baseline',decisions:[...(this.decisionsByTask?.values()||[])],preemptionEnabled:this.preemptionEnabled,schedulerStats:{...this.schedulerStats},assumptions:'固定独立飞层、理想导航与感知、简化补能、地面/空中任务状态与物资交接；非真实消防流体或医疗救治模型。',summary:this.summary(),source:{southHash:this.world.geo.sourceSha256,northHash:this.world.geo.northSourceSha256},actors:this.actors.map(a=>({id:a.id,name:a.name,skills:a.skills,altitude:a.altitude,battery:a.battery,position:a.position,status:a.status,task:a.task?.id||null,missions:a.missionCount,distance:a.totalDistance})),tasks:this.tasks,incidents:this.incidents.map(i=>({...i,groundCar:i.groundCar?{arrived:i.groundCar.arrived,arrivedAt:i.groundCar.arrivedAt,itinerary:i.groundCar.itinerary.map(e=>e.road.name),position:this.world.traffic.position(i.groundCar)}:null})),events:this.events};}
  }
  function runOperations({policy='priority',seed=42,duration=500,...options}={}){const ops=new Operations({policy,seed,...options});ops.start();while(ops.time<duration-1e-9)ops.step(Math.min(.05,duration-ops.time));return {result:{...ops.summary(),seed},ops};}
  function compareOperations({seeds=[42],duration=500}={}){const rows=[];for(const seed of seeds)for(const policy of ['fifo','priority'])rows.push(runOperations({policy,seed,duration}).result);return rows;}
  return {Operations,runOperations,compareOperations,kinds,statusNames};
});
