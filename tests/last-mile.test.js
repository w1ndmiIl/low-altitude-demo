const test=require('node:test'),assert=require('node:assert/strict');
const {GroundedMixedOperations}=require('../demo/ground-operations.js');
const {Operations}=require('../demo/operations.js');
const Stage=require('../demo/stage-model.js');
function setup(){const o=new GroundedMixedOperations({autoEvents:false}),incident=o.trigger('medical');return {o,incident,car:incident.groundCar};}
// Isolate the ground branch; aerial-service flags are controlled explicitly by each test.
function drive(o,incident,seconds){let left=seconds;while(left>1e-8){const dt=Math.min(.05,left);o.world.traffic.step(dt);o.time=o.world.traffic.time;o.updateCrossRiverIncident(incident,dt);left-=dt;}}

test('接驳和配送全程走江北实际路网，空运仍从江南去江北',()=>{
  const {o,incident:i,car}=setup();assert.ok(car);assert.equal(i.localDelivery.stage,'TO_PICKUP');
  for(const edge of [...car.itinerary,...car.deliveryItinerary]){assert.match(edge.road.bank,/^north/);assert.ok(!edge.road.tunnel&&!edge.road.bridge);}
  const task=o.tasks.find(t=>t.incidentId===i.id);assert.deepEqual(task.padIds,['south-port','north-port']);
  assert.notDeepEqual(i.localDelivery.depotWorld,i.localDelivery.pickupWorld);assert.notDeepEqual(i.localDelivery.pickupWorld,i.localDelivery.destinationWorld);
  assert.ok(Math.hypot(i.localDelivery.pickup.x-i.position.x,i.localDelivery.pickup.y-i.position.y)*25<=200);
  assert.doesNotThrow(()=>JSON.parse(JSON.stringify(o.export())));
});

test('车先到必须等货，空中仅到场不能装载；暂停不推进交接',()=>{
  const {o,incident:i,car}=setup();drive(o,i,250);assert.equal(i.localDelivery.stage,'WAITING_CARGO');const pos=o.world.traffic.position(car);
  i.airArrivedAt=o.time;drive(o,i,10);assert.equal(i.localDelivery.stage,'WAITING_CARGO');assert.deepEqual(o.world.traffic.position(car),pos);
  assert.equal(Stage.incident(o,i.id).groundDone,false);assert.equal(i.resolvedAt,null);
  i.airDeliveryCompleted=true;o.updateCrossRiverIncident(i,.05);assert.equal(i.localDelivery.stage,'HANDOFF');
  const clock=o.time;o.step(20);assert.equal(o.time,clock);assert.equal(i.handoffCompletedAt,null);
  drive(o,i,7.9);assert.equal(i.localDelivery.stage,'HANDOFF');assert.equal(car.arrived,true);
});

test('交接后同车从原路口继续配送，只有实际送达需求点才完成',()=>{
  const {o,incident:i,car}=setup();drive(o,i,250);i.airDeliveryCompleted=true;const task=o.tasks.find(t=>t.incidentId===i.id);task.state='COMPLETED';o.completed.push(task);o.updateCrossRiverIncident(i,.05);assert.equal(o.summary().emergency_completed,0);
  const id=car.id,arrivedNode=car.edge.to,point=o.world.traffic.position(car);drive(o,i,8);assert.equal(i.localDelivery.stage,'DELIVERING');assert.equal(car.id,id);assert.equal(car.edge.from,arrivedNode);
  assert.ok(Math.hypot(o.world.traffic.position(car).x-point.x,o.world.traffic.position(car).y-point.y)*25<=6); // curb/lane offset may change by at most 5.8m at the same road node
  assert.equal(i.resolvedAt,null);assert.equal(o.summary().emergency_completed,0);assert.equal(Stage.incident(o,i.id).resolved,false);assert.equal(Stage.incident(o,i.id).groundDone,false);
  drive(o,i,200);assert.equal(i.localDelivery.stage,'DELIVERED');assert.equal(i.status,'RESOLVED');assert.equal(o.summary().emergency_completed,1);assert.ok(i.resolvedAt>=i.groundDeliveredAt&&i.groundDeliveredAt>i.handoffCompletedAt);
  assert.equal(Stage.incident(o,i.id).groundDone,true);assert.equal(Stage.incident(o,i.id).join,'江北需求点已送达');
  const finished=i.resolvedAt,count=o.events.filter(e=>e.title==='跨江运输与江北配送完成').length;drive(o,i,20);assert.equal(i.resolvedAt,finished);assert.equal(o.events.filter(e=>e.title==='跨江运输与江北配送完成').length,count);
});

test('没有江北可达路网时不造车、不误报成功，固定实验仍保留原跨江车辆',()=>{
  const {o,incident:i}=setup();o.world.traffic.edges=[];const task=o.tasks.find(t=>t.incidentId===i.id);const absent=o.createMedicalGround(i,task);assert.equal(absent,null);i.groundCar=null;i.airDeliveryCompleted=true;o.updateCrossRiverIncident(i,.1);assert.equal(i.resolvedAt,null);assert.equal(i.localDelivery.stage,'NO_ROUTE');
  const fixed=new Operations({autoEvents:false}),original=fixed.trigger('medical');assert.equal(original.localDelivery,undefined);assert.ok(original.groundCar.itinerary.some(e=>e.road.name==='博奥隧道'));
});
