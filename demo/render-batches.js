(function(root){
  'use strict';const T=root.THREE,colors=['#e5ebea','#ae3535','#286c93','#dfb844','#6a7088','#263944','#d6d8d4'];
  class Cars {
    constructor(city){this.city=city;this.parts=[];this.capacity=0;this.matrix=new T.Matrix4();this.prototype=city.carModel(0);this.prototype.updateMatrixWorld(true);this.prototypeParts=[];this.prototype.traverse(o=>{if(o.isMesh)this.prototypeParts.push(o);});}
    resize(count){if(count<=this.capacity)return;for(const b of this.parts){this.city.dynamicGroup.remove(b);b.material.dispose();}this.capacity=2**Math.ceil(Math.log2(Math.max(128,count)));this.parts=this.prototypeParts.map(p=>{const material=p.material.clone();if(p.material===this.prototype.userData.bodyMaterial)material.color.set('#ffffff');const b=new T.InstancedMesh(p.geometry,material,this.capacity);b.instanceMatrix.setUsage(T.DynamicDrawUsage);b.frustumCulled=false;b.receiveShadow=true;b.userData.body=p.material===this.prototype.userData.bodyMaterial;this.city.dynamicGroup.add(b);return b;});}
    update(traffic,project){const city=this.city;this.resize(traffic.cars.length);while(city.cars.length<traffic.cars.length){const g=new T.Group();g.userData.bodyMaterial={color:new T.Color()};city.cars.push(g);}for(const b of this.parts)b.count=traffic.cars.length;
      for(let i=0;i<traffic.cars.length;i++){const car=traffic.cars[i],g=city.cars[i],q=traffic.position(car),p=project(q);p.y=q.depth||0;g.position.copy(p);g.rotation.y=car.edge?car.edge.heading:car.axis==='x'?(car.direction>0?Math.PI/2:-Math.PI/2):(car.direction>0?0:Math.PI);g.updateMatrix();g.userData.bodyMaterial.color.set(car.emergency?'#f4f4ed':colors[i%colors.length]);
        for(let j=0;j<this.parts.length;j++){const batch=this.parts[j];this.matrix.multiplyMatrices(g.matrix,this.prototypeParts[j].matrixWorld);batch.setMatrixAt(i,this.matrix);if(batch.userData.body)batch.setColorAt(i,g.userData.bodyMaterial.color);}
        if(car.emergency&&!g.userData.emergencyGroup){const mark=new T.Group(),red=new T.MeshBasicMaterial({color:'#cf4338'});const beacon=city.box(1,.2,.4,red,0,2,0,mark);city.box(.8,.04,.2,red,0,1.85,-.5,mark);city.box(.2,.04,.8,red,0,1.85,-.5,mark);mark.traverse(o=>o.castShadow=false);city.dynamicGroup.add(mark);g.userData.emergencyGroup=mark;g.userData.beacon=beacon;}
        if(g.userData.emergencyGroup){g.userData.emergencyGroup.visible=!!car.emergency;g.userData.emergencyGroup.position.copy(g.position);g.userData.emergencyGroup.rotation.copy(g.rotation);g.userData.beacon.visible=Math.sin(traffic.time*10)>0;}
      }
      for(const b of this.parts){b.instanceMatrix.needsUpdate=true;if(b.instanceColor)b.instanceColor.needsUpdate=true;}
    }
  }
  class Signals {
    constructor(city,items){this.items=items;this.states='';this.poles=new T.InstancedMesh(new T.BoxGeometry(.28,5,.28),city.materials.metal,items.length);this.lights=new T.InstancedMesh(new T.SphereGeometry(.32,6,5),new T.MeshBasicMaterial({color:'#ffffff'}),items.length*3);const transform=new T.Object3D();for(let n=0;n<items.length;n++){const [x,z]=items[n].point;transform.position.set(x,2.5,z);transform.updateMatrix();this.poles.setMatrixAt(n,transform.matrix);for(let i=0;i<3;i++){transform.position.set(x,5.2-i*.75,z);transform.updateMatrix();this.lights.setMatrixAt(n*3+i,transform.matrix);this.lights.setColorAt(n*3+i,new T.Color('#26313a'));}}city.staticGroup.add(this.poles,this.lights);}
    update(traffic){const states=traffic.signal('x')+':'+traffic.signal('z');if(states===this.states)return;this.states=states;const color=new T.Color();for(let n=0;n<this.items.length;n++){const state=traffic.signal(Number(this.items[n].id)%2?'x':'z');for(let i=0;i<3;i++){const active=state===(['red','amber','green'][i]);this.lights.setColorAt(n*3+i,color.set(active?['#ff4330','#ffcc3b','#21e294'][i]:'#26313a'));}}this.lights.instanceColor.needsUpdate=true;}
  }
  class Aircraft {
    constructor(group){this.group=group;this.batches=[];this.key='';}
    update(fleet){const entries=[...fleet.values()],key=entries.map(e=>e.model.userData.actorId).join(',');if(key!==this.key){this.clear();this.key=key;const types=new Map();for(const e of entries){const type=e.model.userData.aircraftType||'uav';if(!types.has(type))types.set(type,[]);e.parts=[];e.model.traverse(o=>{if(o.isMesh)e.parts.push(o);});types.get(type).push(e);}for(const actors of types.values())actors[0].parts.forEach((part,j)=>{const material=part.material.clone();material.color.set('#ffffff');const mesh=new T.InstancedMesh(part.geometry.clone(),material,actors.length);mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.frustumCulled=false;mesh.receiveShadow=true;for(let i=0;i<actors.length;i++)mesh.setColorAt(i,actors[i].parts[j].material.color);this.group.add(mesh);this.batches.push({mesh,actors,j});});}
      for(const e of entries)e.model.updateMatrixWorld(true);const zero=new T.Matrix4().makeScale(0,0,0);for(const {mesh,actors,j}of this.batches){for(let i=0;i<actors.length;i++)mesh.setMatrixAt(i,actors[i].model.visible&&actors[i].parts[j].visible?actors[i].parts[j].matrixWorld:zero);mesh.instanceMatrix.needsUpdate=true;}
    }
    clear(){for(const {mesh}of this.batches){this.group.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}this.batches=[];this.key='';}
  }
  root.LowAirRender={Cars,Signals,Aircraft};
})(globalThis);
