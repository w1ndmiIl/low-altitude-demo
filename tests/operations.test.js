'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Operations,runOperations}=require('../demo/operations.js');
const G=require('../demo/geo.js');
test('8 架无人机具有能力标签和相隔20米的固定飞层',()=>{const o=new Operations({autoEvents:false});assert.equal(o.actors.length,8);assert.equal(new Set(o.actors.map(a=>a.altitude)).size,8);assert.ok(o.actors.every(a=>a.skills.length&&a.sim));assert.equal(o.actors.at(-1).altitude-o.actors[0].altitude,140);});
test('任务暂停不推进，多机共享交通时钟不会推进8次',()=>{const o=new Operations({autoEvents:false});o.step(3);assert.equal(o.time,0);o.start();o.step(10);assert.ok(Math.abs(o.time-10)<1e-8);assert.ok(Math.abs(o.world.traffic.time-o.time)<1e-8);o.togglePause();const time=o.time;o.step(2);assert.equal(o.time,time);});
test('快递先取件再投送，首次到点不等于完成整个任务',()=>{const o=new Operations({autoEvents:false});o.start();o.step(4);const parcel=o.tasks.find(t=>t.type==='parcel');assert.equal(parcel.stage,1);assert.notEqual(parcel.state,'COMPLETED');o.step(180);assert.equal(parcel.state,'COMPLETED');assert.ok(o.events.some(e=>e.title==='到达任务点'&&e.detail.includes('取件')));});
test('应急抢占保留日常任务阶段、剩余任务和电量',()=>{const o=new Operations({autoEvents:false});o.start();o.step(10);const actor=o.actors.find(a=>a.status==='FLYING'&&a.task),old=actor.task,battery=actor.battery,link=actor.link;const task=o.createTask('rescue',[actor.home],{priority:100});o.queue.splice(o.queue.indexOf(task),1);o.assign(actor,task);assert.equal(o.preemptions,1);assert.equal(old.state,'QUEUED');assert.ok(o.queue.includes(old));assert.equal(actor.sim.battery,battery);assert.equal(actor.sim.link,link);});
test('地面跨江路径使用博奥隧道，空中未送达时不能提前交接',()=>{const o=new Operations({autoEvents:false}),incident=o.trigger('medical');assert.ok(incident.groundCar);assert.ok(incident.groundCar.itinerary.some(e=>e.road.tunnel&&e.road.name==='博奥隧道'));incident.groundCar.arrived=true;incident.groundCar.arrivedAt=0;o.start();o.step(.1);assert.equal(incident.airDeliveryCompleted,undefined);assert.equal(incident.resolvedAt,null);});
test('鸟群只影响相近飞层，其他固定飞层不会误判水平冲突',()=>{const o=new Operations({autoEvents:false}),a=o.actors[0],b=o.actors[1];o.start();o.step(5);o.select(a.id);assert.equal(o.inject('birds'),true);a.sim.world.intruders=o.world.intruders;b.sim.world.intruders=o.world.intruders;assert.equal(a.sim.world.relevantIntruders().length,3);assert.equal(b.sim.world.relevantIntruders().length,0);});
test('江北仅40栋抽样，两岸航域与坐标投影保留米尺度',()=>{assert.equal(G.data.northBuildingCount,40);assert.equal(G.data.buildings.filter(b=>b.bank==='north-sampled').length,40);const p=G.toGrid([-3050,-1240]);assert.ok(p.x>0&&p.x<G.config.width);assert.ok(p.y>0&&p.y<G.config.height);assert.ok(Math.abs((p.x-(G.config.width-1)/2)*25+G.config.centerX+3050)<1e-8);});
test('650秒预设运营中优先调度完成应急与跨江交接，无安全停止',()=>{const {ops,result}=runOperations({duration:650});assert.equal(result.emergency_completed,4);assert.equal(result.cross_river_state,'RESOLVED');assert.equal(result.safety_failures,0);assert.ok(result.preemptions>0);assert.ok(result.min_fleet_separation_m>=20);const cross=ops.incidents.find(i=>i.crossRiver);assert.ok(cross.resolvedAt>=cross.airArrivedAt+7.99);assert.ok(cross.resolvedAt>=cross.groundArrivedAt);assert.ok(ops.incidents.find(i=>i.type==='fire').intensity===0);});
test('运营导出保留任务、事件、两岸来源和独立交接状态',()=>{const o=new Operations({autoEvents:false});o.trigger('medical');const data=JSON.parse(JSON.stringify(o.export()));assert.equal(data.schema,'lowair-operations/v1');assert.equal(data.actors.length,8);assert.ok(data.source.northHash);assert.ok(data.incidents[0].groundCar.itinerary.includes('博奥隧道'));});
test('同一应急任务开关抢占权限，关闭时排队，开启时保留连续位置和原阶段',()=>{
  for(const enabled of [false,true]){
    const o=new Operations({autoEvents:false,preemptionEnabled:enabled});o.start();o.step(10);
    const actor=o.actors.find(a=>a.status==='FLYING'),old=actor.task,stage=old.stage,pos={...actor.position};
    for(const other of o.actors)if(other!==actor)other.status='DISABLED';
    const emergency=o.createTask(old.type,[actor.home],{priority:100});o.dispatch();
    assert.equal(o.preemptions,enabled?1:0);assert.equal(emergency.state,enabled?'ASSIGNED':'QUEUED');
    assert.equal(old.stage,stage);assert.deepEqual(actor.position,pos);
    if(enabled){assert.equal(old.state,'QUEUED');assert.deepEqual(actor.sim.pos,pos);}
  }
});
test('能耗约束检查剩余多阶段航程，不把电量高于35%当成充分条件',()=>{
  const o=new Operations({autoEvents:false}),actor=o.actors[0];o.queue=[];actor.task=null;actor.status='IDLE';actor.battery=36;
  for(const other of o.actors)if(other!==actor)other.status='DISABLED';
  const goal=o.actors[4].home,task=o.createTask('parcel',[goal,actor.home,goal],{priority:35}),before=o.schedulerStats.energyRejected;
  o.dispatch();assert.equal(task.state,'QUEUED');assert.equal(actor.task,null);assert.ok(o.schedulerStats.energyRejected>before);
});
test('调度诊断随导出保留，能区分决策搜索和飞行器自身重规划',()=>{
  const o=new Operations({autoEvents:false}),stats=o.export().schedulerStats;
  assert.equal(stats.dispatchCalls,1);assert.equal(stats.assignments,o.actors.filter(a=>a.task).length);assert.ok(stats.pathSearches>=stats.assignments);assert.ok(stats.expandedNodes>stats.pathSearches);
  o.start();o.step(1);assert.ok(o.schedulerStats.dispatchCalls>stats.dispatchCalls);assert.equal(stats.dispatchCalls,1);
});
test('16机展示拥有独立能力、任务、位置与飞层，8机基准保持不变',()=>{
  const o=new Operations({fleetSize:16,autoEvents:false});assert.equal(o.actors.length,16);assert.equal(o.tasks.length,16);assert.equal(new Set(o.actors.map(a=>a.id)).size,16);assert.equal(o.actors.at(-1).altitude,420);assert.ok(o.actors.every(a=>a.sim&&a.skills.length));assert.ok(o.actors.filter(a=>a.task).length>=14);assert.equal(new Operations({autoEvents:false}).actors.length,8);assert.throws(()=>new Operations({fleetSize:12}),/Fleet/);
});
test('16机完整应急剧本仍完成四类事件与跨江交接，公共时钟一致',()=>{
  const {ops,result}=runOperations({fleetSize:16,duration:650});assert.equal(result.fleet,16);assert.equal(result.emergency_completed,4);assert.equal(result.cross_river_state,'RESOLVED');assert.equal(result.safety_failures,0);assert.ok(result.min_fleet_separation_m>=20);assert.ok(Math.abs(ops.world.traffic.time-ops.time)<1e-8);
});
