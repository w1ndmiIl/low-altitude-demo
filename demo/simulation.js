(function(root,factory){
  const api=typeof module==='object'&&module.exports?factory(require('./planner.js'),require('./world.js'),require('./safety.js'),require('./adaptive-planning.js')):factory(root.LowAirPlanner,root.LowAirWorld,root.LowAirSafety,root.LowAirAdaptive);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.LowAirSimulation=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(P,W,S,A){
  'use strict';
  const C=W.CONFIG;
  const terminal=new Set(['DELIVERED','RETURNED','LANDED','COLLISION']);
  const labels={READY:'待起飞',FLYING:'执行航段',TRAFFIC_HOLD:'运行管制等待',RETURNING:'安全返航',COMM_HOLD:'失联悬停',NAV_HOLD:'导航异常悬停',AVOID_HOLD:'避障等待',BLOCKED:'无可行航路',DELIVERED:'配送完成',RETURNED:'返航完成',LANDED:'紧急降落',COLLISION:'安全间隔失守'};
  class Simulation {
    constructor({scenario='static',algorithm='risk',groundWeight=3,linkWeight=2,seed=42,environment='teaching',externalClock=false,energyPerMeter=.018,energyPerSecond=.08,world=null,deferPlanning=false}={}) {
      this.options={scenario,algorithm,groundWeight,linkWeight,seed,environment,externalClock,energyPerMeter,energyPerSecond};this.world=world||new W.World(scenario,environment);this.config=this.world.config;const C=this.config;
      this.pos={...this.world.start};this.route=[];this.initialRoute=[];this.index=1;this.trace=[{...this.pos}];this.telemetry=[];this.events=[];
      this.state='READY';this.active=false;this.returning=false;this.time=0;this.battery=100;this.link=new S.HeartbeatLink(seed);
      this.distance=0;this.groundExposure=0;this.linkExposure=0;this.minClearance=Infinity;this.replans=0;this.predictionReplans=0;this.safetyStops=0;this.holdTime=0;this.collisions=0;
      this.planMs=0;this.expanded=0;this.lastPlan=-Infinity;this.knownRevision=-1;this.scriptFired=false;this.initialLength=0;this.finalLength=0;this.lastSample=0;
      this.eventSchedule=new Set();this.weather={speedFactor:1,windX:0,windY:0,until:0};this.navLostUntil=0;this.incidents=0;
      this.log('INFO','任务就绪',`${algorithm==='risk'?'风险感知 A*':'最短路径 A*'}；固定高度 ${C.altitude} m，地图为合成场景。`);
      if(!deferPlanning)this.plan('初始规划',false);
    }
    log(level,title,detail='') { this.events.push({t:Number(this.time.toFixed(2)),level,title,detail}); }
    weights() { return this.options.algorithm==='risk'?{ground:this.options.groundWeight,link:this.options.linkWeight}:{ground:0,link:0}; }
    usePlanningBackend(backend,slot=0){this.planBackend=backend;this.options.replanMode='adaptive-worker';this.planEpoch=(this.planEpoch||0)+1;this.pendingPlanner=null;this.planningStats={requests:0,accepted:0,skipped:0,rejected:0,stale:0,failed:0};this.requestTimes={};this.nextReview=this.time+(slot%10)*.1;this.knownGeometry=this.world.geometryRevision||0;this.routeIntent=this.intent();this.captureRouteRisk();return this;}
    intent(){const goal=this.returning?this.world.start:this.world.goal;return (this.returning?'return':'mission')+':'+goal.x+':'+goal.y;}
    planningKey(){return [this.world.geometryRevision||0,this.intent(),this.pos.x,this.pos.y].join(':');}
    cancelPlanning(){this.planEpoch=(this.planEpoch||0)+1;this.pendingPlanner=null;}
    captureRouteRisk(){this.routeRisk=this.route.map(p=>this.world.risk(p.x,p.y));}
    routeGeometryClear(){const path=[this.pos,...this.route.slice(this.index)];return path.length>1&&path.slice(1).every((p,i)=>this.world.segmentClear(path[i],p));}
    requestPlan(reason,count=true,kind='geometry'){
      const priorities={return:120,initial:60,geometry:110,dynamic:105,navigation:100,risk:20};
      if(this.failedPlanningKey===this.planningKey()&&!this.world.sensedIntruders(this.pos,this.time).length)return this.route.length>0;
      const intent=this.intent();if(this.pendingPlanner&&this.pendingPlanner.intent===intent&&priorities[this.pendingPlanner.kind]>=priorities[kind])return this.route.length>0;
      const epoch=++this.planEpoch;this.pendingPlanner={epoch,kind,reason,intent};this.requestTimes[kind]=this.time;this.lastPlan=this.time;this.planningStats.requests++;
      this.planBackend.request(()=>{if(epoch!==this.planEpoch||terminal.has(this.state)||intent!==this.intent())return null;const w=this.world,predicted=[];for(const o of w.sensedIntruders(this.pos,this.time))for(let t=0;t<=this.config.predictionSeconds+.01;t+=.2)predicted.push(w.intruderAt(o,this.time+t));return {source:w.planningSource||w,pos:{...this.pos},goal:{...(this.returning?w.start:w.goal)},config:{...this.config},weights:this.weights(),predicted,geometryRevision:w.geometryRevision||0};},priorities[kind]).then(message=>{
        if(epoch!==this.planEpoch)return;if(message.cancelled||terminal.has(this.state)||intent!==this.intent()){this.pendingPlanner=null;this.planningStats.stale++;return;}
        this.pendingPlanner=null;this.planMs=message.computeMs;this.expanded=message.result.expanded;const path=message.result.path,route=A.reconnect(this.pos,path,this.world);
        if(!route.length){const staleGeometry=message.geometryRevision!=null&&message.geometryRevision!==(this.world.geometryRevision||0),staleOrigin=message.origin&&W.distance(message.origin,this.pos)>1e-5;if(staleGeometry||staleOrigin){this.planningStats.stale++;this.lastPlan=-Infinity;this.requestTimes.geometry=-Infinity;this.nextReview=this.time;this.retryAt=this.time;return;}this.planningStats.rejected++;this.retryAt=this.time+2;if(!path.length&&!this.world.sensedIntruders(this.pos,this.time).length)this.failedPlanningKey=this.planningKey();return;}
        const old=[this.pos,...this.route.slice(this.index)],oldSafe=this.routeGeometryClear(),same=old.length===route.length&&old.every((p,i)=>W.distance(p,route[i])<1e-5);
        if(kind==='risk'&&oldSafe&&A.routeCost(route,this.world,this.weights())>=A.routeCost(old,this.world,this.weights())*.88){this.planningStats.rejected++;this.captureRouteRisk();return;}
        const changed=!same||this.routeIntent!==intent;
        this.route=route;this.index=1;if(changed)this.routeVersion=(this.routeVersion||0)+1;this.routeIntent=intent;this.failedPlanningKey=null;this.finalLength=P.pathLength(route)*this.config.cellMeters;this.knownRevision=this.world.revision;this.knownGeometry=this.world.geometryRevision||0;this.routeUnsafe=false;this.captureRouteRisk();
        if(!this.initialRoute.length){this.initialRoute=route.map(p=>({...p}));this.initialLength=this.finalLength;}
        if(['BLOCKED','AVOID_HOLD'].includes(this.state)&&this.time>=this.navLostUntil&&this.time-this.link.lastReceived<this.config.holdSeconds&&!this.predictedThreat(.4))this.state=this.returning?'RETURNING':this.time===0&&!this.active?'READY':'FLYING';
        if(changed&&count){this.replans++;this.planningStats.accepted++;this.log('INFO',reason,`后台完成，采用新航路 ${this.finalLength.toFixed(1)} m；从当前位置连续接入。`);}else if(!changed)this.planningStats.skipped++;
      }).catch(error=>{if(epoch!==this.planEpoch)return;this.pendingPlanner=null;this.planningStats.failed++;this.retryAt=this.time+3;if(this.planningStats.failed===1)this.log('WARN','后台航路计算不可用',error.message+'；继续安全航段，等待恢复。');});
      return this.route.length>0;
    }
    adaptiveReview(){
      const geometry=this.world.geometryRevision||0,changed=geometry!==this.knownGeometry;if(changed){this.knownGeometry=geometry;this.routeUnsafe=!this.routeGeometryClear();if(!this.routeUnsafe)this.planningStats.skipped++;}
      if(!changed&&this.time<this.nextReview)return;this.nextReview=this.time+1;
      this.knownRevision=this.world.revision;
      if(this.routeUnsafe){if(this.time>=(this.retryAt||0)&&this.time-(this.requestTimes.geometry??-Infinity)>=.8)this.requestPlan('障碍影响当前航路，局部改线',true,'geometry');return;}
      if(!this.route.length||this.pendingPlanner||this.returning||this.time-(this.requestTimes.risk??-Infinity)<12)return;
      const weights=this.weights();if(!weights.ground&&!weights.link)return;let length=0,increase=0,peak=0,samples=0,last=this.pos;
      for(let i=this.index;i<this.route.length;i++){const p=this.route[i];length+=W.distance(last,p)*this.config.cellMeters;if(length>Math.max(300,this.config.speed*this.config.cellMeters*12))break;last=p;const current=this.world.risk(p.x,p.y),base=this.routeRisk[i]||current,delta=weights.ground*(current.ground-base.ground)+weights.link*(current.link-base.link);increase+=Math.max(0,delta);peak=Math.max(peak,delta);samples++;}
      if(samples&&peak>.35&&increase/samples>.1)this.requestPlan('前方航段风险明显上升，后台择优',true,'risk');
    }
    advanceAdaptive(dt,oldTime,relevant){let remaining=dt,elapsed=0,blocked=false;const pieces=[],speed=this.config.speed*this.weather.speedFactor;
      while(remaining>1e-9&&this.index<this.route.length){const before={...this.pos},target=this.route[this.index],length=W.distance(before,target);if(length<1e-8){this.index++;continue;}const duration=Math.min(remaining,length/speed),travel=speed*duration,t0=oldTime+elapsed,t1=t0+duration;let candidate={x:before.x+(target.x-before.x)*travel/length+this.weather.windX*duration,y:before.y+(target.y-before.y)*travel/length+this.weather.windY*duration};if(!this.weather.until&&travel>=length-1e-9)candidate={...target};
        if(!this.world.segmentClear(before,candidate)||!relevant.every(o=>W.minRelativeDistance(before,candidate,this.world.intruderAt(o,t0),this.world.intruderAt(o,t1))>o.radius+this.config.safetyRadius)){blocked=true;break;}
        this.pos=candidate;this.distance+=W.distance(before,candidate)*this.config.cellMeters;pieces.push({a:before,b:candidate,t0,t1});elapsed+=duration;remaining-=duration;
        if(!this.weather.until&&travel>=length-1e-9||this.weather.until&&W.distance(candidate,target)<Math.min(.035,.1/this.config.cellMeters))this.index++;
      }
      if(remaining>1e-9)pieces.push({a:{...this.pos},b:{...this.pos},t0:oldTime+elapsed,t1:oldTime+dt});return {pieces,blocked,remaining};
    }
    plan(reason,count=true) {
      if(this.planBackend){const kind=reason.includes('返航')?'return':/初始|任务|重新搜索/.test(reason)?'initial':/预测|碰撞|避障/.test(reason)?'dynamic':reason.includes('导航')?'navigation':this.world.lastChange==='risk'?'risk':'geometry';return this.requestPlan(reason,count,kind);}
      const C=this.config;
      const t0=performance.now(),w=this.world,predicted=w.predictedBlocker(this.pos,this.time),goal=this.returning?w.start:w.goal;
      const blocked=(x,y)=>w.planningBlocked(x,y)||predicted(x,y);
      // 连续位置接入离散网格，先检查接入线段，避免重规划时跳位置。
      const candidates=[];
      for(let y=Math.round(this.pos.y)-2;y<=Math.round(this.pos.y)+2;y++)for(let x=Math.round(this.pos.x)-2;x<=Math.round(this.pos.x)+2;x++) {
        const p={x,y};if(w.inside(x,y)&&!blocked(x,y)&&w.segmentClear(this.pos,p))candidates.push(p);
      }
      candidates.sort((a,b)=>W.distance(a,this.pos)-W.distance(b,this.pos));
      let result={path:[],expanded:0,cost:Infinity};
      for(const start of candidates) {
        result=P.astar({width:w.width,height:w.height,start,goal,blocked,risk:(x,y)=>w.planningRisk(x,y),weights:this.weights()});
        if(result.path.length)break;
      }
      this.route=result.path.length?[{...this.pos},...result.path.filter(p=>W.distance(p,this.pos)>1e-6)]:[];
      this.index=1;this.routeVersion=(this.routeVersion||0)+1;this.knownRevision=w.revision;this.lastPlan=this.time;this.planMs=performance.now()-t0;this.expanded=result.expanded;
      this.finalLength=P.pathLength(this.route)*C.cellMeters;
      if(count)this.replans++;
      if(!this.initialRoute.length&&this.route.length) {this.initialRoute=this.route.map(p=>({...p}));this.initialLength=this.finalLength;}
      if(!this.route.length) {this.state='BLOCKED';this.log('WARN','无可行航路','保持当前位置，等待地图更新或障碍离开。');}
      else {this.log('INFO',reason,`剩余航路 ${this.finalLength.toFixed(1)} m，展开 ${result.expanded} 个节点。`);}
      return this.route.length>0;
    }
    start() {
      if(terminal.has(this.state))return false;
      if(this.time===0&&!this.options.externalClock){this.world.traffic.time=0;this.world.traffic.reset(this.world.geo?96:42);}
      if(!this.route.length)this.plan('重新搜索',false);
      if(!this.route.length&&this.time===0){this.state='BLOCKED';this.active=false;this.log('WARN','起飞检查未通过','起点到终点无可行航路，拒绝起飞。编辑地图后可以重新尝试。');return false;}
      this.active=true;
      this.state=this.route.length?(this.returning?'RETURNING':'FLYING'):'BLOCKED';
      this.log('INFO','仿真开始','导航位置、风险场和障碍物均由仿真器提供。');return true;
    }
    togglePause() { if(!this.active)return this.start();this.active=false;this.log('INFO','仿真暂停');return false; }
    forceDisconnect(value=true) { this.link.forced=value;this.log(value?'WARN':'INFO',value?'通信中断注入':'通信恢复注入','机载规划仍可执行，心跳链路单独受控。'); }
    forceLowBattery() {this.battery=19;this.log('WARN','低电量故障注入','电量设置为 19%，返航阈值为 20%。');}
    injectEvent(type) {
      const C=this.config;
      if(type==='tunnel'&&this.world.geo){this.world.traffic.closedTunnel=!this.world.traffic.closedTunnel;this.incidents++;this.log('WARN',this.world.traffic.closedTunnel?'隧道入口封闭':'隧道入口恢复','地面车辆在入口排队，地下车辆继续驶出；交通风险场下一次更新时反映排队。');return true;}
      if(type==='gust'){this.weather={speedFactor:.60,windX:.16,windY:.08,until:this.time+10};this.incidents++;this.log('WARN','阵风进入飞行区','持续 10 s，简化模型降低巡航推进速度并加入水平漂移。');return true;}
      if(type==='gps'){this.navLostUntil=this.time+6;this.incidents++;this.log('WARN','导航信号异常','暂停水平飞行，6 s 后恢复导航。仿真真值继续用于安全监测。');return true;}
      const center=this.route.slice(this.index).find(p=>W.distance(p,this.pos)>=(this.world.geo&&type==='birds'?1.4:Math.max(3,35/C.cellMeters))&&W.distance(p,this.world.goal)>=2&&W.distance(p,this.world.start)>=2);
      if(!center){this.log('WARN','事件注入未执行','航路剩余空间不足，请重置后更早注入。');return false;}
      if(type==='nofly'){this.world.circle(Math.round(center.x),Math.round(center.y),2.0,2);this.incidents++;this.log('WARN','临时禁飞通知',`在 (${Math.round(center.x)}, ${Math.round(center.y)}) 周围新增禁飞区，重新选择航路。`);return true;}
      if(type==='birds'){
        const next=this.route[Math.min(this.route.length-1,this.index+3)]||this.world.goal,dx=next.x-this.pos.x,dy=next.y-this.pos.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
        for(let i=0;i<3;i++){const spread=this.world.geo?.16:.8,span=this.world.geo?2.5:5,shift=(i-1)*spread,a={x:W.clamp(center.x+nx*span+dx/len*shift,.2,this.world.width-1.2),y:W.clamp(center.y+ny*span+dy/len*shift,.2,this.world.height-1.2)},b={x:W.clamp(center.x-nx*span+dx/len*shift,.2,this.world.width-1.2),y:W.clamp(center.y-ny*span+dy/len*shift,.2,this.world.height-1.2)};this.world.intruders.push({id:`bird-${this.time}-${i}`,type:'bird',name:`鸟群 ${i+1}`,altitude:C.altitude,a,b,speed:this.world.geo?(17+i*1.5)/C.cellMeters:1.7+i*.15,radius:this.world.geo?1.5/C.cellMeters:.35,born:this.time,expires:this.time+14});}
        this.incidents++;this.world.revision++;this.log('WARN','鸟群进入航路','3 只鸟从侧面穿越，纳入有限感知、预测避障与连续安全间隔检查。');return true;
      }
      return false;
    }
    addRouteObstacle() {
      const p=this.route.slice(this.index).find(p=>W.distance(p,this.pos)>=5&&W.distance(p,this.world.goal)>=4&&W.distance(p,this.world.start)>=4);
      if(!p){this.log('WARN','障碍注入未执行','当前航路没有足够远的安全注入位置。');return false;}
      const cx=Math.round(p.x),cy=Math.round(p.y);this.world.rect(cx-1,cy-1,3,3,3);
      this.log('WARN','临时障碍出现',`(${cx}, ${cy}) 附近加入 3 × 3 格临时障碍，检验航路更新。`);return true;
    }
    edit(x,y,type) {
      if(!this.world.inside(x,y)||W.distance({x,y},this.pos)<3||W.distance({x,y},this.world.start)<2||W.distance({x,y},this.world.goal)<2)return false;
      if(type==='erase'&&this.world.geo&&this.world.originalCells[y*this.world.width+x])return false;
      if(type==='crowd'){this.world.crowds.push({x,y,rx:4,ry:4,amplitude:0.8});this.world.revision++;}
      else this.world.set(x,y,type==='erase'?0:type==='nofly'?2:this.world.geo?5:1);
      this.log('INFO','地图编辑',`(${x}, ${y}) 更新，地图版本 ${this.world.revision}。`);
      if(!this.active)this.plan('地图更新后规划',this.time>0);
      return true;
    }
    futurePosition(seconds) {
      const C=this.config;
      let remaining=seconds*C.speed*this.weather.speedFactor,p={...this.pos};
      for(let i=this.index;i<this.route.length;i++) {const q=this.route[i],d=W.distance(p,q);if(d>=remaining&&d>1e-9)return {x:p.x+(q.x-p.x)*remaining/d,y:p.y+(q.y-p.y)*remaining/d};remaining-=d;p=q;}
      return p;
    }
    predictedThreat(seconds=this.config.predictionSeconds) {
      const C=this.config;
      const objects=this.world.sensedIntruders(this.pos,this.time);
      for(const o of objects) {
        let own0=this.pos,other0=this.world.intruderAt(o,this.time);
        for(let dt=0.2;dt<=seconds+1e-9;dt+=0.2) {
          const own1=this.futurePosition(dt),other1=this.world.intruderAt(o,this.time+dt);
          if(W.minRelativeDistance(own0,own1,other0,other1)<o.radius+C.safetyRadius+0.55)return true;
          own0=own1;other0=other1;
        }
      }
      return false;
    }
    step(seconds) {
      if(!Number.isFinite(seconds)||seconds<0)throw new Error('Invalid time step');
      // 固定时间步进确保速度倍率不影响判定，避免一帧越过障碍。
      while(seconds>1e-9&&this.active&&!terminal.has(this.state)) {const dt=Math.min(seconds,0.05);this.tick(dt);seconds-=dt;}
    }
    tick(dt) {
      const C=this.config;
      const oldTime=this.time;this.time+=dt;
      this.world.intruders=this.world.intruders.filter(o=>!o.expires||o.expires>this.time);
      if(this.options.scenario==='emergency')for(const [at,type] of [[5,'birds'],[10,'gust'],[14,'nofly']])if(this.time>=at&&!this.eventSchedule.has(type)){this.eventSchedule.add(type);this.injectEvent(type);}
      if(this.weather.until&&this.time>=this.weather.until){this.weather={speedFactor:1,windX:0,windY:0,until:0};this.log('INFO','阵风结束','恢复正常巡航速度。');}
      if(!this.options.externalClock)this.world.traffic.step(dt);
      if(this.options.scenario==='traffic'&&!this.scriptFired&&this.time>=8){this.scriptFired=true;this.world.traffic.congested=true;this.log('WARN','中心道路拥堵注入','中部东西向路段限速，排队车辆会增加局部地面风险。');}
      if(this.options.scenario==='traffic'&&this.time-this.world.trafficSnapshotTime>=3){this.world.traffic.snapshot();this.world.trafficSnapshotTime=this.time;this.world.revision++;this.world.lastChange='risk';this.log('INFO','实时交通风险更新','每 3 秒由车辆位置与排队状态生成风险快照，用于下一次航路规划。');}
      if(!this.scriptFired&&this.options.scenario==='dynamic'&&this.time>=6){this.scriptFired=true;this.addRouteObstacle();}
      if(!this.scriptFired&&this.options.scenario==='link'&&this.time>=8){this.scriptFired=true;this.forceDisconnect(true);}
      if(!this.scriptFired&&this.options.scenario==='battery'&&this.time>=8){this.scriptFired=true;this.forceLowBattery();}
      const risk=this.world.risk(this.pos.x,this.pos.y),age=this.link.tick(this.time,risk.link);
      const decision=S.decision({battery:this.battery,age,returning:this.returning},C);
      if(decision==='LAND') {this.state='LANDED';this.active=false;this.log('ERROR','电量耗尽，紧急降落','在当前位置停止水平运动，未模拟垂直动力学。');return;}
      const navLost=this.time<this.navLostUntil;
      if(decision==='RETURN'&&!this.returning&&!navLost) {
        this.returning=true;this.log('WARN','触发安全返航',this.battery<=C.lowBattery?'电量达到返航阈值。':'连续心跳超时达到 4 s。');this.plan('返航航路规划');
      }
      let hold=decision==='HOLD'||navLost;
      if(hold) {const state=navLost?'NAV_HOLD':'COMM_HOLD';if(this.state!==state){this.log('WARN',navLost?'导航异常，悬停':'通信失联，悬停',navLost?'等待导航恢复，安全监测继续使用仿真真值。':'连续心跳超时达到 1.5 s，等待恢复。');this.safetyStops++;}this.state=state;}
      else if(this.trafficHold) {hold=true;this.state='TRAFFIC_HOLD';}
      else {
        if(this.state==='NAV_HOLD'){this.log('INFO','导航信号恢复');if(!this.planBackend)this.plan('导航恢复后重规划');else if(!this.routeGeometryClear())this.requestPlan('导航恢复后检查受阻航段',true,'geometry');}
        if(this.state==='COMM_HOLD')this.log('INFO','心跳恢复，继续任务');
        if(this.planBackend)this.adaptiveReview();else if(this.world.revision!==this.knownRevision){const weights=this.weights(),kind=this.world.lastRisk||'ground',irrelevant=this.world.lastChange==='risk'&&(kind==='link'?weights.link===0:weights.ground===0);if(irrelevant)this.knownRevision=this.world.revision;else this.plan('环境变化，重新规划');}
        if(!this.route.length&&!this.pendingPlanner&&this.time-this.lastPlan>=(this.planBackend?2:1)&&this.time>=(this.retryAt||0))this.plan('等待后重新搜索');
        if(this.route.length&&this.predictedThreat()) {
          if(this.time-this.lastPlan>=0.8&&(!this.planBackend||!this.pendingPlanner||this.pendingPlanner.kind==='risk')){this.predictionReplans++;this.log('WARN','预测到移动障碍冲突',`预测窗口 ${C.predictionSeconds} s，感知半径 ${C.sensorRadius*C.cellMeters} m。`);this.plan('预测避障重规划');}
          if(!this.planBackend||this.predictedThreat(.4)) {hold=true;if(this.state!=='AVOID_HOLD'){this.safetyStops++;this.log('WARN','避障悬停','紧邻前方航段存在安全冲突，等待可行航段。');}this.state='AVOID_HOLD';}
        }
        if(!this.route.length){hold=true;this.state='BLOCKED';}
        if(!hold)this.state=this.returning?'RETURNING':'FLYING';
      }
      const before={...this.pos};let motionPieces=null,partialHold=0;
      const relevant=this.world.relevantIntruders();
      if(!hold&&this.index<this.route.length&&this.planBackend){const movement=this.advanceAdaptive(dt,oldTime,relevant);motionPieces=movement.pieces;if(movement.blocked){hold=true;partialHold=movement.remaining;this.state='AVOID_HOLD';this.safetyStops++;if(this.time-this.lastPlan>=.8)this.requestPlan('安全前缀结束，后台搜索绕行',true,'geometry');}}
      else if(!hold&&this.index<this.route.length) {
        const target=this.route[this.index],length=W.distance(before,target),travel=Math.min(C.speed*this.weather.speedFactor*dt,length);
        const candidate=length>1e-9?{x:before.x+(target.x-before.x)*travel/length+this.weather.windX*dt,y:before.y+(target.y-before.y)*travel/length+this.weather.windY*dt}:{...target};
        const dynamicSafe=relevant.every(o=>W.minRelativeDistance(before,candidate,this.world.intruderAt(o,oldTime),this.world.intruderAt(o,this.time))>o.radius+C.safetyRadius);
        if(!this.world.segmentClear(before,candidate)||!dynamicSafe){hold=true;this.state='AVOID_HOLD';this.safetyStops++;if(this.time-this.lastPlan>=0.8)this.plan('连续碰撞检查拦截后重规划');}
        else {this.pos=candidate;this.distance+=W.distance(before,candidate)*C.cellMeters;if((this.weather.until&&W.distance(candidate,target)<Math.min(.035,.1/C.cellMeters))||(travel>=length-1e-9&&!this.weather.until))this.index++;}
      }
      if(hold)this.holdTime+=partialHold||dt;
      const stepDistance=motionPieces?motionPieces.reduce((s,p)=>s+W.distance(p.a,p.b)*C.cellMeters,0):W.distance(before,this.pos)*C.cellMeters;
      this.battery=Math.max(0,this.battery-dt*this.options.energyPerSecond-stepDistance*this.options.energyPerMeter);
      this.groundExposure+=risk.ground*dt;this.linkExposure+=risk.link*dt;
      this.minClearance=Math.min(this.minClearance,this.world.closestClearance(this.pos,this.time));
      const collision=motionPieces?motionPieces.some(p=>!this.world.segmentClear(p.a,p.b)||relevant.some(o=>W.minRelativeDistance(p.a,p.b,this.world.intruderAt(o,p.t0),this.world.intruderAt(o,p.t1))<o.radius+C.safetyRadius-1e-8)):!this.world.segmentClear(before,this.pos)||relevant.some(o=>W.minRelativeDistance(before,this.pos,this.world.intruderAt(o,oldTime),this.world.intruderAt(o,this.time))<o.radius+C.safetyRadius-1e-8);
      if(collision) {this.collisions++;this.state='COLLISION';this.active=false;this.log('ERROR','安全间隔失守','该场景发生碰撞或安全半径重叠，停止仿真并记录失败。');return;}
      const atGoal=!this.planBackend||W.distance(this.pos,this.returning?this.world.start:this.world.goal)<(this.weather.until?Math.min(.035,.1/C.cellMeters):1e-5);
      if(this.route.length&&this.index>=this.route.length&&!hold&&atGoal) {
        this.state=this.returning?'RETURNED':'DELIVERED';this.active=false;if(this.planBackend)this.cancelPlanning();this.log('INFO',this.returning?'返航完成':'配送完成',`累计航程 ${this.distance.toFixed(1)} m，用时 ${this.time.toFixed(1)} s。`);
      }
      else if(this.planBackend&&this.index>=this.route.length&&!atGoal){this.state='BLOCKED';if(!this.pendingPlanner&&this.time>=(this.retryAt||0)&&this.time-this.lastPlan>=2)this.plan('航段接入等待后重新搜索');}
      if(this.time-this.lastSample>=0.2||terminal.has(this.state)) {
        this.lastSample=this.time;this.trace.push({...this.pos});this.telemetry.push({t:+this.time.toFixed(2),x:+this.pos.x.toFixed(3),y:+this.pos.y.toFixed(3),battery:+this.battery.toFixed(2),state:this.state,groundRisk:+risk.ground.toFixed(3),linkQuality:+this.link.quality.toFixed(3)});
      }
    }
    summary() {
      return {scenario:this.options.scenario,algorithm:this.options.algorithm,state:this.state,time_s:+this.time.toFixed(2),distance_m:+this.distance.toFixed(2),initial_path_m:+this.initialLength.toFixed(2),ground_exposure_s:+this.groundExposure.toFixed(3),link_exposure_s:+this.linkExposure.toFixed(3),min_clearance_m:Number.isFinite(this.minClearance)?+this.minClearance.toFixed(3):null,replans:this.replans,prediction_replans:this.predictionReplans,hold_s:+this.holdTime.toFixed(2),safety_stops:this.safetyStops,collisions:this.collisions,battery_percent:+this.battery.toFixed(2),packets_sent:this.link.sent,packets_received:this.link.received,packet_loss_percent:+(100*this.link.lossRate()).toFixed(1),...(this.planBackend?{planning_mode:'adaptive-worker',planning_requests:this.planningStats.requests,planning_accepted:this.planningStats.accepted,planning_rejected:this.planningStats.rejected,planning_pending:!!this.pendingPlanner}:{})};
    }
    export() {return {schema:'lowair-demo/v2',assumptions:'公开地图或教学地图、固定高度、运动学飞行、理想导航、合成风险场、有限半径理想感知、确定性伪随机心跳链路。',config:this.config,options:this.options,world:{cells:Array.from(this.world.cells),start:this.world.start,goal:this.world.goal,crowds:this.world.crowds,weakZones:this.world.weakZones,intruders:this.world.intruders,geographicSource:this.world.geo?{source:this.world.geo.source,sourceSha256:this.world.geo.sourceSha256,origin:this.world.geo.origin}:null,traffic:this.world.traffic.summary()},summary:this.summary(),events:this.events,telemetry:this.telemetry};}
  }
  function runExperiment(options={},maxSeconds=480) {
    const sim=new Simulation(options);sim.start();
    while(sim.active&&sim.time<maxSeconds-1e-9)sim.step(Math.min(0.05,maxSeconds-sim.time));
    const result=sim.summary();if(sim.active)result.state='TIMEOUT';return {result,sim};
  }
  function benchmark({scenarios=['static','dynamic','link','battery','blocked','traffic','emergency'],groundWeight=3,linkWeight=2,seeds=[42],environment='teaching'}={}) {
    const rows=[];
    for(const scenario of scenarios)for(const seed of seeds)for(const algorithm of ['distance','risk'])rows.push({...runExperiment({scenario,seed,algorithm,groundWeight,linkWeight,environment}).result,seed});
    return rows;
  }
  return {Simulation,runExperiment,benchmark,labels,terminal};
});
