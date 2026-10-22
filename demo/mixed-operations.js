(function(root,factory){
  const api=typeof module==='object'&&module.exports?factory(require('./operations.js'),require('./world.js'),require('./planner.js'),require('./geo.js'),require('./safety.js'),require('./priority-traffic.js')):factory(root.LowAirOperations,root.LowAirWorld,root.LowAirPlanner,root.LowAirGeo,root.LowAirSafety,root.LowAirPriorityTraffic);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.LowAirMixed=api;
})(globalThis,function(O,W,P,G,Safety,PriorityTraffic){
  'use strict';
  // 课程设定，非特定机型实测参数。percent 表示抽象能源余量，直升机为燃油代理。
  const profiles=Object.freeze({
    uav:{label:'无人机',speed:12,radius:1.6,energyMeter:.008,energySecond:.035,reserve:20,seats:0,payloadKg:2,departure:0,energyLabel:'电量'},
    helicopter:{label:'直升机',speed:45,radius:20,energyMeter:.002,energySecond:.04,reserve:25,seats:4,payloadKg:400,departure:8,energyLabel:'燃油代理'},
    evtol:{label:'eVTOL',speed:28,radius:12,energyMeter:.003,energySecond:.05,reserve:25,seats:4,payloadKg:100,departure:8,energyLabel:'电量'}
  });
  const names={passenger:'两岸短途客运',evacuation:'直升机人员转运'};
  class Resources {
    constructor(){this.items=new Map();this.history=[];}
    add(id,name,capacity=1){this.items.set(id,{id,name,capacity,holders:new Set(),requests:new Map()});}
    request(id,actor,priority,time){const r=this.items.get(id);if(r&&!r.holders.has(actor))r.requests.set(actor,{actor,priority,time});}
    grant(time){for(const r of this.items.values())for(const q of [...r.requests.values()].sort((a,b)=>b.priority-a.priority||a.time-b.time||a.actor.localeCompare(b.actor))){if(r.holders.size>=r.capacity)break;r.holders.add(q.actor);r.requests.delete(q.actor);this.history.push({t:time,resource:r.id,actor:q.actor,action:'acquire',priority:q.priority});}}
    release(id,actor,time){const r=this.items.get(id);if(r?.holders.delete(actor))this.history.push({t:time,resource:id,actor,action:'release'});r?.requests.delete(actor);}
    owns(id,actor){return this.items.get(id)?.holders.has(actor)||false;}
    releaseActor(actor,time){for(const id of this.items.keys())this.release(id,actor,time);}
    snapshot(){return [...this.items.values()].map(r=>({id:r.id,name:r.name,capacity:r.capacity,holders:[...r.holders],waiting:[...r.requests.values()].sort((a,b)=>b.priority-a.priority||a.time-b.time).map(q=>q.actor)}));}
  }
  const xy=p=>{const q=G.toGrid(p);return {x:Math.round(q.x),y:Math.round(q.y)};};
  class MixedOperations extends O.Operations {
    constructor(options={}){
      super({fleetSize:16,...options,autoEvents:false});this.autoEvents=options.autoEvents??true;this.mixedReady=true;this.composition='mixed';this.resources=new Resources();
      this.mixedStats={capacityRejected:0,typeRejected:0,energyRejected:0,resourceHoldSeconds:0,yieldSeconds:0,yieldEvents:0,passengerTrips:0,peopleTransferred:0};
      this.pads=[
        {id:'south-port',name:'江南综合起降场',point:this.safe(xy([-1100,650])),bank:'south',accepts:['helicopter','evtol'],capacity:1},
        {id:'north-port',name:'江北转运起降场',point:this.safe(xy([-2930,-1150])),bank:'north',accepts:['helicopter','evtol'],capacity:1},
        {id:'south-rescue',name:'江南救援集结点',point:this.safe(xy([-390,-80])),bank:'south',accepts:['helicopter'],capacity:1}
      ];
      for(const pad of this.pads)this.resources.add(pad.id,pad.name,pad.capacity);
      this.resources.add('river-corridor','跨江大型航空器航路',1);
      for(const actor of this.actors){actor.aircraftType='uav';actor.profile=profiles.uav;actor.resourceWait=0;actor.yieldTime=0;}
      for(const [i,type]of ['helicopter','helicopter','evtol','evtol'].entries()){
        const pad=this.pads[i%2],id=(type==='helicopter'?'H':'V')+String(i<2?i+1:i-1).padStart(2,'0'),home={...pad.point};
        const actor={id,name:type==='helicopter'?'救援直升机'+(i+1):'跨江eVTOL'+(i-1),aircraftType:type,skills:type==='helicopter'?['evacuation']:['passenger','medical'],profile:profiles[type],color:type==='helicopter'?'#f27048':'#3fbbf4',home,position:{...home},homePad:pad.id,altitude:460+i*40,battery:100,status:'IDLE',task:null,sim:null,totalDistance:0,link:new Safety.HeartbeatLink(this.seed+300+i*17),chargeUntil:0,missionCount:0,resourceWait:0,yieldTime:0};
        actor.sim=this.makeSimulation(actor,home);actor.sim.state='READY';actor.sim.active=false;this.actors.push(actor);
      }
      this.createPassenger('south-port','north-port');this.createPassenger('north-port','south-port');this.dispatch();
      this.log('INFO','混合低空交通就绪',`${this.fleetSize}架无人机、2架救援直升机、2架eVTOL。起降场和跨江大型航空器航路均按单容量管制。`);
    }
    makeSimulation(actor,goal){const sim=super.makeSimulation(actor,goal),p=actor.profile;if(p){sim.options.energyPerMeter=p.energyMeter;sim.options.energyPerSecond=p.energySecond;sim.config=sim.world.config={...sim.config,speed:p.speed/G.config.cellMeters,safetyRadius:p.radius/G.config.cellMeters};}return sim;}
    createTask(type,waypoints,options={}){if(type==='medical'&&this.mixedReady){waypoints=[this.pads[0].point,this.pads[1].point];options={...options,payloadKg:5,requiredType:'evtol',padIds:['south-port','north-port'],title:'5kg医疗物资：eVTOL跨江 / 地面接应'};}if(!Number.isInteger(options.people??0)||(options.people??0)<0||!Number.isFinite(options.payloadKg??0)||(options.payloadKg??0)<0)throw Error('Invalid capacity demand');if(this.mixedReady&&(options.padIds||[]).some(id=>!this.pads.some(p=>p.id===id)))throw Error('Invalid task pad');const t=super.createTask(type,waypoints,{...options,title:options.title||names[type]||O.kinds[type]});t.people=options.people??0;t.payloadKg=options.payloadKg??0;t.requiredType=options.requiredType||null;t.padIds=options.padIds||[];return t;}
    createPassenger(from='south-port',to='north-port',people=3){
      const a=this.pads.find(p=>p.id===from),b=this.pads.find(p=>p.id===to);if(!a||!b||a===b)throw Error('Invalid passenger terminals');
      return this.createTask('passenger',[a.point,b.point],{priority:45,title:`两岸客运 ${a.bank==='south'?'江南至江北':'江北至江南'} / ${people}人`,people,requiredType:'evtol',padIds:[a.id,b.id],serviceSeconds:12});
    }
    addDaily(type='parcel'){if(type!=='passenger')return super.addDaily(type);const n=this.tasks.filter(t=>t.type==='passenger').length;this.createPassenger(n%2?'north-port':'south-port',n%2?'south-port':'north-port');this.log('INFO','新增跨江客运','3名乘客候机，检查座位、能源和场站容量。');this.dispatch();}
    trigger(type){if(type!=='evacuation')return super.trigger(type);const pickup=this.pads[2],destination=this.pads[1],incident={id:'E'+(this.incidents.length+1),type,createdAt:this.time,status:'WAITING',assignedAt:null,airArrivedAt:null,groundArrivedAt:null,resolvedAt:null,intensity:0,position:{...pickup.point},goal:{...destination.point},people:2};
      this.incidents.push(incident);this.createTask('evacuation',[pickup.point,destination.point],{priority:120,title:'人员救援：江南集结 / 江北转运',incident,people:2,requiredType:'helicopter',padIds:[pickup.id,destination.id],serviceSeconds:12});this.log('WARN','人员救援发布','2名待转运人员，直升机专用任务，目的地场站优先申请。');this.dispatch();return incident;
    }
    assign(actor,task){if(this.mixedReady){this.resources.releaseActor(actor.id,this.time);actor.legKey=null;actor.holdReason='';actor.holdKey='';}super.assign(actor,task);}
    enableContinuousOperations(enabled=true){
      this.continuousOperations=enabled;this.priorityTraffic=enabled;
      if(enabled&&!this.routineCycles){this.routineCycles=this.tasks.filter(t=>!t.emergency&&!t.internal).map(t=>({key:t.id,last:t,template:{type:t.type,waypoints:t.waypoints.map(p=>({...p})),facilities:t.facilities?.slice(),priority:t.priority,title:t.title,serviceSeconds:t.serviceSeconds,people:t.people||0,payloadKg:t.payloadKg||0,requiredType:t.requiredType||null,padIds:[...(t.padIds||[])]},number:1}));this.routineStats={created:0,byType:{}};this.nextRoutineCheck=this.time+5;}
      if(!enabled)this.nextDemand=this.time+100;
    }
    replenishRoutine(){
      if(!this.continuousOperations||this.time<this.nextRoutineCheck)return;
      this.nextRoutineCheck=this.time+5;
      for(const cycle of this.routineCycles){if(!['COMPLETED','FAILED','ABORTED'].includes(cycle.last.state))continue;
        const cooldown=cycle.template.type==='passenger'?90:['patrol','inspection'].includes(cycle.template.type)?40:30;
        if(this.time-(cycle.last.completedAt??cycle.last.endedAt??this.time)<cooldown)continue;
        const t=cycle.template,task=O.Operations.prototype.createTask.call(this,t.type,t.waypoints,{priority:t.priority,title:t.title+' · 第'+(++cycle.number)+'轮',serviceSeconds:t.serviceSeconds});
        Object.assign(task,{people:t.people,payloadKg:t.payloadKg,requiredType:t.requiredType,padIds:t.padIds.slice(),facilities:t.facilities?.slice(),routineCycle:cycle.key});cycle.last=task;
        this.routineStats.created++;this.routineStats.byType[t.type]=(this.routineStats.byType[t.type]||0)+1;
        this.log('INFO','日常任务续发',task.id+' '+task.title+'；上一轮结束后补充，不重复堆积。');
      }
    }
    dispatch(){
      if(!this.mixedReady)return super.dispatch();
      this.schedulerStats.dispatchCalls++;this.queue=this.queue.filter(t=>t.state==='QUEUED');this.schedulerStats.maxQueue=Math.max(this.schedulerStats.maxQueue,this.queue.length);this.queue.sort((a,b)=>this.policy==='priority'?b.priority-a.priority||a.createdAt-b.createdAt:a.createdAt-b.createdAt);
      for(const task of [...this.queue]){let chosen=null,best=Infinity;const decision=this.decisionContext(task);
        for(const a of this.actors){
          const p=a.profile,record=this.candidateSnapshot(a);decision.candidates.push(record);if(!p||a.status==='CHARGING'||a.status==='DISABLED'||a.sim?.returning){record.reason='补能 / 停用 / 返航';continue;}
          if(!this.linkReady(a)){record.reason='通信未恢复';continue;}
          if(task.requiredType?task.requiredType!==a.aircraftType:!a.skills?.includes(task.type)){this.mixedStats.typeRejected++;record.reason='任务能力不符';continue;}
          if(task.people>p.seats||task.payloadKg>p.payloadKg){this.mixedStats.capacityRejected++;record.reason='座位 / 载荷不足';continue;}
          if(task.padIds.some(id=>!this.pads.find(p=>p.id===id)?.accepts.includes(a.aircraftType))){this.mixedStats.typeRejected++;record.reason='起降点类型不兼容';continue;}
          if(task.facilities?.some(site=>site&&!site.accepts.includes(a.aircraftType))){this.mixedStats.typeRejected++;record.reason='起降设施机型不兼容';continue;}
          // 已载客航班不允许换单。现场服务和已占用起降场同样不抢占。
          const preempt=a.status==='FLYING'&&this.preemptionEnabled&&this.policy==='priority'&&task.emergency&&a.task&&!a.task.emergency&&a.task.people===0&&!a.payloadLocked&&a.task.priority<task.priority;
          if(a.status!=='IDLE'&&!preempt||a.battery<=35){record.reason=a.task?.people?'载客航班不可抢占':a.battery<=35?'能源低于门槛':'执行任务 / 现场作业';continue;}
          const start=this.safe({x:Math.round(a.position.x),y:Math.round(a.position.y)}),goal=task.waypoints[task.stage];if(this.planBackend){let bound=W.distance(start,goal)*25;for(let i=task.stage+1;i<task.waypoints.length;i++)bound+=W.distance(task.waypoints[i-1],task.waypoints[i])*25*1.25;bound+=W.distance(task.waypoints.at(-1),a.home)*25*1.25;const lower=bound*(p.energyMeter+p.energySecond/p.speed)+(task.serviceSeconds+task.waypoints.length*(p.departure+3))*p.energySecond+p.reserve+(this.verticalBudget?.(a,task)||0);if(a.battery<lower-1e-8){this.schedulerStats.energyRejected++;this.mixedStats.energyRejected++;record.reason='全程及返场能源不足';record.requiredEnergy=+lower.toFixed(1);record.energyLowerBound=true;continue;}}const r=this.findDispatchPath(start,goal);
          if(!this.dispatchCacheHit){this.schedulerStats.pathSearches++;this.schedulerStats.expandedNodes+=r.expanded;}if(!r.path.length){this.schedulerStats.unreachableRejected++;record.reason='无可达航路';continue;}
          let length=P.pathLength(r.path)*25;for(let i=task.stage+1;i<task.waypoints.length;i++)length+=W.distance(task.waypoints[i-1],task.waypoints[i])*25*1.25;
          length+=W.distance(task.waypoints.at(-1),a.home)*25*1.25;
          const required=length*(p.energyMeter+p.energySecond/p.speed)+(task.serviceSeconds+task.waypoints.length*(p.departure+3))*p.energySecond+p.reserve+(this.verticalBudget?.(a,task)||0);
          record.requiredEnergy=+required.toFixed(1);if(a.battery<required){this.schedulerStats.energyRejected++;this.mixedStats.energyRejected++;record.reason='全程及返场能源不足';continue;}
          const wait=task.padIds.reduce((sum,id)=>{const r=this.resources.items.get(id);return sum+(r&&[...r.holders].some(id=>id!==a.id)?12:0);},0);
          const routeCost=r.cost*25/p.speed,penalty=preempt?10:0,cost=routeCost+wait+penalty;record.cost=+cost.toFixed(2);record.pathCost=+routeCost.toFixed(2);record.resourcePenalty=wait;record.preemptionPenalty=penalty;record.reason='可用候选';if(cost<best){best=cost;chosen=a;}
        }
        if(chosen){this.queue.splice(this.queue.indexOf(task),1);this.assign(chosen,task);this.schedulerStats.assignments++;decision.chosen=chosen.id;}
        this.recordDecision(decision);
      }
    }
    padNear(point){return this.pads.find(p=>W.distance(point,p.point)*25<=40);}
    bank(point){return this.pads.reduce((a,b)=>W.distance(point,a.point)<W.distance(point,b.point)?a:b).bank;}
    intents(a){
      if(a.aircraftType==='uav'||!a.task)return [];
      const t=a.task,goal=a.sim.returning?a.home:t.waypoints[t.stage],pad=this.pads.find(p=>p.id===(a.sim.returning?a.homePad:t.padIds[t.stage]));
      const key=t.id+':'+t.stage+':'+a.sim.returning;if(key!==a.legKey){a.legKey=key;this.resources.releaseActor(a.id,this.time);a.originPad=this.padNear(a.position);a.departUntil=null;a.departDone=W.distance(a.position,goal)*25<5||!a.originPad;a.crossing=this.bank(a.position)!==this.bank(goal);}
      if(a.status==='SERVICING')return pad?[pad.id]:[];
      if(a.status!=='FLYING')return [];
      if(!a.departDone&&a.departUntil!=null&&this.time>=a.departUntil)a.departDone=true;
      if(!a.departDone)return [a.originPad.id];
      const distance=W.distance(a.position,goal)*25,ids=[];
      if(a.crossing&&distance>180)ids.push('river-corridor');
      if(pad&&distance<=180)ids.push(pad.id);
      return ids;
    }
    tick(dt){
      if(!this.mixedReady)return super.tick(dt);
      const desired=new Map();for(const r of this.resources.items.values())r.requests.clear();
      for(const a of this.actors){const ids=this.intents(a);desired.set(a.id,ids);for(const id of this.resources.items.keys())if(!ids.includes(id))this.resources.release(id,a.id,this.time);for(const id of ids)this.resources.request(id,a.id,this.policy==='priority'?(a.task?.priority||0):0,a.task?.createdAt||0);}
      this.resources.grant(this.time);
      const blocked=new Map();for(const a of this.actors){const ids=desired.get(a.id)||[],missing=ids.find(id=>!this.resources.owns(id,a.id));let reason=missing?'等待 '+this.resources.items.get(missing).name:'';
        if(!reason&&a.aircraftType!=='uav'&&a.status==='FLYING'&&!a.departDone){a.departUntil??=this.time+a.profile.departure;reason='离场放行 '+Math.max(0,a.departUntil-this.time).toFixed(1)+'s';}
        if(!reason&&a.airspaceHold)reason=a.airspaceHold;blocked.set(a.id,reason);
      }
      const traffic=this.priorityTraffic?PriorityTraffic.plan(this.actors,blocked,this.policy):null;
      const emergencyFlights=this.actors.filter(a=>a.aircraftType==='helicopter'&&a.task?.emergency&&a.status==='FLYING'&&a.departDone&&(desired.get(a.id)||[]).every(id=>this.resources.owns(id,a.id)));
      for(const a of this.actors){if(!a.sim)continue;let reason='',ids=desired.get(a.id)||[];
        const missing=ids.find(id=>!this.resources.owns(id,a.id));if(missing)reason='等待 '+this.resources.items.get(missing).name;
        else if(a.aircraftType!=='uav'&&a.status==='FLYING'&&!a.departDone){a.departUntil??=this.time+a.profile.departure;reason='离场放行 '+Math.max(0,a.departUntil-this.time).toFixed(1)+'s';}
        if(!reason&&a.airspaceHold)reason=a.airspaceHold;if(!reason&&traffic)reason=traffic.get(a.id)?.reason||'';else if(!reason&&!this.priorityTraffic&&a.status==='FLYING'&&!a.task?.emergency&&!a.sim.returning){const next=a.sim.futurePosition(4);const conflict=emergencyFlights.find(h=>h!==a&&!h.sim.returning&&W.minRelativeDistance(a.position,next,h.position,h.sim.futurePosition(4))*25<160);if(conflict)reason='让行应急直升机 '+conflict.id;}
        const holdKey=reason.startsWith('离场放行')?'离场放行':reason;if(holdKey!==(a.holdKey||'')){if(reason)this.log('WARN','运行管制',a.id+' '+reason);else if(a.holdKey)this.log('INFO','解除运行管制',a.id+' 继续航段');if(reason.includes('让行'))this.mixedStats.yieldEvents++;a.holdKey=holdKey;}a.holdReason=reason;
        a.sim.trafficHold=reason;
        if(a.status==='FLYING'&&reason){if(reason.includes('让行')){a.yieldTime+=dt;this.mixedStats.yieldSeconds+=dt;}else{a.resourceWait+=dt;this.mixedStats.resourceHoldSeconds+=dt;}}
      }
      const before=new Set(this.completed);super.tick(dt);
      for(const t of this.completed)if(!before.has(t)){if(t.type==='passenger')this.mixedStats.passengerTrips++;if(t.people)this.mixedStats.peopleTransferred+=t.people;}
      for(const a of this.actors)if(!a.task&&!a.verticalState||['DISABLED','CHARGING'].includes(a.verticalState||a.status))this.resources.releaseActor(a.id,this.time);
      if(this.autoEvents&&this.time>=15&&!this.fired.has('evacuation')){this.fired.add('evacuation');this.trigger('evacuation');}
      this.replenishRoutine();
    }
    completeTask(a){super.completeTask(a);this.resources.releaseActor(a.id,this.time);a.holdReason='';a.holdKey='';a.sim.trafficHold='';}
    summary(){return {...super.summary(),composition:'mixed',uavs:this.actors.filter(a=>a.aircraftType==='uav').length,helicopters:2,evtols:2,passenger_trips:this.mixedStats?.passengerTrips||0,people_transferred:this.mixedStats?.peopleTransferred||0,yield_events:this.mixedStats?.yieldEvents||0,resource_hold_s:+(this.mixedStats?.resourceHoldSeconds||0).toFixed(2),yield_s:+(this.mixedStats?.yieldSeconds||0).toFixed(2)};}
    export(){const data=super.export();return {...data,schema:'lowair-mixed/v1',profiles,...(this.continuousOperations?{liveOperations:{continuous:true,priorityTraffic:this.priorityTraffic,routineStats:this.routineStats}}:{}),assumptions:'异构速度、容量、能源代理与固定飞层；起降场作业计时，跨江大型航空器航路单容量；固定基准使用4秒水平预测与160米应急保护；持续运营使用5秒航段预测、任务优先级与高度间隔，非完整三维航路预约。合成任务，无真实乘客、起降动力学或许可航路。',mixedStats:{...this.mixedStats},decisions:this.decisionHistory||[],resources:this.resources.snapshot(),resourceHistory:this.resources.history,pads:this.pads,actors:data.actors.map(a=>{const source=this.actors.find(s=>s.id===a.id);return {...a,aircraftType:source.aircraftType,profile:source.profile,holdReason:source.holdReason||'',resourceWait:source.resourceWait,yieldTime:source.yieldTime};})};}
  }
  return {MixedOperations,Resources,profiles,names};
});
