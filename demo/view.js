(function(root){
  'use strict';
  const W=root.LowAirWorld,P=root.LowAirPlanner;let C=W.CONFIG;
  class MapView {
    constructor(canvas,chart) {this.canvas=canvas;this.ctx=canvas.getContext('2d');this.chart=chart;this.terrain=null;this.cacheKey='';this.baseline=[];this.world=null;this.resetCamera();this.pointer();}
    resetCamera(){this.zoom=1;this.offset={x:0,y:0};this.didDrag=false;this.followSelected=false;}
    centerOn(p){const q=this.cellPoint(p);this.offset={x:this.canvas.width/2-q.x*this.zoom,y:this.canvas.height/2-q.y*this.zoom};}
    manualCamera(){this.followSelected=false;this.onManualCamera?.();}
    pixelHit(event){const r=this.canvas.getBoundingClientRect(),scale=Math.min(r.width/this.canvas.width,r.height/this.canvas.height),ox=(r.width-this.canvas.width*scale)/2,oy=(r.height-this.canvas.height*scale)/2;return {x:(event.clientX-r.left-ox)/scale,y:(event.clientY-r.top-oy)/scale};}
    pointer(){let down=null;this.canvas.style.touchAction='none';this.canvas.style.cursor='grab';
      this.canvas.addEventListener('pointerdown',e=>{if(e.button!==2&&this.isEditing?.())return;e.preventDefault();this.didDrag=false;down={...this.pixelHit(e),id:e.pointerId,moved:0};this.canvas.setPointerCapture(e.pointerId);});
      this.canvas.addEventListener('pointermove',e=>{if(!down)return;const p=this.pixelHit(e),dx=p.x-down.x,dy=p.y-down.y;down.moved+=Math.abs(dx)+Math.abs(dy);this.didDrag=down.moved>4;if(this.didDrag)this.manualCamera();this.offset.x+=dx;this.offset.y+=dy;down.x=p.x;down.y=p.y;});
      for(const type of ['pointerup','pointercancel','lostpointercapture'])this.canvas.addEventListener(type,()=>down=null);
      this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.manualCamera();const p=this.pixelHit(e),next=Math.max(.5,Math.min(8,this.zoom*Math.exp(-e.deltaY*.001)));this.offset.x=p.x-(p.x-this.offset.x)*next/this.zoom;this.offset.y=p.y-(p.y-this.offset.y)*next/this.zoom;this.zoom=next;},{passive:false});
      this.canvas.addEventListener('contextmenu',e=>e.preventDefault());
    }
    cellPoint(p) {return {x:(p.x+0.5)*this.canvas.width/C.width,y:(p.y+0.5)*this.canvas.height/C.height};}
    line(points,color,width=3,dash=[]) {
      if(points.length<2)return;const ctx=this.ctx;ctx.save();ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.lineCap='round';ctx.lineJoin='round';
      points.forEach((p,i)=>{const q=this.cellPoint(p);if(!i)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);});ctx.stroke();ctx.restore();
    }
    cacheTerrain(world,settings) {
      const source=world.planningSource||world,key=[settings.risk?world.revision:(source.geometryRevision||0),settings.risk,settings.buffer].join(':');
      const baselineKey=[source.geometryRevision||0,world.start.x,world.start.y,world.goal.x,world.goal.y].join(':');if(settings.baseline&&(this.baselineSource!==source||baselineKey!==this.baselineKey)){this.baseline=P.astar({width:C.width,height:C.height,start:world.start,goal:world.goal,blocked:(x,y)=>world.planningBlocked(x,y)}).path;this.baselineKey=baselineKey;this.baselineSource=source;}
      if(this.world===source&&key===this.cacheKey)return;
      this.world=source;this.cacheKey=key;this.terrain=document.createElement('canvas');this.terrain.width=this.canvas.width;this.terrain.height=this.canvas.height;
      const ctx=this.terrain.getContext('2d'),s=this.canvas.width/C.width;
      ctx.fillStyle='#f5f9f8';ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
      for(let y=0;y<C.height;y++)for(let x=0;x<C.width;x++) {
        const risk=settings.risk?world.planningRisk(x,y):null;
        if(settings.risk){if(risk.ground>0.015){ctx.fillStyle=`rgba(231,147,64,${risk.ground*0.48})`;ctx.fillRect(x*s,y*s,s,s);}if(risk.link>0.02){ctx.fillStyle=`rgba(80,127,196,${risk.link*0.30})`;ctx.fillRect(x*s,y*s,s,s);}}
        if(settings.buffer&&!world.get(x,y)&&world.planningBlocked(x,y)){ctx.fillStyle='rgba(153,174,180,0.13)';ctx.fillRect(x*s,y*s,s,s);}
      }
      ctx.lineWidth=0.7;ctx.strokeStyle='#c5d4d64d';ctx.beginPath();
      for(let x=0;x<=C.width;x++){ctx.moveTo(x*s,0);ctx.lineTo(x*s,this.canvas.height);}for(let y=0;y<=C.height;y++){ctx.moveTo(0,y*s);ctx.lineTo(this.canvas.width,y*s);}ctx.stroke();
      for(let y=0;y<C.height;y++)for(let x=0;x<C.width;x++) {const type=world.get(x,y);if(!type)continue;ctx.fillStyle=type===2?'#d7747aaa':type===3?'#cc8559':'#91a5ad';ctx.fillRect(x*s+1,y*s+1,s-2,s-2);if(type===2){ctx.strokeStyle='#a54d5366';ctx.beginPath();ctx.moveTo(x*s+4,y*s+4);ctx.lineTo((x+1)*s-4,(y+1)*s-4);ctx.stroke();}if(type===1){ctx.fillStyle='#b1c1c5';ctx.fillRect(x*s+4,y*s+4,s-10,3);}}
    }
    marker(p,label,color) {const q=this.cellPoint(p),ctx=this.ctx;ctx.save();ctx.fillStyle='#fff';ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();ctx.arc(q.x,q.y,14,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle=color;ctx.font='bold 12px Microsoft YaHei, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,q.x,q.y);ctx.restore();}
    drone(p,color,heading=0,size=13) {
      const q=this.cellPoint(p),ctx=this.ctx;ctx.save();ctx.translate(q.x,q.y);ctx.rotate(heading);ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-size,-size);ctx.lineTo(size,size);ctx.moveTo(-size,size);ctx.lineTo(size,-size);ctx.stroke();
      for(const x of [-size,size])for(const y of [-size,size]){ctx.beginPath();ctx.arc(x,y,size*0.42,0,Math.PI*2);ctx.fillStyle='#ffffffeb';ctx.fill();ctx.stroke();}
      ctx.fillStyle=color;ctx.fillRect(-6,-8,12,16);ctx.fillStyle='#fff';ctx.fillRect(-2,-6,4,4);ctx.restore();
    }
    aircraft(actor,color,heading,size){if(!actor.aircraftType||actor.aircraftType==='uav')return this.drone(actor.position,color,heading,size);const q=this.cellPoint(actor.position),ctx=this.ctx;ctx.save();ctx.translate(q.x,q.y);ctx.rotate(heading);ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=2/this.zoom;ctx.beginPath();ctx.ellipse(0,0,size*.45,size,0,0,Math.PI*2);ctx.fill();if(actor.aircraftType==='helicopter'){ctx.fillRect(-size*.1,size*.7,size*.2,size*1.25);ctx.beginPath();ctx.moveTo(-size*1.35,0);ctx.lineTo(size*1.35,0);ctx.moveTo(0,-size*1.35);ctx.lineTo(0,size*1.35);ctx.stroke();}else{ctx.fillRect(-size*1.6,-size*.15,size*3.2,size*.30);ctx.fillRect(-size*.8,size*.8,size*1.6,size*.18);}ctx.fillStyle='#fff';ctx.fillRect(-size*.18,-size*.6,size*.36,size*.3);ctx.restore();}
    actorAt(event){if(!this.operations)return null;const p=this.pixelHit(event);let chosen=null,best=24;for(const a of this.operations.actors){const q=this.cellPoint(a.position),d=Math.hypot(q.x*this.zoom+this.offset.x-p.x,q.y*this.zoom+this.offset.y-p.y);if(d<best){best=d;chosen=a.id;}}return chosen;}
    bird(p,color){const q=this.cellPoint(p),ctx=this.ctx;ctx.save();ctx.translate(q.x,q.y);ctx.strokeStyle=color;ctx.lineWidth=2.5/this.zoom;ctx.beginPath();ctx.moveTo(-11/this.zoom,-3/this.zoom);ctx.quadraticCurveTo(-5/this.zoom,-9/this.zoom,0,0);ctx.quadraticCurveTo(5/this.zoom,-9/this.zoom,11/this.zoom,-3/this.zoom);ctx.stroke();ctx.restore();}
    drawFleet(ops){const ctx=this.ctx;for(const actor of [...ops.actors.filter(a=>a.id!==ops.selectedId),ops.selected]){const selected=actor.id===ops.selectedId,q=this.cellPoint(actor.position),next=actor.sim?.route[actor.sim.index]||actor.position,heading=Math.atan2(next.y-actor.position.y,next.x-actor.position.x)+Math.PI/2;
      if(actor.status==='FLYING'&&(selected||this.showFleetRoutes))this.line([actor.position,...(actor.sim?.route.slice(actor.sim.index)||[])],selected?'#e6a400':actor.color+'60',(selected?5:1.3)/this.zoom);
      if(selected){ctx.save();ctx.strokeStyle='#ffc933';ctx.lineWidth=4/this.zoom;ctx.fillStyle='#fff5c440';ctx.beginPath();ctx.arc(q.x,q.y,25/this.zoom,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();}
      this.aircraft(actor,selected?'#b97900':actor.color,heading,(selected?13:6)/this.zoom);ctx.save();ctx.font=`bold ${(selected?15:11)/this.zoom}px Microsoft YaHei,sans-serif`;ctx.fillStyle=selected?'#775000':'#284652';ctx.fillText(selected?actor.id+' '+actor.name:actor.id,q.x+18/this.zoom,q.y-13/this.zoom);ctx.restore();
    }
      const focus=ops.incidents.find(i=>i.id===this.focusIncidentId);if(focus){const q=this.cellPoint(focus.position),color=focus.status==='RESOLVED'?'#168f70':'#e56b35';ctx.save();ctx.strokeStyle=color;ctx.lineWidth=3/this.zoom;ctx.beginPath();ctx.arc(q.x,q.y,16/this.zoom,0,Math.PI*2);ctx.stroke();ctx.fillStyle=color;ctx.font=`bold ${13/this.zoom}px Microsoft YaHei,sans-serif`;ctx.fillText(focus.id+' '+({fire:'火情',rescue:'求救',medical:'交接点',relay:'中继',evacuation:'人员接运'}[focus.type]),q.x+19/this.zoom,q.y+18/this.zoom);if(focus.groundCar){const car=this.cellPoint(ops.world.traffic.position(focus.groundCar));ctx.fillStyle='#147fbd';ctx.fillRect(car.x-5/this.zoom,car.y-4/this.zoom,10/this.zoom,8/this.zoom);ctx.fillText(focus.localDelivery?(focus.localDelivery.stage==='DELIVERING'?'江北末端配送':'江北接驳车'):'地面接应',car.x+9/this.zoom,car.y-7/this.zoom);if(focus.localDelivery?.destination){const dest=this.cellPoint(focus.localDelivery.destination);ctx.strokeStyle='#357b65';ctx.strokeRect(dest.x-8/this.zoom,dest.y-8/this.zoom,16/this.zoom,16/this.zoom);ctx.fillText('江北需求点',dest.x+12/this.zoom,dest.y);}}ctx.restore();}
    }
    draw(sim,settings) {
      C=sim.config;const height=Math.round(this.canvas.width*C.height/C.width);if(this.canvas.height!==height)this.canvas.height=height;if(this.followSelected)this.centerOn(this.operations?.selected.position||sim.pos);
      const ctx=this.ctx,s=this.canvas.width/C.width;this.cacheTerrain(sim.world,settings);ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#edf3f2';ctx.fillRect(0,0,this.canvas.width,this.canvas.height);ctx.setTransform(this.zoom,0,0,this.zoom,this.offset.x,this.offset.y);ctx.drawImage(this.terrain,0,0);
      if(settings.risk){ctx.font='12px Microsoft YaHei, sans-serif';ctx.fillStyle='#996028';const a=sim.world.crowds[0];ctx.fillText(sim.world.geo?'人口风险（仿真）':'人口密集区',(a.x-3)*s,a.y*s);ctx.fillStyle='#557cb0';for(const zone of sim.world.weakZones)ctx.fillText('通信弱覆盖',(zone.x-2)*s,(zone.y-1)*s);}
      if(settings.baseline)this.line(this.baseline,'#607b8788',2,[7,7]);
      this.line(sim.initialRoute,'#07948033',2,[3,7]);this.line([sim.pos,...sim.route.slice(sim.index)],sim.returning?'#377fb4':'#008e79',4);this.line(sim.trace,'#728fa6',3);
      for(const o of sim.world.relevantIntruders()) {
        const pos=sim.world.intruderAt(o,sim.time),near=W.distance(pos,sim.pos)<C.sensorRadius,points=[];
        for(let dt=0;dt<=C.predictionSeconds+0.01;dt+=0.2)points.push(sim.world.intruderAt(o,sim.time+dt));
        if(near){this.line(points,'#9762b76b',Math.max(10,(o.radius+C.safetyRadius)*s*2));this.line(points,'#9160b8',2,[5,5]);}
        if(o.type==='bird')this.bird(pos,'#98633d');else this.drone(pos,'#9566b4',0,11);const q=this.cellPoint(pos);ctx.fillStyle='#81529e';ctx.font='11px Microsoft YaHei, sans-serif';ctx.fillText(o.type==='bird'?'鸟群':o.name||'移动障碍',q.x+18,q.y-15);
      }
      this.marker(sim.world.start,'S','#087f71');this.marker(sim.world.goal,'G','#397b9e');
      const q=this.cellPoint(sim.pos);ctx.save();ctx.strokeStyle='#087f7120';ctx.lineWidth=1;ctx.setLineDash([4,6]);ctx.beginPath();ctx.arc(q.x,q.y,C.sensorRadius*s,0,Math.PI*2);ctx.stroke();ctx.restore();
      if(this.operations)this.drawFleet(this.operations);else{const target=sim.route[sim.index]||sim.pos,heading=Math.atan2(target.y-sim.pos.y,target.x-sim.pos.x)+Math.PI/2;
        ctx.fillStyle='#087f711c';ctx.beginPath();ctx.arc(q.x,q.y,24,0,Math.PI*2);ctx.fill();this.drone(sim.pos,sim.returning?'#397b9e':'#087f71',heading);
        ctx.fillStyle='#193c46';ctx.font='bold 11px Microsoft YaHei, sans-serif';ctx.fillText('配送无人机 A',q.x+24,q.y+5);}
      if(settings.chart!==false)this.drawChart(sim);
    }
    drawChart(sim) {
      const ctx=this.chart.getContext('2d'),w=this.chart.width,h=this.chart.height;ctx.clearRect(0,0,w,h);ctx.strokeStyle='#dbe5e8';ctx.lineWidth=1;
      for(const y of [20,h/2,h-12]){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
      const samples=sim.telemetry,limit=Math.max(25,sim.time);if(!samples.length)return;
      for(const [key,max,color] of [['battery',100,'#087f71'],['linkQuality',1,'#478cae']]){ctx.beginPath();ctx.lineWidth=3;ctx.strokeStyle=color;samples.forEach((p,i)=>{const x=p.t/limit*(w-4),y=h-12-p[key]/max*(h-32);if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();}
    }
    hit(event) {
      const p=this.pixelHit(event);return {x:Math.floor((p.x-this.offset.x)/this.zoom/this.canvas.width*C.width),y:Math.floor((p.y-this.offset.y)/this.zoom/this.canvas.height*C.height)};
    }
  }
  root.LowAirView={MapView};
})(globalThis);
