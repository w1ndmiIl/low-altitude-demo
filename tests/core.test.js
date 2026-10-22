'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../demo/planner.js'),W=require('../demo/world.js'),S=require('../demo/safety.js'),Sim=require('../demo/simulation.js');
test('空地图八邻域最短路径与 octile 距离一致',()=>{
  const start={x:0,y:0},goal={x:9,y:6},r=P.astar({width:10,height:8,start,goal,blocked:()=>false});
  assert.ok(Math.abs(r.cost-P.octile(start,goal))<1e-9);assert.deepEqual(r.path[0],start);assert.deepEqual(r.path.at(-1),goal);
});
test('禁止从障碍夹角斜穿，阻塞起点和越界终点返回无路',()=>{
  const blocked=(x,y)=>(x===1&&y===0)||(x===0&&y===1),r=P.astar({width:2,height:2,start:{x:0,y:0},goal:{x:1,y:1},blocked});assert.equal(r.path.length,0);
  assert.equal(P.astar({width:2,height:2,start:{x:1,y:0},goal:{x:1,y:1},blocked}).path.length,0);
  assert.equal(P.astar({width:2,height:2,start:{x:0,y:0},goal:{x:5,y:5},blocked:()=>false}).path.length,0);
});
test('负风险权重拒绝输入，避免破坏启发式可采纳性',()=>assert.throws(()=>P.astar({width:2,height:2,start:{x:0,y:0},goal:{x:1,y:1},blocked:()=>false,weights:{ground:-1,link:0}})));
// 独立的无启发式 Dijkstra 作参照，检验加权 A* 最优代价。
function dijkstra(width,height,start,goal,blocked,risk,weights){
  const costs=new Map([[start.y*width+start.x,0]]),queue=[[0,start.x,start.y]],visited=new Set();
  while(queue.length){queue.sort((a,b)=>b[0]-a[0]);const [cost,x,y]=queue.pop(),id=y*width+x;if(visited.has(id))continue;visited.add(id);if(x===goal.x&&y===goal.y)return cost;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=width||yy>=height||blocked(xx,yy))continue;if(dx&&dy&&(blocked(x+dx,y)||blocked(x,y+dy)))continue;
      const a=risk(x,y),b=risk(xx,yy),n=yy*width+xx,next=cost+Math.hypot(dx,dy)*(1+weights.ground*(a.ground+b.ground)/2+weights.link*(a.link+b.link)/2);
      if(next<(costs.get(n)??Infinity)){costs.set(n,next);queue.push([next,xx,yy]);}}
  }return Infinity;
}
test('20 个不同小地图上的风险 A* 与独立 Dijkstra 代价一致',()=>{
  for(let seed=1;seed<=20;seed++){const width=9,height=7,start={x:0,y:0},goal={x:8,y:6},blocked=(x,y)=>!(x===0&&y===0)&&!(x===8&&y===6)&&((x*17+y*13+seed*19)%11<2),risk=(x,y)=>({ground:((x*3+y*5+seed)%9)/9,link:((x+y*7+seed)%13)/13}),weights={ground:3,link:2};
    const a=P.astar({width,height,start,goal,blocked,risk,weights}).cost,b=dijkstra(width,height,start,goal,blocked,risk,weights);assert.ok(a===b||Math.abs(a-b)<1e-8,`seed ${seed}: ${a} / ${b}`);}
});
test('连续碰撞检测拦截穿过建筑的长线段，检测相向移动',()=>{
  const w=new W.World();w.cells.fill(0);w.set(10,10,1);assert.equal(w.segmentClear({x:2,y:10},{x:18,y:10}),false);assert.equal(w.segmentClear({x:2,y:7},{x:18,y:7}),true);
  assert.equal(W.minRelativeDistance({x:0,y:0},{x:10,y:0},{x:10,y:0},{x:0,y:0}),0);
});
test('障碍膨胀覆盖邻格，地图边界不会绕回',()=>{const w=new W.World();w.cells.fill(0);w.set(10,10,1);assert.ok(w.blocked(9,9));assert.equal(w.blocked(8,8),false);assert.ok(w.blocked(-1,10));});
test('五场景两种算法：配送、返航、拒绝起飞均符合预期，无碰撞',()=>{
  for(const r of Sim.benchmark()){assert.equal(r.collisions,0);assert.equal(r.state,({static:'DELIVERED',dynamic:'DELIVERED',link:'RETURNED',battery:'RETURNED',blocked:'BLOCKED',traffic:'DELIVERED',emergency:'DELIVERED'})[r.scenario]);if(r.scenario==='blocked'){assert.equal(r.distance_m,0);assert.equal(r.time_s,0);}}
});
test('风险规划在默认静态地图中降低合成暴露，代价是航程增加',()=>{
  const a=Sim.runExperiment({algorithm:'distance'}).result,b=Sim.runExperiment({algorithm:'risk'}).result;
  assert.ok(b.ground_exposure_s<a.ground_exposure_s);assert.ok(b.link_exposure_s<a.link_exposure_s);assert.ok(b.distance_m>a.distance_m);
});
test('动态场景触发预测重规划，记录临时障碍事件',()=>{const {sim,result}=Sim.runExperiment({scenario:'dynamic',algorithm:'distance'});assert.ok(result.prediction_replans>=1);assert.ok(sim.events.some(e=>e.title==='临时障碍出现'));});
test('暂停不推进时间，恢复通信可继续任务，返航触发后锁定',()=>{
  const sim=new Sim.Simulation();sim.start();sim.step(2);sim.togglePause();const t=sim.time;sim.step(5);assert.equal(sim.time,t);sim.start();sim.forceDisconnect();sim.step(2);assert.equal(sim.state,'COMM_HOLD');sim.forceDisconnect(false);sim.step(1);assert.equal(sim.state,'FLYING');
  sim.forceDisconnect();sim.step(5);assert.ok(sim.returning);sim.forceDisconnect(false);sim.step(0.5);assert.ok(sim.returning);assert.notEqual(sim.state,'FLYING');
});
test('飞行中障碍注入后位置连续，重规划可完成配送',()=>{
  const sim=new Sim.Simulation({algorithm:'distance'});sim.start();sim.step(3);assert.ok(sim.addRouteObstacle());const before={...sim.pos};sim.step(0.05);assert.ok(W.distance(before,sim.pos)<=W.CONFIG.speed*0.05+1e-6);while(sim.active&&sim.time<90)sim.step(0.1);assert.equal(sim.state,'DELIVERED');assert.equal(sim.collisions,0);assert.ok(sim.replans>0);
});
test('故障状态优先级：电量耗尽最高，低电量触发返航',()=>{
  const c=W.CONFIG;assert.equal(S.decision({battery:0,age:0,returning:true},c),'LAND');assert.equal(S.decision({battery:19,age:0,returning:false},c),'RETURN');assert.equal(S.decision({battery:90,age:2,returning:false},c),'HOLD');
});
test('相同种子实验可复现，倍率和时间分块不改变固定步进结果',()=>{
  const a=Sim.runExperiment({scenario:'dynamic'}).result,b=Sim.runExperiment({scenario:'dynamic'}).result;assert.deepEqual(a,b);
  const sim=new Sim.Simulation({scenario:'dynamic'});sim.start();while(sim.active&&sim.time<180)sim.step(0.4);assert.deepEqual(sim.summary(),a);
});
test('10 个心跳随机种子下正常与动态场景均完成且无碰撞',()=>{
  for(let seed=42;seed<52;seed++)for(const scenario of ['static','dynamic'])for(const algorithm of ['risk','distance']){const r=Sim.runExperiment({scenario,algorithm,seed}).result;assert.equal(r.state,'DELIVERED',`${scenario}/${algorithm}/${seed}`);assert.equal(r.collisions,0);}
});
test('无可行航路不允许起飞，编辑解除障碍后可重新规划',()=>{const sim=new Sim.Simulation({scenario:'blocked'});assert.equal(sim.start(),false);sim.world.cells.fill(0);sim.world.revision++;assert.equal(sim.start(),true);while(sim.active&&sim.time<90)sim.step(0.1);assert.equal(sim.state,'DELIVERED');});
test('导出数据包含参数、地图、事件与轨迹，可 JSON 序列化',()=>{const {sim}=Sim.runExperiment();const data=JSON.parse(JSON.stringify(sim.export()));assert.equal(data.schema,'lowair-demo/v2');assert.equal(data.world.cells.length,1120);assert.ok(data.events.length>=3);assert.ok(data.telemetry.length>10);});
test('交通信号存在互斥相位、车辆运动、风险快照变化',()=>{const {Traffic}=require('../demo/traffic.js'),t=new Traffic();assert.equal(t.signal('x',3),'green');assert.equal(t.signal('z',3),'red');assert.equal(t.signal('x',12),'red');assert.equal(t.signal('z',12),'green');const before=t.cars.map(c=>c.p),density=Array.from(t.density);for(let i=0;i<200;i++)t.step(.05);t.snapshot();assert.notDeepEqual(t.cars.map(c=>c.p),before);assert.notDeepEqual(Array.from(t.density),density);assert.ok(t.cars.every(c=>Number.isFinite(c.p)&&c.v>=0));});
test('交通风险参与规划并记录拥堵和周期风险更新',()=>{const {sim,result}=Sim.runExperiment({scenario:'traffic'});assert.equal(result.state,'DELIVERED');assert.ok(result.replans>=3);assert.ok(sim.events.some(e=>e.title==='中心道路拥堵注入'));assert.ok(sim.events.some(e=>e.title==='实时交通风险更新'));});
test('鳥群、阵风和临时禁飞事件进入模型而非仅显示',()=>{const {sim,result}=Sim.runExperiment({scenario:'emergency'});assert.equal(result.state,'DELIVERED');assert.ok(result.prediction_replans>=1);assert.ok(sim.events.some(e=>e.title==='鸟群进入航路'));assert.ok(sim.events.some(e=>e.title==='阵风进入飞行区'));assert.ok(sim.events.some(e=>e.title==='临时禁飞通知'));assert.equal(result.collisions,0);});
test('导航异常停止水平运动，恢复后能继续配送',()=>{const s=new Sim.Simulation();s.start();s.step(2);s.injectEvent('gps');const p={...s.pos};s.step(3);assert.equal(s.state,'NAV_HOLD');assert.deepEqual(s.pos,p);s.step(3.1);assert.notEqual(s.state,'NAV_HOLD');while(s.active&&s.time<120)s.step(.1);assert.equal(s.state,'DELIVERED');});
test('钱江世纪城数据包含实地命名、建筑高度来源与隧道拓扑',()=>{const g=require('../demo/geo.js');assert.equal(g.data.buildings.filter(b=>!b.bank).length,782);assert.equal(g.data.buildings.length,822);assert.ok(g.data.roads.length>=690);assert.ok(g.data.buildings.some(b=>b.name==='杭州世纪中心'&&b.height===310));assert.ok(g.data.roads.some(r=>r.name==='博奥隧道'&&r.tunnel));assert.ok(g.data.waters.some(w=>w.name==='钱塘江'));assert.ok(g.data.buildings.some(b=>b.heightSource.includes('simulation')));});
test('地理建筑栅格化保守包含相交边与小于栅格的轮廓',()=>{const G=require('../demo/geo.js');assert.ok(G.intersectsBox([[.7,.1],[1.2,.1],[1.2,.2],[.7,.2],[.7,.1]],-.5,-.5,.8,.5));assert.ok(G.intersectsBox([[-2,-.1],[2,-.1],[2,.1],[-2,.1],[-2,-.1]],-.5,-.5,.5,.5));assert.equal(G.intersectsBox([[3,3],[4,3],[4,4],[3,4],[3,3]],-.5,-.5,.5,.5),false);});
test('地下车辆不计地面交通风险，隧道深度沿完整道路连续',()=>{const G=require('../demo/geo.js'),t=new G.GeoTraffic(),edge=t.edges.find(e=>e.road.name==='博奥隧道'&&e.road.tunnel&&e.offset===0);const car={id:0,edge,u:20,p:20,v:10,next:null,turns:0,desired:12};t.cars=[car];const p=t.position(car);assert.ok(p.x>=0&&p.x<G.config.width&&p.y>=0&&p.y<G.config.height);assert.ok(p.depth<-1);t.snapshot();assert.ok(t.density.every(v=>v===0));const deep=t.edges.find(e=>e.road.id===edge.road.id&&e.offset>160);assert.ok(deep);car.edge=deep;car.u=deep.length/2;assert.equal(t.depth(car),-18);});
test('钱江世纪城七场景与双算法均产生预期终态，无安全间隔失守',()=>{for(const r of Sim.benchmark({environment:'qianjiang'})){assert.equal(r.collisions,0,`${r.scenario}/${r.algorithm}`);assert.equal(r.state,({static:'DELIVERED',dynamic:'DELIVERED',traffic:'DELIVERED',emergency:'DELIVERED',link:'RETURNED',battery:'RETURNED',blocked:'BLOCKED'})[r.scenario]);}});
test('真实街区鸟群触发预测避障，入口封闭可切换',()=>{const {result,sim}=Sim.runExperiment({environment:'qianjiang',scenario:'emergency',algorithm:'risk'});assert.ok(result.prediction_replans>0);assert.ok(sim.events.some(e=>e.title==='鸟群进入航路'));const t=new Sim.Simulation({environment:'qianjiang',scenario:'traffic'});assert.equal(t.injectEvent('tunnel'),true);assert.ok(t.world.traffic.closedTunnel);t.injectEvent('tunnel');assert.equal(t.world.traffic.closedTunnel,false);});
test('公开高楼不能从界面擦除，新增的仿真建筑可增删',()=>{const s=new Sim.Simulation({environment:'qianjiang'}),w=s.world,far=(x,y)=>W.distance({x,y},s.pos)>5&&W.distance({x,y},w.goal)>5;let native,empty;for(let y=2;y<w.height-2;y++)for(let x=2;x<w.width-2;x++)if(far(x,y)){if(w.originalCells[y*w.width+x]&&!native)native={x,y};if(!w.get(x,y)&&!empty)empty={x,y};}assert.ok(native&&empty);assert.equal(s.edit(native.x,native.y,'erase'),false);assert.equal(w.get(native.x,native.y),1);assert.equal(s.edit(empty.x,empty.y,'building'),true);assert.equal(w.get(empty.x,empty.y),5);assert.equal(s.edit(empty.x,empty.y,'erase'),true);assert.equal(w.get(empty.x,empty.y),0);});
