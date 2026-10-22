(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./planner.js'),require('./world.js')):factory(root.LowAirPlanner,root.LowAirWorld);if(typeof module==='object'&&module.exports)module.exports=api;else root.LowAirAdaptive=api;})(globalThis,function(P,W){
  'use strict';
  let cachedWorkerSource;
  function workerSource(){if(cachedWorkerSource)return cachedWorkerSource;return cachedWorkerSource=`'use strict';
const clamp=${W.clamp.toString()},segmentRect=${W.segmentRect.toString()};
${P.MinHeap.toString()}
const moves=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
${P.octile.toString()}
${P.astar.toString()}
class Grid{
 constructor(s){Object.assign(this,s);this.mask=new Uint8Array(this.width*this.height);this.risks=new Array(this.width*this.height);this.traffic={risk:(x,y)=>this.density?.[Math.max(0,Math.min(this.height-1,Math.round(y)))*this.width+Math.max(0,Math.min(this.width-1,Math.round(x)))]||0};}
 ${W.World.prototype.inside.toString()}
 ${W.World.prototype.get.toString()}
 ${W.World.prototype.blocked.toString()}
 ${W.World.prototype.risk.toString()}
 ${W.World.prototype.segmentClear.toString()}
 blockedAt(x,y){if(!this.inside(x,y))return true;const i=y*this.width+x;if(!this.mask[i])this.mask[i]=this.blocked(x,y)?2:1;return this.mask[i]===2;}
 riskAt(x,y){const i=y*this.width+x;return this.risks[i]||(this.risks[i]=this.risk(x,y));}
}
const worlds=new Map();
self.onmessage=e=>{const j=e.data,start=performance.now();try{
 if(j.world)worlds.set(j.worldId,new Grid(j.world));const w=worlds.get(j.worldId);if(!w)throw Error('Missing world snapshot');w.config=j.config;
 const blocked=(x,y)=>w.blockedAt(x,y)||j.predicted.some(p=>Math.hypot(x-p.x,y-p.y)<p.radius+j.config.safetyRadius+.55),candidates=[];
 for(let y=Math.round(j.pos.y)-2;y<=Math.round(j.pos.y)+2;y++)for(let x=Math.round(j.pos.x)-2;x<=Math.round(j.pos.x)+2;x++){const p={x,y};if(w.inside(x,y)&&!blocked(x,y)&&w.segmentClear(j.pos,p))candidates.push(p);}
 candidates.sort((a,b)=>Math.hypot(a.x-j.pos.x,a.y-j.pos.y)-Math.hypot(b.x-j.pos.x,b.y-j.pos.y));let result={path:[],expanded:0,cost:Infinity};
 for(const p of candidates){result=astar({width:w.width,height:w.height,start:p,goal:j.goal,blocked,risk:(x,y)=>w.riskAt(x,y),weights:j.weights});if(result.path.length)break;}
 self.postMessage({id:j.id,result,computeMs:performance.now()-start,version:j.version,geometryRevision:j.geometryRevision,origin:j.pos});
 }catch(error){self.postMessage({id:j.id,error:error.message});}};`;}
  class PlannerService {
    constructor(){this.generation=0;this.nextId=0;this.stats={requested:0,completed:0,cancelled:0,failed:0,maxQueue:0};this.reset();}
    reset(){this.generation++;this.worker?.terminate();if(this.url)URL.revokeObjectURL(this.url);for(const job of [...(this.queue||[]),...(this.current?[this.current]:[])])job.resolve({cancelled:true});this.queue=[];this.current=null;this.worldIds=new WeakMap();this.sentVersions=new Map();this.nextWorldId=0;this.available=false;try{this.url=URL.createObjectURL(new Blob([workerSource()],{type:'text/javascript'}));this.worker=new Worker(this.url);this.available=true;this.worker.onmessage=e=>{const job=this.current;if(!job||job.id!==e.data.id)return;this.current=null;e.data.error?(this.stats.failed++,job.reject(Error(e.data.error))):(this.stats.completed++,job.resolve(e.data));this.pump();};this.worker.onerror=e=>{e.preventDefault?.();this.available=false;const error=Error(e.message||'后台规划线程不可用');for(const job of [...this.queue,...(this.current?[this.current]:[])])job.reject(error);this.queue=[];this.current=null;};}catch(e){this.error=e.message;}}
    request(prepare,priority=50){this.stats.requested++;return new Promise((resolve,reject)=>{if(!this.available){reject(Error(this.error||'后台规划线程不可用'));return;}this.queue.push({id:++this.nextId,prepare,priority,resolve,reject,generation:this.generation});this.stats.maxQueue=Math.max(this.stats.maxQueue,this.queue.length);queueMicrotask(()=>this.pump());});}
    pump(){if(!this.available||this.current||!this.queue.length)return;this.queue.sort((a,b)=>b.priority-a.priority||a.id-b.id);const job=this.queue.shift(),payload=job.prepare();if(!payload){this.stats.cancelled++;job.resolve({cancelled:true});this.pump();return;}const source=payload.source;delete payload.source;let id=this.worldIds.get(source);if(!id){id=++this.nextWorldId;this.worldIds.set(source,id);}const version=source.revision+':'+(source.geometryRevision||0);if(this.sentVersions.get(id)!==version){payload.world={width:source.width,height:source.height,cells:source.cells.slice(),density:source.traffic.density?.slice(),crowds:source.crowds,weakZones:source.weakZones,relayCenters:source.relayCenters||[],scenario:source.scenario};this.sentVersions.set(id,version);}this.current=job;this.worker.postMessage({...payload,id:job.id,worldId:id,version});}
    dispose(){this.available=false;this.worker?.terminate();if(this.url)URL.revokeObjectURL(this.url);for(const job of [...this.queue,...(this.current?[this.current]:[])])job.resolve({cancelled:true});this.queue=[];this.current=null;}
  }
  function routeCost(route,world,weights){let sum=0;for(let i=1;i<route.length;i++){const a=world.risk(route[i-1].x,route[i-1].y),b=world.risk(route[i].x,route[i].y);sum+=W.distance(route[i-1],route[i])*(1+weights.ground*(a.ground+b.ground)/2+weights.link*(a.link+b.link)/2);}return sum;}
  function reconnect(pos,path,world){let best=null,bestDistance=Infinity;for(let i=0;i<path.length-1;i++){const a=path[i],b=path[i+1],dx=b.x-a.x,dy=b.y-a.y,t=W.clamp(((pos.x-a.x)*dx+(pos.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1),q={x:a.x+dx*t,y:a.y+dy*t},distance=W.distance(pos,q);if(distance<=bestDistance&&world.segmentClear(pos,q)&&world.segmentClear(q,b)){best={q,index:i+1};bestDistance=distance;}}
    if(!best){const q=path[0];if(!q||!world.segmentClear(pos,q))return [];best={q,index:1};}const route=[{...pos},...(W.distance(pos,best.q)>1e-6?[best.q]:[]),...path.slice(best.index).filter(p=>W.distance(pos,p)>1e-6)];for(let i=1;i<route.length;i++)if(!world.segmentClear(route[i-1],route[i]))return [];return route;}
  return {PlannerService,workerSource,routeCost,reconnect};
});
