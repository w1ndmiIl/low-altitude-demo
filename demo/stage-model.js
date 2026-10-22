(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LowAirStage=api;})(globalThis,function(){
  'use strict';
  const names={fire:'楼宇火情',rescue:'物资救援',medical:'跨江急送',relay:'通信中继',evacuation:'直升机人员转运'};
  function selected(ops,sim){
    const actor=ops?.selected,task=actor?.task,active=ops?ops.active:sim.active,time=ops?ops.time:sim.time;
    let phase='待执行',stage='';
    if(actor){
      if(actor.status==='IDLE')phase=actor.onGround?(actor.emergencyReserve?'消防地面待命':'站点待命'):actor.missionCount?'任务完成，等待新单':'待命';
      else if(actor.status==='CHARGING_SERVICE')phase='地面补能 '+Math.max(0,actor.chargeUntil-time).toFixed(0)+'s / 交接未完成';
      else if(actor.status==='CHARGING')phase='模拟补能 '+Math.max(0,actor.chargeUntil-time).toFixed(0)+'s';
      else if(actor.status==='DISABLED')phase='安全停止';
      else if(actor.status==='TAKEOFF')phase=actor.holdReason||'垂直起飞 '+actor.altitude.toFixed(1)+' / '+actor.cruiseAltitude+'m';
      else if(actor.status==='CLIMB')phase='爬升至巡航 '+actor.altitude.toFixed(1)+' / '+actor.cruiseAltitude+'m';
      else if(actor.status==='LANDING')phase=actor.holdReason||'下降 '+actor.altitude.toFixed(1)+' / '+actor.targetAltitude.toFixed(1)+'m';
      else if(actor.status==='HOLD_LANDING')phase=actor.holdReason||'等待空闲降落位';
      else if(actor.status==='SERVICING'){const fire=task?.type==='fire'&&ops.incidents.find(i=>i.id===task.incidentId);phase=actor.serviceHold?'服务暂停：'+actor.serviceHold:(fire?.firePhase==='RECON'?'火场侦察':fire?.firePhase==='SUPPRESS'?'消防投放':actor.onGround?(task.stage===0&&task.waypoints.length>1?(actor.currentSite?.location==='rooftop'?'楼顶装载':'地面装载'):'落地交接'):'现场服务')+' '+Math.max(0,actor.serviceUntil-time).toFixed(1)+'s';}
      else if(sim.state==='COMM_HOLD')phase=(sim.returning?'返航中 · ':'')+'心跳超时，悬停';
      else if(sim.state==='NAV_HOLD')phase=(sim.returning?'返航中 · ':'')+'导航异常，悬停';
      else if(sim.returning)phase=actor.recovering?'任务完成，返场':'安全返航';
      else if(sim.pendingPlanner&&!sim.route.length)phase='后台准备航路';
      else if(sim.state==='AVOID_HOLD'||sim.state==='BLOCKED')phase='等待可行航路';
      else if(actor.holdReason)phase=actor.holdReason;
      else if(task)phase=task.people?(task.stage<task.waypoints.length-1?'前往接运点':'载客转运中'):task.stage<task.waypoints.length-1?'前往取件 / 访问点':'前往最终任务点';
      if(task)stage='阶段 '+(task.stage+1)+' / '+task.waypoints.length;
      if(actor.currentSite?.location==='rooftop'&&actor.onGround)phase+=' · 楼顶'+actor.currentSite.elevation+'m';
      if(sim.pendingPlanner&&sim.route.length&&!sim.returning&&!actor.holdReason&&!['COMM_HOLD','NAV_HOLD','AVOID_HOLD','BLOCKED'].includes(sim.state)&&actor.status==='FLYING')phase+=' · 后台规划';
    }else{phase={READY:'待起飞',FLYING:'沿航路飞行',DELIVERED:'配送完成',RETURNED:'安全返航完成',RETURNING:'安全返航',COMM_HOLD:'心跳超时，悬停',NAV_HOLD:'导航异常，悬停',AVOID_HOLD:'避障等待',BLOCKED:'无可行航路',COLLISION:'安全停止',LANDED:'电量耗尽停止'}[sim.state]||sim.state;}
    return {phase,stage,paused:!active,time,actorId:actor?.id||null};
  }
  function incident(ops,id){
    const item=ops?.incidents.find(i=>i.id===id);if(!item)return null;
    const task=ops.tasks.find(t=>t.incidentId===id),actor=ops.actors.find(a=>a.task?.incidentId===id),stopped=['ABORTED','FAILED'].includes(item.status),resolved=!stopped&&item.resolvedAt!=null&&(!item.crossRiver||item.airDeliveryCompleted&&item.groundArrivedAt!=null&&(!item.localDelivery||item.handoffCompletedAt!=null&&item.groundDeliveredAt!=null)),end=resolved?item.resolvedAt:stopped?(item.endedAt??item.abortedAt??item.failedAt??ops.time):ops.time,elapsed=Math.max(0,end-item.createdAt);
    const statusLabel=item.status==='ABORTED'?'任务已中止':item.status==='FAILED'?'安全停止':'';
    let summary=stopped?statusLabel+'，未记为完成。'+(item.reason||''):resolved?'任务服务完成。':!actor?'已进入应急队列，等待满足约束的飞机。':actor.serviceHold?'现场服务暂停：'+actor.serviceHold:actor.sim?.returning?'执行安全返航，本次任务尚未完成。':actor.status==='SERVICING'?(ops.active?'已到位，正在现场服务。':'已到位，现场服务暂停。'):'已派发 '+actor.id+(ops.active?'，正在执行任务航段。':'，等待仿真推进。');
    if(!stopped&&!resolved&&actor&&!actor.serviceHold&&!actor.sim?.returning){const phase={TAKEOFF:actor.currentSite?.location==='rooftop'?'从楼顶垂直起飞':'从站点垂直起飞',CLIMB:'爬升至巡航高度',LANDING:item.type==='fire'?'下降至火场观察高度':'进场降落后交接',HOLD_LANDING:'等待降落位',CHARGING_SERVICE:'地面补能，交接尚未完成'}[actor.status];if(phase)summary=actor.id+' '+phase+'，当前 '+actor.altitude.toFixed(1)+'m。'+(!ops.active?'仿真已暂停。':'');else if(actor.status==='SERVICING'&&item.type==='fire'&&item.firePhase)summary=actor.id+(item.firePhase==='RECON'?' 正在侦察火场，确认作业点。':' 正在消防投放，火势随作业进度下降。')+(!ops.active?'仿真已暂停。':'');}
    if(item.type==='fire'&&item.roofHeight!=null&&actor?.status==='SERVICING'&&!stopped&&!resolved)summary+=' 屋顶'+item.roofHeight+'m，悬停'+actor.altitude.toFixed(0)+'m（上方'+(actor.altitude-item.roofHeight).toFixed(0)+'m）。';
    let air='待派单';
    if(item.airDeliveryCompleted)air='投放服务完成';else if(actor?.sim?.returning)air='安全返航，未投放';else if(actor?.serviceHold)air='现场服务暂停';else if(actor?.status==='TAKEOFF')air=actor.currentSite?.location==='rooftop'?'楼顶起飞爬升':'站点起飞爬升';else if(['LANDING','HOLD_LANDING'].includes(actor?.status))air='进场降落，尚未交接';else if(item.airArrivedAt!=null)air=actor?.onGround?'已落地，交接中':'到位，投放中';else if(actor)air=task.stage<task.waypoints.length-1?'取件 / 装载阶段':'跨江飞行中';
    let groundDone=item.groundArrivedAt!=null,ground=groundDone?'接应车辆已到位':item.groundCar?'经隧道前往接应点':'没有可达地面路线';
    let join=stopped?statusLabel+'，未交接':resolved?'空地交接完成':!item.airDeliveryCompleted&&!groundDone?'等待两条支路':!item.airDeliveryCompleted?'等待空中投放完成':'等待地面到位';
    if(item.crossRiver&&!stopped&&!actor?.serviceHold&&!actor?.sim?.returning)summary='空中投放与地面到位同时满足后，确认最终交接。';
    if(item.localDelivery){
      const phase=item.localDelivery.stage;
      groundDone=item.groundDeliveredAt!=null;
      ground=({TO_PICKUP:'江北车辆前往起降场',WAITING_CARGO:'江北车辆已到，等待空运物资',HANDOFF:'装载交接中',DELIVERING:'已接货，配送江北需求点',DELIVERED:'江北需求点已签收',NO_ROUTE:'江北接驳路线不可达'})[phase]||'等待江北接驳';
      join=stopped?statusLabel+'，未送达':resolved?'江北需求点已送达':phase==='DELIVERING'?'江北末端配送中':phase==='HANDOFF'?'站点物资交接中':phase==='WAITING_CARGO'?'等待空运物资到达':'等待空运与江北接驳';
      if(!stopped){summary=resolved?'物资已由江北接驳车送达需求点。':'飞机负责江南到江北的空运；车辆仅在江北接货和配送。'+ground+'。';}
      if(item.airDeliveryCompleted)air='跨江空运完成';
    }
    if(stopped&&!item.airDeliveryCompleted)air=statusLabel;
    const serviceRemaining=!stopped&&actor?.status==='SERVICING'?Math.max(0,actor.serviceUntil-ops.time):null;
    return {id,type:item.type,title:names[item.type]||item.type,summary,actorId:actor?.id||task?.actor||null,priority:task?.priority??null,elapsed,resolved,stopped,statusLabel,crossRiver:!!item.crossRiver,air,airDone:!!item.airDeliveryCompleted,ground,groundDone,join,intensity:item.type==='fire'&&!stopped?item.intensity:null,serviceRemaining,serviceHold:actor?.serviceHold||''};
  }
  return {selected,incident,names};
});
