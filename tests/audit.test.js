'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {MixedOperations}=require('../demo/mixed-operations.js');
const advanceUntil=(o,condition,deadline)=>{while(!condition()&&o.time<deadline)o.step(.1);assert.ok(condition(),'condition not reached by '+deadline);};
test('安全返航后补能清除终态，可重新派单，断链待命不被派单',()=>{
  const o=new MixedOperations({autoEvents:false});o.start();o.step(15);o.select('V01');const a=o.selected;o.inject('battery');advanceUntil(o,()=>a.status==='CHARGING',160);a.link.forced=true;o.step(21);assert.equal(a.status,'IDLE');assert.equal(a.sim.returning,false);assert.equal(a.sim.state,'READY');assert.equal(a.battery,100);
  const next=o.createPassenger();o.dispatch();assert.equal(o.decisionsByTask.get(next.id).candidates.find(c=>c.id===a.id).reason,'通信未恢复');a.link.forced=false;o.step(2);assert.ok(a.task,'恢复心跳后应再次获派任务');assert.equal(a.sim.returning,false);
});
test('已接运人员安全返航后中止，江北待命机不能跳过接运完成任务',()=>{
  const o=new MixedOperations({autoEvents:false}),i=o.trigger('evacuation'),task=o.tasks.find(t=>t.incidentId===i.id);o.start();advanceUntil(o,()=>task.stage===1&&o.actors.find(a=>a.task===task)?.status==='FLYING',200);const carrier=o.actors.find(a=>a.task===task);o.select(carrier.id);o.inject('battery');advanceUntil(o,()=>task.state==='ABORTED',400);assert.equal(i.status,'ABORTED');assert.equal(i.resolvedAt,null);assert.equal(task.actor,carrier.id);assert.equal(task.completedAt,null);assert.ok(!o.queue.includes(task));assert.ok(!o.completed.includes(task));assert.equal(o.completed.filter(t=>t.type==='evacuation').length,0);
});
test('最终服务时低能源或持续失联会中断，不能确认客运成功',()=>{
  for(const fault of ['battery','disconnect']){const o=new MixedOperations({autoEvents:false});o.start();const a=o.actors.find(a=>a.id==='V01'),task=a.task;advanceUntil(o,()=>a.status==='SERVICING'&&task.stage===1,250);o.select(a.id);o.inject(fault);o.step(fault==='battery'?.15:4.3);assert.equal(a.sim.returning,true,fault);assert.equal(a.status,'FLYING',fault);assert.notEqual(task.state,'COMPLETED',fault);assert.ok(!o.completed.includes(task),fault);}
});
test('服务能源使用机型参数，导航暂停保留剩余服务，耗尽不能成功',()=>{
  const o=new MixedOperations({autoEvents:false});o.start();o.step(.1);const a=o.actors.find(a=>a.id==='V01');assert.equal(a.status,'SERVICING');const energy=a.battery;o.step(.5);assert.ok(Math.abs(energy-a.battery-.5*a.profile.energySecond)<1e-8);o.select(a.id);const remaining=a.serviceUntil-o.time;o.inject('gps');o.step(1);assert.equal(a.status,'SERVICING');assert.ok(a.serviceHold.includes('导航'));assert.ok(Math.abs(a.serviceUntil-o.time-remaining)<1e-8);a.battery=0;o.step(.1);assert.equal(a.status,'DISABLED');assert.equal(a.task.state,'FAILED');assert.equal(a.task.completedAt,null);
});
test('离场倒计时更新不刷日志，待命低能源进入补能',()=>{
  const o=new MixedOperations({autoEvents:false});o.start();o.step(12);const entries=o.events.filter(e=>e.title==='运行管制'&&e.detail.includes('V01 离场放行'));assert.equal(entries.length,1);o.select('H02');o.inject('battery');assert.equal(o.selected.status,'CHARGING');o.step(21);assert.equal(o.selected.battery,100);assert.equal(o.selected.sim.state,'READY');
});
