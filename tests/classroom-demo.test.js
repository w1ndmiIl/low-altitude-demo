const test=require('node:test'),assert=require('node:assert/strict');
const {Controller,automaticLimitSeconds}=require('../demo/classroom-demo.js');
function setup(){const log=[],conditions={},env={current:true};const controller=new Controller({prepare:()=>log.push('prepare'),isCurrent:()=>env.current,setRunning:x=>log.push(['running',x]),enter:id=>log.push(['enter',id]),complete:id=>!!conditions[id],summary:()=> '按实际记录结束',release:()=>log.push('release'),render:()=>{}});return {controller,log,conditions,env};}
function reachExecution(c){c.start({mode:'auto'});for(const seconds of [20,3,3,4,3])c.tick(seconds);assert.equal(c.state.step,'takeoff');}

test('精简自动流程按20秒日常和短派单片段推进，正常总长88秒',()=>{
  for(const mode of ['auto','autolive']){
    const {controller:c,conditions}=setup();
    for(const id of ['overview','takeoff','fire','medical'])conditions[id]=true;
    c.start({mode});
    for(const [id,minimum] of [['overview',20],['queue',3],['filter',3],['compare',4],['result',3],['takeoff',10],['fire',10],['medical',28],['summary',7]]){
      assert.equal(c.state.step,id);c.tick(minimum-.25);assert.equal(c.state.step,id);assert.equal(c.active,true);c.tick(.25);
    }
    assert.equal(c.active,false);
  }
});

test('观察倒计时使用实际演示时间，暂停期间不消耗剩余观察时长',()=>{
  const {controller:c,conditions}=setup();conditions.overview=true;c.start({mode:'autolive'});
  c.tick(10);c.pause();c.tick(1000);assert.equal(c.stageElapsed,10);assert.equal(c.state.minimumSeconds,20);
  c.togglePause();c.tick(9.9);assert.equal(c.state.step,'overview');c.tick(.11);assert.equal(c.state.step,'queue');
  c.tick(1);c.pause();c.tick(100);assert.equal(c.stageElapsed,1);c.togglePause();c.tick(1.9);assert.equal(c.state.step,'queue');c.tick(.11);assert.equal(c.state.step,'filter');
});
test('暂停同时冻结讲解进度和执行，继续保持当前阶段',()=>{const {controller:c,log}=setup();reachExecution(c);c.tick(2);c.togglePause();const elapsed=c.state.elapsed;c.tick(100);assert.equal(c.state.elapsed,elapsed);assert.deepEqual(log.at(-1),['running',false]);c.togglePause();assert.deepEqual(log.at(-1),['running',true]);assert.equal(c.state.step,'takeoff');});
test('执行阶段必须等待真实条件，时间上限不伪造完成',()=>{const {controller:c,conditions}=setup();reachExecution(c);c.tick(9);assert.equal(c.state.step,'takeoff');conditions.takeoff=true;c.tick(1);assert.equal(c.state.step,'fire');c.tick(10);assert.equal(c.state.step,'medical');assert.deepEqual(c.state.history[1],{step:'fire',complete:false,timedOut:true});conditions.medical=true;c.tick(28);assert.equal(c.state.step,'summary');c.tick(7);assert.equal(c.active,false);assert.equal(c.state.caption,'按实际记录结束');});
test('退出后不继续发布事件，重播从场景总览重新开始',()=>{const {controller:c,log}=setup();reachExecution(c);c.stop();const count=log.length;c.tick(1000);assert.equal(log.length,count);c.start();assert.equal(c.state.step,'overview');assert.deepEqual(c.state.history,[]);assert.equal(c.state.elapsed,0);});
test('场景替换会取消演示，后台暂停后不会推进阶段',()=>{const {controller:c,env}=setup();c.start();c.pause();c.tick(99);assert.equal(c.state.step,'overview');c.togglePause();env.current=false;c.tick(.1);assert.equal(c.active,false);assert.match(c.state.caption,/场景已切换/);});
test('手动讲解默认停留，下一步逐个揭示调度记录',()=>{const {controller:c}=setup();c.start();c.tick(100);assert.equal(c.state.step,'overview');assert.equal(c.state.mode,'manual');for(const id of ['queue','filter','compare','result','takeoff']){assert.equal(c.next(),true);assert.equal(c.state.step,id);}assert.equal(c.next(),false);assert.deepEqual(c.history,[]);});
test('手动执行满足实际条件后冻结场景，等待讲述人推进',()=>{const {controller:c,conditions,log}=setup();c.start();for(let i=0;i<5;i++)c.next();conditions.takeoff=true;c.tick(10);assert.equal(c.state.step,'takeoff');assert.equal(c.ready,true);assert.deepEqual(log.at(-1),['running',false]);c.tick(100);assert.equal(c.state.step,'takeoff');c.next();assert.equal(c.state.step,'fire');assert.deepEqual(c.history,[{step:'takeoff',complete:true,timedOut:false}]);});
test('超时可继续观察，不重复记结果或伪造完成',()=>{const {controller:c,conditions}=setup();c.start();for(let i=0;i<5;i++)c.next();c.tick(10);assert.equal(c.ready,true);assert.equal(c.state.result.complete,false);assert.equal(c.watchAgain(),true);assert.equal(c.ready,false);assert.deepEqual(c.history,[]);conditions.takeoff=true;c.tick(10);c.next();assert.deepEqual(c.history,[{step:'takeoff',complete:true,timedOut:false}]);});
test('未完成时主动推进保留超时结果，手动回顾不会自行结束',()=>{const {controller:c}=setup();c.start();for(let i=0;i<5;i++)c.next();for(const seconds of [10,10,28]){c.tick(seconds);c.next();}assert.equal(c.state.step,'summary');c.tick(999);assert.equal(c.active,true);assert.ok(c.history.every(r=>!r.complete&&r.timedOut));c.next();assert.equal(c.active,false);});
test('连续讲解在快照、阶段完成和回顾中保持城市运行，只主动暂停才冻结',()=>{const {controller:c,conditions,log}=setup();c.start({mode:'live'});assert.equal(c.ready,false);conditions.overview=true;c.tick(20);assert.equal(c.ready,true);assert.deepEqual(log.filter(x=>Array.isArray(x)&&x[0]==='running').at(-1),['running',true]);c.next();assert.equal(c.state.step,'queue');assert.equal(c.ready,true);c.togglePause();assert.deepEqual(log.at(-1),['running',false]);assert.equal(c.next(),false);c.togglePause();assert.deepEqual(log.at(-1),['running',true]);for(let i=0;i<4;i++)c.next();conditions.takeoff=true;c.tick(10);assert.equal(c.ready,true);assert.deepEqual(log.filter(x=>Array.isArray(x)&&x[0]==='running').at(-1),['running',true]);});
test('连续讲解超时后后台完成可更新结果，结束讲解保留运营',()=>{const {controller:c,conditions,log}=setup();c.start({mode:'live'});conditions.overview=true;c.tick(20);for(let i=0;i<5;i++)c.next();for(const id of ['takeoff','fire','medical']){c.tick(100);assert.equal(c.result.timedOut,true);conditions[id]=true;c.tick(1);assert.equal(c.result.complete,true);c.next();}assert.equal(c.state.step,'summary');c.next();assert.equal(c.active,false);assert.deepEqual(log.filter(x=>Array.isArray(x)&&x[0]==='running').at(-1),['running',true]);});

test('自动连续演示无需下一步，讲解期间持续运行，真实完成后结束并保留运营',()=>{const {controller:c,conditions,log}=setup();c.start({mode:'autolive'});assert.equal(c.continuous,true);assert.equal(c.automatic,true);c.tick(15);assert.equal(c.state.step,'overview');conditions.overview=true;c.tick(5);assert.equal(c.state.step,'queue');assert.equal(c.next(),false);for(const seconds of [3,3,4,3])c.tick(seconds);assert.equal(c.state.step,'takeoff');for(const [id,seconds] of [['takeoff',10],['fire',10],['medical',28]]){conditions[id]=true;c.tick(seconds);}assert.equal(c.state.step,'summary');c.tick(7);assert.equal(c.active,false);assert.equal(c.history.length,4);assert.ok(c.history.every(r=>r.complete&&!r.timedOut));assert.ok(log.filter(x=>Array.isArray(x)&&x[0]==='running').every(x=>x[1]));});

test('自动连续演示暂停冻结进度，超时保留真实未完成结果，重播清空历史',()=>{const {controller:c,conditions}=setup();c.start({mode:'autolive'});c.togglePause();c.tick(100);assert.equal(c.elapsed,0);c.togglePause();conditions.overview=true;c.tick(20);for(const seconds of [3,3,4,3])c.tick(seconds);c.tick(10);assert.equal(c.state.step,'fire');assert.deepEqual(c.history.at(-1),{step:'takeoff',complete:false,timedOut:true});c.start({mode:'autolive'});assert.equal(c.state.step,'overview');assert.deepEqual(c.history,[]);});


test('所有执行段未满足条件时，按最大展示预算88秒收尾且保留未完成',()=>{
  const {controller:c,log}=setup();c.start({mode:'autolive'});
  for(const seconds of [20,3,3,4,3,10,10,28,7])c.tick(seconds);
  assert.equal(c.active,false);assert.equal(c.elapsed,88);assert.ok(c.history.every(r=>!r.complete&&r.timedOut));
  assert.deepEqual(log.filter(x=>Array.isArray(x)&&x[0]==='running').at(-1),['running',true]);
});

test('自动演示90秒总上限优先于阶段等待，不把未完成任务写成功',()=>{
  const {controller:c,log}=setup();c.start({mode:'autolive'});
  for(const seconds of [20,3,3,4,3,10,10])c.tick(seconds);
  assert.equal(c.state.step,'medical');c.tick(27);assert.equal(c.active,true);c.pause();c.tick(1000);assert.equal(c.elapsed,80);c.togglePause();c.tick(10);
  assert.equal(c.active,false);assert.equal(c.elapsed,automaticLimitSeconds);assert.equal(automaticLimitSeconds,90);
  assert.deepEqual(c.history.at(-1),{step:'medical',complete:false,timedOut:true});assert.match(c.state.caption,/90秒/);
  const count=log.length;c.tick(1000);assert.equal(log.length,count);
});
