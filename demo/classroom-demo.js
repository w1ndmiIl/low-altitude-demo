(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LowAirClassroom=api;
})(globalThis,function(){
  'use strict';
  const automaticLimitSeconds=90;
  const steps=[
    {id:'overview',title:'日常运营',caption:'先观察物流、巡逻与客运运行，再向同一城市加入应急任务。',seconds:20,minimum:20,maximum:20},
    {id:'queue',title:'人员转运任务入队',caption:'发布2人转运任务，查看实际派单记录。',seconds:3},
    {id:'filter',title:'候选条件筛选',caption:'检查任务能力、设施兼容与能源预算。',seconds:3},
    {id:'compare',title:'候选代价比较',caption:'比较两架直升机的路径成本与惩罚项。',seconds:4},
    {id:'result',title:'确认派单结果',caption:'选定执行者后，仍需申请场站和航路。',seconds:3},
    {id:'takeoff',title:'人员转运与优先通行',caption:'转运任务进入执行；日常任务按资源和安全条件继续推进。',minimum:10,maximum:10,running:true},
    {id:'fire',title:'叠加消防支援',caption:'同一时间线出现火情，观察应急出动和日常机队的实际状态。',minimum:10,maximum:10,running:true},
    {id:'medical',title:'跨江协同与交接',caption:'飞机跨江急送物资；江北车辆到站接货，再在江北完成末端配送。',minimum:28,maximum:28,running:true},
    {id:'summary',title:'演示结束',caption:'按实际记录查看已完成和仍在执行的任务。',seconds:7}
  ];
  const chapters=[{title:'日常运营',steps:['overview']},{title:'应急派单',steps:['queue','filter','compare','result']},{title:'优先通行',steps:['takeoff']},{title:'消防加入',steps:['fire']},{title:'跨江协同',steps:['medical']},{title:'运营回顾',steps:['summary']}];
  class Controller {
    constructor(hooks){this.hooks=hooks;this.active=false;this.paused=false;this.index=-1;this.elapsed=0;this.stageElapsed=0;this.history=[];this.message='';this.mode='manual';this.ready=false;this.result=null;this.lastRenderedSecond=0;}
    get step(){return steps[this.index]||null;}
    get continuous(){return this.mode==='live'||this.mode==='autolive';}
    get automatic(){return this.mode==='auto'||this.mode==='autolive';}
    get executing(){return !!this.step?.running||this.continuous&&this.step?.id==='overview';}
    get worldRunning(){return this.continuous||!!this.step?.running;}
    get minimumSeconds(){return this.executing?this.step?.minimum||0:this.step?.seconds||0;}
    get state(){return {active:this.active,paused:this.paused,index:this.index,step:this.step?.id,title:this.step?.title,caption:this.message||this.step?.caption,elapsed:this.elapsed,stageElapsed:this.stageElapsed,minimumSeconds:this.minimumSeconds,limitSeconds:this.automatic?automaticLimitSeconds:null,history:this.history.slice(),mode:this.mode,ready:this.ready,result:this.result?{...this.result}:null};}
    start({mode='manual'}={}){
      if(this.active)this.stop();
      this.mode=['live','auto','autolive'].includes(mode)?mode:'manual';this.hooks.prepare(this.mode);this.active=true;this.paused=false;this.index=-1;this.elapsed=0;this.stageElapsed=0;this.history=[];this.message='';this.ready=false;this.result=null;this.advance();
    }
    advance(){
      if(this.result)this.history.push({step:this.step.id,...this.result});
      this.index++;this.stageElapsed=0;this.lastRenderedSecond=0;
      if(!this.step){this.stop('标准流程演示结束。');return;}
      this.ready=!this.automatic&&!this.executing;this.result=null;
      this.hooks.setRunning(this.worldRunning);
      this.hooks.enter(this.step.id);
      this.hooks.render(this.state);
    }
    tick(seconds){
      if(!this.active||this.paused||!Number.isFinite(seconds)||seconds<=0)return;
      if(!this.hooks.isCurrent()){this.stop('场景已切换，标准流程演示已退出。');return;}
      if(this.ready){if(this.continuous&&this.result?.timedOut&&this.hooks.complete(this.step.id)){this.result={complete:true,timedOut:false};this.hooks.render(this.state);}return;}
      this.elapsed+=seconds;this.stageElapsed+=seconds;
      if(this.automatic&&Math.floor(this.stageElapsed)!==this.lastRenderedSecond){this.lastRenderedSecond=Math.floor(this.stageElapsed);this.hooks.render(this.state);}
      const step=this.step;
      if(this.automatic&&this.elapsed>=automaticLimitSeconds){
        this.elapsed=automaticLimitSeconds;
        if(this.executing){const complete=!!this.hooks.complete(step.id);this.history.push({step:step.id,complete,timedOut:!complete});}
        this.stop(this.hooks.summary()+' 自动演示已按90秒预算结束，运行结果按当前记录显示。',{keepRunning:this.continuous});return;
      }
      if(this.executing){
        if(this.stageElapsed<this.minimumSeconds)return;
        const complete=this.hooks.complete(step.id);
        if(!complete&&this.stageElapsed<step.maximum)return;
        this.result={complete:!!complete,timedOut:!complete};
      }else if(this.stageElapsed<step.seconds)return;
      if(!this.automatic){this.ready=true;if(!this.continuous)this.hooks.setRunning(false);this.hooks.render(this.state);return;}
      if(step.id==='summary'){this.stop(this.hooks.summary(),{keepRunning:this.continuous});return;}
      this.advance();
    }
    togglePause(){
      if(!this.active||this.ready&&!this.continuous)return;
      this.paused=!this.paused;this.hooks.setRunning(!this.paused&&this.worldRunning);this.hooks.render(this.state);
    }
    pause(){if(this.active&&!this.paused)this.togglePause();}
    next(){if(!this.active||this.paused||!this.ready)return false;if(this.step.id==='summary')this.stop(this.hooks.summary(),{keepRunning:this.continuous});else this.advance();return true;}
    watchAgain(){if(!this.active||this.paused||!this.ready||!this.result?.timedOut)return false;this.ready=false;this.result=null;this.stageElapsed=0;this.hooks.setRunning(true);this.hooks.render(this.state);return true;}
    stop(message='已退出标准流程演示，当前场景已暂停。',{keepRunning=false}={}){
      if(!this.active)return;
      this.hooks.setRunning(keepRunning);this.active=false;this.paused=false;this.ready=false;this.message=message;this.hooks.release();this.hooks.render(this.state);
    }
  }
  return {Controller,steps,chapters,automaticLimitSeconds};
});
