(function (root,factory) {
  const api=factory(typeof module==='object'&&module.exports?require('./traffic.js'):root.LowAirTraffic,typeof module==='object'&&module.exports?require('./geo.js'):root.LowAirGeo);
  if(typeof module==='object'&&module.exports) module.exports=api; else root.LowAirWorld=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(T,G){
  'use strict';
  // 成员 4：环境、合成风险场、障碍感知与连续碰撞检测。
  const CONFIG=Object.freeze({width:40,height:28,cellMeters:5,altitude:60,speed:2.4,safetyRadius:0.32,sensorRadius:9,predictionSeconds:2.2,holdSeconds:1.5,returnSeconds:4,lowBattery:20});
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function segmentRect(a,b,x0,y0,x1,y1) {
    let lo=0,hi=1;
    for(const [p,q,min,max] of [[a.x,b.x,x0,x1],[a.y,b.y,y0,y1]]) {
      const d=q-p;
      if(Math.abs(d)<1e-12) { if(p<min||p>max)return false; }
      else { const s=(min-p)/d,t=(max-p)/d;lo=Math.max(lo,Math.min(s,t));hi=Math.min(hi,Math.max(s,t));if(lo>hi)return false; }
    }
    return true;
  }
  function minRelativeDistance(a0,a1,b0,b1) {
    const rx=a0.x-b0.x,ry=a0.y-b0.y,vx=a1.x-a0.x-(b1.x-b0.x),vy=a1.y-a0.y-(b1.y-b0.y);
    const t=clamp(-(rx*vx+ry*vy)/(vx*vx+vy*vy||1),0,1);
    return Math.hypot(rx+t*vx,ry+t*vy);
  }
  class World {
    constructor(scenario='static',environment='teaching') {
      this.config=CONFIG;
      this.scenario=scenario;this.width=CONFIG.width;this.height=CONFIG.height;
      if(environment==='qianjiang'){G.initialize(this,scenario);return;}
      this.cells=new Uint8Array(this.width*this.height);this.revision=0;
      this.start={x:3,y:24};this.goal={x:36,y:3};this.intruders=[];
      this.traffic=new T.Traffic();this.trafficSnapshotTime=0;
      this.crowds=[{x:19,y:15,rx:7.8,ry:6.3,amplitude:1},{x:31,y:7,rx:3,ry:3,amplitude:0.4}];
      this.weakZones=[{x:25,y:9,rx:6,ry:6,amplitude:1},{x:8,y:13,rx:6,ry:5,amplitude:1}];
      for(const block of [[4,5,5,7],[12,5,5,7],[22,5,5,7],[30,5,5,7],[5,18,5,5],[12,18,5,5],[22,18,5,5],[30,18,5,3]])this.rect(...block,1);
      this.circle(31,23,3.1,2);
      if(scenario==='dynamic') this.intruders=[{name:'巡检无人机 B',a:{x:2,y:16},b:{x:2,y:24},speed:1.1,radius:0.65}];
      if(scenario==='blocked') this.rect(19,0,2,28,1);
    }
    inside(x,y) { return x>=0&&y>=0&&x<this.width&&y<this.height; }
    get(x,y) { return this.inside(x,y)?this.cells[y*this.width+x]:1; }
    set(x,y,value) { if(this.inside(x,y)){this.cells[y*this.width+x]=value;this.revision++;const source=this.planningSource||this;source.geometryRevision=(source.geometryRevision||0)+1;this.occupiedDirty=true;this.lastChange='geometry';} }
    rect(x,y,w,h,type) { for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)this.set(xx,yy,type); }
    circle(x,y,r,type) { for(let yy=Math.floor(y-r);yy<=Math.ceil(y+r);yy++)for(let xx=Math.floor(x-r);xx<=Math.ceil(x+r);xx++)if(Math.hypot(xx-x,yy-y)<=r)this.set(xx,yy,type); }
    risk(x,y) {
      const field=zones=>clamp(zones.reduce((sum,z)=>sum+z.amplitude*Math.exp(-2*((x-z.x)**2/z.rx**2+(y-z.y)**2/z.ry**2)),0),0,1);
      const covered=(this.relayCenters||[]).some(p=>Math.hypot(x-p.x,y-p.y)<=200/this.config.cellMeters);
      return {ground:clamp(field(this.crowds)+(this.scenario==='traffic'?0.75*this.traffic.risk(x,y):0),0,1),link:field(this.weakZones)*(covered?.35:1)};
    }
    // 只缓存同一世界版本的整数栅格查询，连续安全计算仍使用原始函数。
    planningCache(){const source=this.planningSource||this;if(!source._planningCache||source._planningCache.revision!==source.revision||source._planningCache.geometryRevision!==source.geometryRevision)source._planningCache={revision:source.revision,geometryRevision:source.geometryRevision,risks:new Array(source.width*source.height),blocked:new Uint8Array(source.width*source.height)};return source._planningCache;}
    planningRisk(x,y){const source=this.planningSource||this;if(!Number.isInteger(x)||!Number.isInteger(y)||!source.inside(x,y))return source.risk(x,y);const cache=this.planningCache(),index=y*source.width+x;return cache.risks[index]||(cache.risks[index]=source.risk(x,y));}
    planningBlocked(x,y){const source=this.planningSource||this;if(!source.inside(x,y))return true;if(!Number.isInteger(x)||!Number.isInteger(y))return source.blocked(x,y);const cache=this.planningCache(),index=y*source.width+x;if(!cache.blocked[index])cache.blocked[index]=source.blocked(x,y)?2:1;return cache.blocked[index]===2;}
    // 保守的一格 Chebyshev 膨胀。物理安全圈使用 0.32 格，规划留有额外裕量。
    blocked(x,y) {
      if(!this.inside(x,y))return true;
      for(let yy=y-1;yy<=y+1;yy++)for(let xx=x-1;xx<=x+1;xx++)if(this.inside(xx,yy)&&this.get(xx,yy))return true;
      return false;
    }
    segmentClear(a,b,r=this.config.safetyRadius) {
      if([a,b].some(p=>p.x<-0.5+r||p.y<-0.5+r||p.x>this.width-0.5-r||p.y>this.height-0.5-r))return false;
      const x0=Math.max(0,Math.floor(Math.min(a.x,b.x)-r-1)),x1=Math.min(this.width-1,Math.ceil(Math.max(a.x,b.x)+r+1));
      const y0=Math.max(0,Math.floor(Math.min(a.y,b.y)-r-1)),y1=Math.min(this.height-1,Math.ceil(Math.max(a.y,b.y)+r+1));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(this.get(x,y)&&segmentRect(a,b,x-0.5-r,y-0.5-r,x+0.5+r,y+0.5+r))return false;
      return true;
    }
    intruderAt(item,t) {
      const length=distance(item.a,item.b),elapsed=Math.max(0,t-(item.born||0)),u=(elapsed*item.speed)%(length*2),fraction=(u<=length?u:length*2-u)/length;
      return {x:item.a.x+(item.b.x-item.a.x)*fraction,y:item.a.y+(item.b.y-item.a.y)*fraction,radius:item.radius,name:item.name,altitude:item.altitude??this.config.altitude};
    }
    relevantIntruders() {return this.intruders.filter(o=>Math.abs((o.altitude??this.config.altitude)-this.config.altitude)<(this.config.verticalTolerance??8));}
    sensedIntruders(pos,t) { return this.relevantIntruders().filter(o=>distance(pos,this.intruderAt(o,t))<=this.config.sensorRadius); }
    predictedBlocker(pos,t) {
      const CONFIG=this.config;
      const points=[];
      for(const o of this.sensedIntruders(pos,t))for(let dt=0;dt<=CONFIG.predictionSeconds+0.01;dt+=0.2)points.push(this.intruderAt(o,t+dt));
      return (x,y)=>points.some(p=>Math.hypot(x-p.x,y-p.y)<p.radius+CONFIG.safetyRadius+0.55);
    }
    closestClearance(pos,t) {
      const CONFIG=this.config;
      let best=Math.min(pos.x+0.5,pos.y+0.5,this.width-0.5-pos.x,this.height-0.5-pos.y)-CONFIG.safetyRadius;
      if(this.occupiedDirty||!this.occupied){this.occupied=[];for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++)if(this.get(x,y))this.occupied.push({x,y});this.occupiedDirty=false;}
      for(const {x,y}of this.occupied)best=Math.min(best,Math.hypot(Math.max(Math.abs(pos.x-x)-.5,0),Math.max(Math.abs(pos.y-y)-.5,0))-CONFIG.safetyRadius);
      for(const o of this.relevantIntruders()){const p=this.intruderAt(o,t);best=Math.min(best,distance(pos,p)-p.radius-CONFIG.safetyRadius);}
      return best*CONFIG.cellMeters;
    }
  }
  return {CONFIG,World,distance,clamp,segmentRect,minRelativeDistance};
});
