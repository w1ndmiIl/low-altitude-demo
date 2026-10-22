(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./geo-data.js'):root.LowAirGeoData);if(typeof module==='object'&&module.exports)module.exports=api;else root.LowAirGeo=api;})(globalThis,function(data){
  'use strict';
  const config=Object.freeze({width:256,height:144,centerX:-1300,centerZ:0,cellMeters:25,altitude:120,speed:12/25,safetyRadius:1.6/25,sensorRadius:90/25,predictionSeconds:2.2,holdSeconds:1.5,returnSeconds:4,lowBattery:20});
  const toGrid=p=>({x:(p[0]-config.centerX)/25+(config.width-1)/2,y:(p[1]-config.centerZ)/25+(config.height-1)/2});
  function inPolygon(x,y,points){let yes=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
  function intersectsBox(points,x0,y0,x1,y1){
    if(points.some(p=>p[0]>=x0&&p[0]<=x1&&p[1]>=y0&&p[1]<=y1))return true;
    if([[x0,y0],[x1,y0],[x1,y1],[x0,y1]].some(p=>inPolygon(p[0],p[1],points)))return true;
    for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];let lo=0,hi=1;for(const [p,q,min,max]of [[a[0],b[0],x0,x1],[a[1],b[1],y0,y1]]){const d=q-p;if(Math.abs(d)<1e-9){if(p<min||p>max){lo=2;break;}}else{const s=(min-p)/d,t=(max-p)/d;lo=Math.max(lo,Math.min(s,t));hi=Math.min(hi,Math.max(s,t));}}if(lo<=hi)return true;}return false;
  }
  class GeoTraffic {
    constructor(count=96){this.time=0;this.cars=[];this.edges=[];this.outgoing=new Map();this.signalNodes=new Set(data.signals.map(s=>s.id));this.density=new Float32Array(config.width*config.height);this.congested=false;this.closedTunnel=false;
      const allowed=new Set(['primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','unclassified','service','trunk','trunk_link']);
      for(const road of data.roads.filter(r=>allowed.has(r.kind))){const total=road.points.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-road.points[i][0],p[1]-road.points[i][1]),0);let offset=0;for(let i=1;i<road.points.length;i++){const p=road.points[i-1],q=road.points[i],length=Math.hypot(q[0]-p[0],q[1]-p[1]);if(length<.3)continue;const make=(a,b,from,to,reversed=false)=>{const edge={id:this.edges.length,road,p:a,q:b,from,to,length,offset,total,reversed,heading:Math.atan2(b[0]-a[0],b[1]-a[1])};this.edges.push(edge);if(!this.outgoing.has(from))this.outgoing.set(from,[]);this.outgoing.get(from).push(edge);};if(!road.reverse)make(p,q,road.nodes[i-1],road.nodes[i]);if(!road.oneway||road.reverse)make(q,p,road.nodes[i],road.nodes[i-1],true);offset+=length;}}
      this.reset(count);
    }
    reset(count=96){this.cars=[];const arterial=this.edges.filter(e=>['primary','secondary','tertiary'].includes(e.road.kind)),tunnel=this.edges.filter(e=>e.road.name==='博奥隧道');for(let i=0;i<count;i++){const list=i<8&&tunnel.length?tunnel:arterial,edge=list[(i*37+11)%list.length];this.cars.push({id:i,edge,u:edge.length*((i*0.618)%1),p:0,v:0,next:null,turns:0,desired:Math.min(14,edge.road.maxspeed/3.6),color:i%7});}this.snapshot();}
    routeTrip(from,to,edgeAllowed=()=>true){
      const coords=new Map();for(const e of this.edges){if(!edgeAllowed(e))continue;coords.set(e.from,e.p);coords.set(e.to,e.q);}if(!coords.size)return [];
      const nearest=point=>{let best=null,d=Infinity;for(const [id,p]of coords){const n=Math.hypot(p[0]-point[0],p[1]-point[1]);if(n<d){d=n;best=id;}}return best;};
      const start=nearest(from),target=nearest(to),Heap=(typeof require==='function'?require('./planner.js'):globalThis.LowAirPlanner).MinHeap,heap=new Heap(),cost=new Map([[start,0]]),parent=new Map(),closed=new Set();heap.push({node:start,f:0});
      while(heap.length){const n=heap.pop();if(closed.has(n.node))continue;closed.add(n.node);if(n.node===target){const result=[];for(let id=target;id!==start;){const e=parent.get(id);if(!e)return [];result.push(e);id=e.from;}return result.reverse();}
        for(const e of this.outgoing.get(n.node)||[]){if(!edgeAllowed(e))continue;const c=cost.get(n.node)+e.length/Math.min(14,e.road.maxspeed/3.6);if(c<(cost.get(e.to)??Infinity)){cost.set(e.to,c);parent.set(e.to,e);heap.push({node:e.to,f:c});}}
      }return [];
    }
    spawnTrip(from,to,name='跨江救护车',edgeAllowed=()=>true){
      const itinerary=this.routeTrip(from,to,edgeAllowed);if(!itinerary.length)return null;const edge=itinerary[0],car={id:1000+this.cars.length,edge,u:0,p:0,v:0,next:itinerary[1]||null,turns:0,desired:14,color:0,trip:true,itinerary,routeCursor:0,arrived:false,name,emergency:true,createdAt:this.time};this.cars.push(car);return car;
    }
    continueTrip(car,itinerary){
      if(!car?.trip||!car.arrived||!itinerary.length||car.edge.to!==itinerary[0].from)throw Error('Trip continuation must start at the arrived road node');
      car.itinerary=itinerary;car.edge=itinerary[0];car.u=car.p=car.v=0;car.next=itinerary[1]||null;car.routeCursor=0;car.arrived=false;car.arrivedAt=null;car.parked=false;
    }
    signal(axis,t=this.time){const phase=t%18;return axis==='x'?(phase<7?'green':phase<8?'amber':'red'):(phase>=9&&phase<16?'green':phase>=16&&phase<17?'amber':'red');}
    nextEdge(car){if(car.trip)return car.itinerary[car.routeCursor+1]||null;const choices=this.outgoing.get(car.edge.to)||[],forward=choices.filter(e=>e.to!==car.edge.from),list=forward.length?forward:choices;return list.length?list[(car.id*13+car.turns*7)%list.length]:null;}
    depth(car){if(!car.edge.road.tunnel)return car.edge.road.bridge?8:0;const s=car.edge.offset+(car.edge.reversed?car.edge.length-car.u:car.u),nearEnd=Math.min(s,car.edge.total-s);return -Math.min(18,nearEnd*.12);}
    position(car){const edge=car.edge,f=car.u/edge.length,x=edge.p[0]+(edge.q[0]-edge.p[0])*f,z=edge.p[1]+(edge.q[1]-edge.p[1])*f,offset=(edge.road.oneway?.8:1.65)+(car.parked?2.5:0);const p=toGrid([x+Math.cos(edge.heading)*offset,z-Math.sin(edge.heading)*offset]);return {...p,depth:this.depth(car)};}
    step(dt){this.time+=dt;const values=[];for(const car of this.cars){if(car.arrived)continue;if(!car.next)car.next=this.nextEdge(car);let desired=car.desired,limit=Infinity;for(const other of this.cars)if(other!==car&&!other.parked&&other.edge.id===car.edge.id&&other.u>car.u){const gap=Math.max(0,other.u-car.u-5.2);limit=Math.min(limit,gap);desired=Math.min(desired,Math.sqrt(3*gap),other.v+gap*.4);}
      const axis=Math.abs(car.edge.q[0]-car.edge.p[0])>Math.abs(car.edge.q[1]-car.edge.p[1])?'x':'z',toSignal=this.signalNodes.has(car.edge.to);
      if((toSignal&&this.signal(axis)!=='green')||(this.closedTunnel&&car.next?.road.tunnel&&!car.edge.road.tunnel)){const gap=Math.max(0,car.edge.length-car.u-4);limit=Math.min(limit,gap);desired=Math.min(desired,Math.sqrt(3*gap));}
      if(this.congested&&['博奥路','平澜路'].includes(car.edge.road.name))desired=Math.min(desired,1.6);
      const v=Math.max(0,car.v+Math.max(-3*dt,Math.min(1.2*dt,desired-car.v))),travel=Math.min(v*dt,limit);values.push({car,v:travel<v*dt?0:v,u:car.u+travel});}
      for(const n of values){const car=n.car;car.v=n.v;car.u=n.u;let guard=0;while(car.u>=car.edge.length&&guard++<8){if(car.trip&&car.routeCursor===car.itinerary.length-1){car.u=car.edge.length;car.v=0;car.arrived=true;car.arrivedAt=this.time;break;}car.u-=car.edge.length;if(car.trip)car.routeCursor++;car.edge=car.next||this.edges[(car.id*47+car.turns)%this.edges.length];car.turns++;car.next=this.nextEdge(car);}car.p=car.u;}
    }
    snapshot(){this.density.fill(0);for(const car of this.cars){const p=this.position(car);if(p.depth<-1||p.x<0||p.x>=config.width||p.y<0||p.y>=config.height)continue;const factor=car.v<1?1.8:1;for(let y=Math.max(0,Math.floor(p.y-3));y<=Math.min(config.height-1,Math.ceil(p.y+3));y++)for(let x=Math.max(0,Math.floor(p.x-3));x<=Math.min(config.width-1,Math.ceil(p.x+3));x++)this.density[y*config.width+x]+=0.24*factor*Math.exp(-((x-p.x)**2+(y-p.y)**2)/3);}for(let i=0;i<this.density.length;i++)this.density[i]=Math.min(1,this.density[i]);}
    risk(x,y){const ix=Math.max(0,Math.min(config.width-1,Math.round(x))),iy=Math.max(0,Math.min(config.height-1,Math.round(y)));return this.density[iy*config.width+ix];}
    summary(){return {time_s:+this.time.toFixed(2),cars:this.cars.length,stopped:this.cars.filter(c=>c.v<.6).length,mean_speed_m_s:+(this.cars.reduce((s,c)=>s+c.v,0)/(this.cars.length||1)).toFixed(2),congested:this.congested,tunnel_cars:this.cars.filter(c=>c.edge.road.tunnel).length,closedTunnel:this.closedTunnel};}
  }
  function initialize(world,scenario){
    world.config=config;world.geo=data;world.width=config.width;world.height=config.height;world.cells=new Uint8Array(world.width*world.height);world.revision=0;world.start={x:140,y:110};world.goal={x:202,y:54};world.intruders=[];world.crowds=[{x:162,y:92,rx:15,ry:11,amplitude:1},{x:186,y:67,rx:10,ry:10,amplitude:.7}];world.weakZones=[{x:154,y:72,rx:16,ry:16,amplitude:1},{x:199,y:58,rx:14,ry:10,amplitude:.8}];world.traffic=new GeoTraffic();world.trafficSnapshotTime=0;
    for(const b of data.buildings){if(b.height+10<config.altitude)continue;const points=b.points.map(p=>{const q=toGrid(p);return [q.x,q.y];}),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);for(let y=Math.max(0,Math.floor(Math.min(...ys)));y<=Math.min(world.height-1,Math.ceil(Math.max(...ys)));y++)for(let x=Math.max(0,Math.floor(Math.min(...xs)));x<=Math.min(world.width-1,Math.ceil(Math.max(...xs)));x++)if(intersectsBox(points,x-.5,y-.5,x+.5,y+.5))world.set(x,y,1);}
    world.originalCells=world.cells.slice();const free=p=>{if(!world.blocked(p.x,p.y))return p;for(let radius=1;radius<15;radius++)for(let y=p.y-radius;y<=p.y+radius;y++)for(let x=p.x-radius;x<=p.x+radius;x++)if(world.inside(x,y)&&!world.blocked(x,y))return {x,y};throw new Error('No safe endpoint');};world.start=free(world.start);world.goal=free(world.goal);
    world.circle(215,91,2.5,2);
    if(scenario==='dynamic')world.intruders=[{name:'巡检无人机 B',a:{x:160,y:79},b:{x:173,y:82},speed:14/config.cellMeters,radius:2.5/config.cellMeters}];
    if(scenario==='blocked')world.rect(176,0,2,world.height,1);
    return world;
  }
  return {data,config,toGrid,inPolygon,intersectsBox,GeoTraffic,initialize};
});
