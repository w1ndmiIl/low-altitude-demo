(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LowAirPriorityTraffic=api;})(globalThis,function(){
  'use strict';
  // Local motion ordering, separate from A* and the non-preemptive facility locks.
  function separation(a0,a1,b0,b1){const x=a0.x-b0.x,y=a0.y-b0.y,vx=a1.x-a0.x-b1.x+b0.x,vy=a1.y-a0.y-b1.y+b0.y,t=Math.max(0,Math.min(1,-(x*vx+y*vy)/(vx*vx+vy*vy||1)));return Math.hypot(x+t*vx,y+t*vy)*25;}
  function order(a,b,policy){return Number(!!b.sim.returning)-Number(!!a.sim.returning)||(policy==='priority'?(b.task?.priority||0)-(a.task?.priority||0):0)||(a.task?.createdAt||0)-(b.task?.createdAt||0)||a.id.localeCompare(b.id);}
  function plan(actors,blocked=new Map(),policy='priority'){
    const holds=new Map(),admitted=[];
    const flying=actors.filter(a=>a.status==='FLYING'&&a.task&&a.sim&&a.sim.index<a.sim.route.length&&!blocked.get(a.id)&&!a.sim.link?.forced&&a.sim.state!=='COMM_HOLD'&&a.sim.time>=a.sim.navLostUntil).sort((a,b)=>order(a,b,policy));
    for(const a of flying){const next=a.sim.futurePosition(5),conflict=admitted.find(b=>Math.abs(a.altitude-b.altitude)<(a.heightRadius||2)+(b.heightRadius||2)+6&&separation(a.position,next,b.position,b.sim.futurePosition(5))<Math.max(25,(a.profile?.radius||2)+(b.profile?.radius||2)+10)&&separation(a.position,a.position,b.position,b.sim.futurePosition(5))>=(a.profile?.radius||2)+(b.profile?.radius||2)+5);
      if(conflict){holds.set(a.id,{actor:conflict.id,priority:conflict.task.priority,reason:conflict.sim.returning?'让行安全返航 '+conflict.id:policy==='priority'&&conflict.task.priority>a.task.priority?'让行高优先级 '+conflict.id+' · P'+conflict.task.priority:'同级航段顺序让行 '+conflict.id});}
      else admitted.push(a);
    }
    return holds;
  }
  return {plan,separation,order};
});
