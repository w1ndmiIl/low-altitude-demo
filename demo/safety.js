(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LowAirSafety=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // 成员 5：可复现的心跳链路模型与异常决策。参数为教学设定。
  class HeartbeatLink {
    constructor(seed=42) { this.seed=seed>>>0;this.lastReceived=0;this.nextSend=0;this.pending=[];this.sent=0;this.received=0;this.dropped=0;this.forced=false;this.quality=1;this.latency=80; }
    random() { this.seed=(Math.imul(1664525,this.seed)+1013904223)>>>0;return this.seed/4294967296; }
    tick(t,weakRisk) {
      this.quality=this.forced?0:1-0.6*weakRisk;this.latency=80+450*weakRisk;
      if(this.forced)this.pending=[];
      while(this.nextSend<=t+1e-9) {
        this.sent++;
        if(this.forced||this.random()<0.02+0.28*weakRisk)this.dropped++;
        else this.pending.push(this.nextSend+this.latency/1000);
        this.nextSend+=0.5;
      }
      this.pending=this.pending.filter(due=>{if(due<=t){this.lastReceived=Math.max(this.lastReceived,due);this.received++;return false;}return true;});
      return t-this.lastReceived;
    }
    lossRate() { return this.sent?this.dropped/this.sent:0; }
  }
  // 一旦返航已触发就锁定，恢复通信不会自动恢复配送。
  function decision({battery,age,returning},config) {
    if(battery<=0)return 'LAND';
    if(returning)return 'RETURN';
    if(battery<=config.lowBattery||age>=config.returnSeconds)return 'RETURN';
    if(age>=config.holdSeconds)return 'HOLD';
    return 'MISSION';
  }
  return {HeartbeatLink,decision};
});
