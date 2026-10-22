(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LowAirTraffic=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // 成员 4：道路微观交通。车辆按车道运动，红灯停车，同车道跟车。
  const roads={horizontal:[2,15,26],vertical:[1,19,37]};
  class Traffic {
    constructor(count=42){this.time=0;this.cars=[];this.density=new Float32Array(40*28);this.congested=false;this.reset(count);}
    reset(count){this.cars=[];for(let i=0;i<count;i++){const axis=i%2?'z':'x',list=axis==='x'?roads.horizontal:roads.vertical,road=list[Math.floor(i/2)%list.length],direction=Math.floor(i/6)%2?1:-1,length=axis==='x'?40:28;this.cars.push({id:i,axis,road,direction,p:((i*7.137+Math.floor(i/12)*3.2)%length),v:0,desired:0.8+(i%7)*0.10,color:i%7});}this.snapshot();}
    signal(axis,t=this.time){const phase=t%18;if(axis==='x')return phase<7?'green':phase<8?'amber':'red';return phase>=9&&phase<16?'green':phase>=16&&phase<17?'amber':'red';}
    position(car){return car.axis==='x'?{x:car.p,y:car.road+car.direction*0.25}:{x:car.road-car.direction*0.25,y:car.p};}
    step(dt){
      this.time+=dt;const next=[];
      for(const c of this.cars){const len=c.axis==='x'?40:28,intersections=c.axis==='x'?roads.vertical:roads.horizontal;
        let maxV=c.desired,limit=Infinity;
        for(const other of this.cars){if(c===other||c.axis!==other.axis||c.road!==other.road||c.direction!==other.direction)continue;const gap=((other.p-c.p)*c.direction+len)%len;if(gap<8){const free=Math.max(0,gap-1.05);maxV=Math.min(maxV,Math.sqrt(2*1.3*free),other.v+free*0.65);limit=Math.min(limit,free);}}
        if(this.signal(c.axis)!=='green')for(const intersection of intersections){const d=(intersection-c.p)*c.direction;if(d>0.6){const free=Math.max(0,d-1.0);maxV=Math.min(maxV,Math.sqrt(2*1.5*free));limit=Math.min(limit,free);}}
        if(this.congested&&c.axis==='x'&&c.road===15&&c.p>13&&c.p<29)maxV=Math.min(maxV,0.12);
        const v=c.v+Math.max(-2*dt,Math.min(0.65*dt,maxV-c.v)),travel=Math.min(Math.max(0,v)*dt,limit);
        next.push({c,v:travel<Math.max(0,v)*dt?0:Math.max(0,v),p:(c.p+c.direction*travel+len)%len});
      }
      for(const n of next){n.c.v=n.v;n.c.p=n.p;}
    }
    snapshot(){this.density.fill(0);for(const c of this.cars){const p=this.position(c),factor=c.v<0.2?1.6:0.9;for(let y=Math.max(0,Math.floor(p.y-4));y<=Math.min(27,Math.ceil(p.y+4));y++)for(let x=Math.max(0,Math.floor(p.x-4));x<=Math.min(39,Math.ceil(p.x+4));x++)this.density[y*40+x]+=0.16*factor*Math.exp(-((x-p.x)**2+(y-p.y)**2)/5);}for(let i=0;i<this.density.length;i++)this.density[i]=Math.min(1,this.density[i]);}
    risk(x,y){const ix=Math.max(0,Math.min(39,Math.round(x))),iy=Math.max(0,Math.min(27,Math.round(y)));return this.density[iy*40+ix];}
    summary(){return {time_s:+this.time.toFixed(2),cars:this.cars.length,stopped:this.cars.filter(c=>c.v<0.2).length,mean_speed_m_s:+(this.cars.reduce((s,c)=>s+c.v,0)/(this.cars.length||1)*5).toFixed(2),congested:this.congested};}
  }
  return {Traffic,roads};
});
