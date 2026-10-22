'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {MixedOperations,Resources,profiles}=require('../demo/mixed-operations.js');
test('三类航空器具有独立速度、安全半径、能源与能力，默认20架',()=>{
  const o=new MixedOperations({autoEvents:false});assert.equal(o.actors.length,20);assert.equal(new Set(o.actors.map(a=>a.id)).size,20);
  for(const type of Object.keys(profiles)){const a=o.actors.find(a=>a.aircraftType===type);assert.ok(Math.abs(a.sim.config.speed*25-profiles[type].speed)<1e-9);assert.equal(a.sim.config.safetyRadius*25,profiles[type].radius);assert.equal(a.sim.options.energyPerMeter,profiles[type].energyMeter);}
  assert.equal(o.tasks.find(t=>t.type==='passenger').actor,'V01');const i=o.trigger('evacuation');assert.match(o.tasks.find(t=>t.incidentId===i.id).actor,/^H/);
});
test('单容量资源按优先级与时间分配，禁止逐循环覆盖占用者',()=>{
  const r=new Resources();r.add('pad','起降点');r.request('pad','V01',45,0);r.request('pad','H01',120,1);r.grant(1);assert.deepEqual(r.snapshot()[0].holders,['H01']);r.request('pad','H02',125,2);r.grant(2);assert.deepEqual(r.snapshot()[0].holders,['H01']);r.releaseActor('H01',3);r.grant(3);assert.deepEqual(r.snapshot()[0].holders,['H02']);
});
test('超座位和载荷任务保留队列，导出明确拒绝原因',()=>{
  const o=new MixedOperations({autoEvents:false}),t=o.createPassenger('south-port','north-port',5);o.dispatch();assert.equal(t.state,'QUEUED');const d=o.decisionsByTask.get(t.id);assert.ok(d.candidates.filter(c=>c.type==='evtol').every(c=>c.reason==='座位 / 载荷不足'));assert.ok(d.candidates.filter(c=>c.type==='uav').every(c=>c.reason==='任务能力不符'));
});
test('全程与返场预算拒绝能源不足候选，候选代价可拆解',()=>{
  const o=new MixedOperations({autoEvents:false}),a=o.actors.find(a=>a.id==='V01');a.status='IDLE';a.task=null;a.battery=36;for(const other of o.actors)if(other.id==='V02')other.status='DISABLED';const t=o.createPassenger();o.dispatch();assert.equal(t.state,'QUEUED');assert.equal(o.decisionsByTask.get(t.id).candidates.find(c=>c.id==='V01').reason,'全程及返场能源不足');
  const decision=o.decisionsByTask.get('T017');for(const c of decision.candidates.filter(c=>c.cost!=null))assert.ok(Math.abs(c.cost-c.pathCost-c.resourcePenalty-c.preemptionPenalty)<.02);
});
test('机型与起降点不兼容时拒绝，非法容量和场站不能进入队列',()=>{
  const o=new MixedOperations({autoEvents:false}),t=o.createTask('passenger',[o.pads[2].point],{people:1,requiredType:'evtol',padIds:['south-rescue']});o.dispatch();assert.equal(t.state,'QUEUED');assert.ok(o.decisionsByTask.get(t.id).candidates.filter(c=>c.type==='evtol').every(c=>c.reason==='起降点类型不兼容'));const count=o.tasks.length;assert.throws(()=>o.createPassenger('south-port','north-port',-1),/capacity/);assert.throws(()=>o.createTask('passenger',[o.pads[0].point],{padIds:['missing']}),/pad/);assert.equal(o.tasks.length,count);
});
test('载客航班即使具有相同能力也不能被应急抢占',()=>{
  const o=new MixedOperations({autoEvents:false}),old=o.actors.find(a=>a.id==='V01').task;for(const a of o.actors)if(a.id!=='V01')a.status='DISABLED';const t=o.createTask('passenger',[o.pads[1].point],{priority:130,requiredType:'evtol',people:1});o.dispatch();assert.equal(t.state,'QUEUED');assert.equal(o.actors.find(a=>a.id==='V01').task,old);
});
test('跨江两架客机真实排队，容量不超限，暂停不推进资源计时',()=>{
  const o=new MixedOperations({autoEvents:false});o.start();o.step(30);assert.ok(o.resources.snapshot().every(r=>r.holders.length<=r.capacity));assert.ok(o.actors.some(a=>a.holdReason.includes('跨江')));const time=o.time,snap=o.resources.snapshot();o.togglePause();o.step(10);assert.equal(o.time,time);assert.deepEqual(o.resources.snapshot(),snap);
});
test('管制等待仍检查心跳与电量，异常能够触发安全返航',()=>{
  const o=new MixedOperations({autoEvents:false});o.start();o.step(30);const a=o.actors.find(a=>a.holdReason.includes('跨江'));o.select(a.id);o.inject('disconnect');o.step(4.2);assert.equal(a.sim.returning,true);assert.ok(o.resources.snapshot().every(r=>r.holders.length<=1));
});
test('应急航段的相对运动预测触发真实让行，结束后恢复推进',()=>{
  const o=new MixedOperations({autoEvents:false});o.trigger('evacuation');o.start();o.step(200);assert.ok(o.summary().yield_events>0);assert.ok(o.summary().yield_s>0);assert.ok(o.events.some(e=>e.title==='运行管制'&&e.detail.includes('让行应急')));assert.ok(o.events.some(e=>e.title==='解除运行管制'));assert.equal(o.safetyFailures,0);
});
test('混合650秒剧本完成客运、五类应急与空地交接，保持公共时钟',()=>{
  const o=new MixedOperations();o.start();o.step(650);const r=o.summary();assert.equal(r.emergency_completed,5);assert.equal(r.passenger_trips,2);assert.equal(r.people_transferred,8);assert.equal(r.cross_river_state,'RESOLVED');assert.equal(r.safety_failures,0);assert.equal(o.world.traffic.time,o.time);const data=JSON.parse(JSON.stringify(o.export()));assert.equal(data.schema,'lowair-mixed/v1');assert.equal(data.actors.length,20);assert.ok(data.resourceHistory.length>0);assert.ok(data.decisions.every(d=>!d.chosen||d.candidates.find(c=>c.id===d.chosen)?.cost!=null));
  const holding=new Map();for(const e of data.resourceHistory){const set=holding.get(e.resource)||new Set();e.action==='acquire'?set.add(e.actor):set.delete(e.actor);assert.ok(set.size<=1);holding.set(e.resource,set);}
});
