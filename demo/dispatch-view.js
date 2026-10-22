(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LowAirDispatch=api;
})(globalThis,function(){
  'use strict';
  const steps=['任务入队','约束筛选','代价比较','派单结果'];
  const typeNames={uav:'无人机',helicopter:'直升机',evtol:'eVTOL'};
  const taskNames={parcel:'快递',food:'外卖',patrol:'巡逻',inspection:'巡检',routine_medical:'送样',supply:'补给',rescue:'物资救援',medical:'跨江医疗',fire:'消防',relay:'通信中继',passenger:'跨江客运',evacuation:'人员转运'};
  const statusNames={IDLE:'待命',FLYING:'飞行中',SERVICING:'现场作业',CHARGING:'补能',DISABLED:'安全停止',TAKEOFF:'起飞中',CLIMB:'爬升中',LANDING:'降落中',HOLD_LANDING:'等待降落',CHARGING_SERVICE:'落地补能'};
  const number=value=>Number.isFinite(value)?value.toFixed(1):'—';
  const executingActor=(operations,taskId)=>operations.actors.find(a=>a.task?.id===taskId);
  function summarize(decision){
    const candidates=decision?.candidates||[],eligible=candidates.filter(c=>c.cost!=null).slice().sort((a,b)=>a.cost-b.cost||(a.id===decision.chosen?-1:b.id===decision.chosen?1:0)),rejected=candidates.filter(c=>c.cost==null),groups=new Map();
    for(const c of rejected)groups.set(c.reason,(groups.get(c.reason)||0)+1);
    const winner=eligible.find(c=>c.id===decision?.chosen),runner=eligible.find(c=>c.id!==decision?.chosen);
    return {eligible,rejected,groups,winner,runner,gap:winner&&runner?runner.cost-winner.cost:null};
  }
  // The explainer is a frozen copy of an executed check, never a second scheduler.
  function snapshot(decision){return decision?JSON.parse(JSON.stringify(decision)):null;}
  function node(tag,className,content){const element=document.createElement(tag);if(className)element.className=className;if(content!=null)element.textContent=content;return element;}
  class Explainer {
    constructor({getOperations,selectActor,onChange,runCase,projectPoint}){
      this.getOperations=getOperations;this.selectActor=selectActor;this.onChange=onChange;this.runCase=runCase;this.projectPoint=projectPoint;this.step=0;this.decision=null;this.visible=false;this.$=id=>document.getElementById(id);
      this.sceneCanvas=node('canvas','dispatch-scene-canvas');this.sceneCanvas.setAttribute('aria-hidden','true');this.sceneStrip=node('section','dispatch-scene-strip');this.sceneStrip.setAttribute('aria-label','场景中的调度步骤');this.sceneCanvas.hidden=this.sceneStrip.hidden=true;
      this.sceneStrip.addEventListener('click',event=>{const step=event.target.closest('[data-scene-step]');if(step)this.go(Number(step.dataset.sceneStep));const actor=event.target.closest('[data-inspect-actor]');if(actor)this.selectActor(actor.dataset.inspectActor,true);});
      this.$('dispatch-open').addEventListener('click',()=>this.visible?this.close():this.open());
      this.$('dispatch-close').addEventListener('click',()=>this.close());
      const inspect=node('button','dispatch-inspect','查看完整筛选与派单过程 →');inspect.id='dispatch-inspect';inspect.addEventListener('click',()=>this.open(this.$('dispatch-select').value));this.$('dispatch-visual').append(inspect);
      this.$('explain-task').addEventListener('change',()=>this.capture(this.$('explain-task').value));
      this.$('explain-record').addEventListener('change',()=>{const records=this.getOperations()?.decisionRecords?.get(this.decision?.taskId)||[],record=records.find(d=>String(d.sequence)===this.$('explain-record').value);if(record){this.decision=snapshot(record);this.render();}});
      for(const button of this.$('explain-steps').querySelectorAll('button'))button.addEventListener('click',()=>this.go(Number(button.dataset.step)));
      this.$('explain-prev').addEventListener('click',()=>this.go(this.step-1));this.$('explain-next').addEventListener('click',()=>this.step===3?this.execute():this.go(this.step+1));
      this.$('dispatch-workbench').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close();}});
      this.$('explain-content').addEventListener('click',event=>{const button=event.target.closest('[data-inspect-actor]');if(button)this.selectActor(button.dataset.inspectActor,true);if(event.target.closest('#explain-execute'))this.execute();});
      for(const [id,type]of [['explain-evacuation','evacuation'],['explain-passenger','passenger'],['explain-rescue','rescue']])this.$(id).addEventListener('click',()=>this.runCase(type));
    }
    reset(){this.visible=false;this.decision=null;this.operations=this.getOperations();this.$('demo-stage').classList.remove('explaining');this.$('dispatch-workbench').hidden=true;this.sceneCanvas.hidden=this.sceneStrip.hidden=true;this.$('dispatch-open').setAttribute('aria-pressed','false');this.$('dispatch-open').textContent='调度讲解';}
    sync(){const o=this.getOperations();this.$('dispatch-open').hidden=!o;if(o!==this.operations)this.reset();if(this.visible){const text=(o.active?'城市持续运行 · 历史派单快照':'仿真已暂停')+' / 决策 '+number(this.decision?.t)+'s';if(this.$('explain-time').textContent!==text)this.$('explain-time').textContent=text;}}
    open(taskId,{pause=true}={}){const o=this.getOperations();if(!o)return;this.live=!pause;if(pause&&o.active)o.togglePause();this.operations=o;this.visible=true;this.$('demo-stage').classList.add('explaining');this.$('dispatch-workbench').hidden=false;this.$('dispatch-open').setAttribute('aria-pressed','true');this.$('dispatch-open').textContent='返回任务';this.capture(taskId||this.$('dispatch-select').value||o.selected.task?.id||o.latestDecision?.taskId);this.onChange();}
    close(){this.reset();this.onChange();}
    capture(taskId){const o=this.getOperations();if(!o)return;if(!this.live&&o.active)o.togglePause();this.step=0;this.decision=snapshot(o.decisionsByTask?.get(taskId)||o.latestDecision);this.render();this.onChange();}
    go(step){if(step<0||step>3)return;this.step=step;this.renderContent();}
    render(){
      const o=this.getOperations(),d=this.decision,select=this.$('explain-task');select.replaceChildren();
      for(const [id,record]of o.decisionsByTask||[]){const option=node('option','',id+' · '+record.title);option.value=id;select.append(option);}select.value=d?.taskId||'';
      const recordSelect=this.$('explain-record');recordSelect.replaceChildren();const records=o.decisionRecords?.get(d?.taskId)||[];
      for(const record of records){const option=node('option','',number(record.t)+'s · '+(record.chosen?'派给 '+record.chosen:'未派出'));option.value=String(record.sequence);recordSelect.append(option);}
      if(d&&!records.some(r=>r.sequence===d.sequence)){const option=node('option','',number(d.t)+'s · 当前检查');option.value='current';recordSelect.append(option);recordSelect.value='current';}else recordSelect.value=String(d?.sequence);
      recordSelect.disabled=recordSelect.options.length<2;
      this.$('explain-policy').textContent=d?.policy==='fifo'?'FIFO · 不抢占':d?.preemptionEnabled?'应急优先 · 可抢占':'应急优先 · 不抢占';this.sync();this.renderContent();
    }
    fact(label,value){const element=node('div');element.append(node('span','',label),node('strong','',value));return element;}
    actorButton(candidate){const button=node('button','explain-actor',candidate.id+' '+(typeNames[candidate.type]||''));button.dataset.inspectActor=candidate.id;button.title='定位并跟随 '+candidate.id+'；保留当前决策回放';button.append(node('small','',statusNames[candidate.status]||candidate.status||''));return button;}
    renderContent(){
      const content=this.$('explain-content');content.replaceChildren();content.scrollTop=0;const d=this.decision;
      for(const button of this.$('explain-steps').querySelectorAll('button')){const index=Number(button.dataset.step);button.classList.toggle('done',index<this.step);if(index===this.step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}
      this.$('explain-prev').disabled=this.step===0;this.$('explain-next').disabled=!d;this.$('explain-step-label').textContent=(this.step+1)+' / 4';this.$('explain-next').textContent=this.step===3?'继续观察执行 →':'下一步：'+steps[this.step+1];
      if(!d){content.append(node('p','','还没有调度记录。先发布一个任务。'));return;}
      const summary=summarize(d);if(this.step===0)this.queue(content,d);if(this.step===1)this.filter(content,d,summary);if(this.step===2)this.compare(content,d,summary);if(this.step===3)this.result(content,d,summary);this.renderScene(d,summary);
    }
    renderScene(d,s){
      this.sceneVersion=(this.sceneVersion||0)+1;
      this.sceneStrip.replaceChildren();const flow=node('div','dispatch-scene-flow');for(const [index,label]of [[0,d.taskId+' 入队'],[1,s.eligible.length+' / '+d.candidates.length+'架通过'],[2,'比较候选代价'],[3,d.chosen?'派给 '+d.chosen:'保留队列']]){const button=node('button',index===this.step?'active':'',label);button.dataset.sceneStep=index;flow.append(button);}this.sceneStrip.append(flow);
      const captions=[d.title+' · 优先级 '+d.priority,s.rejected.length+'架未通过约束；青色标记为可选飞机。',s.eligible.length?'比较到当前任务点的航路项、场站项与抢占项。':'没有可用候选，本轮无法进行代价比较。',d.chosen?d.chosen+' 接单；继续执行时再申请场站与航路放行。':'等待飞机可用后重新检查。'];this.sceneStrip.append(node('div','dispatch-scene-caption',captions[this.step]));
      if(this.step===2){const candidates=node('div','dispatch-scene-candidates');for(const c of s.eligible.slice(0,4)){const button=node('button',c.id===d.chosen?'winner':'',c.id+' · '+number(c.cost)+(c.id===d.chosen?' ✓':''));button.dataset.inspectActor=c.id;candidates.append(button);}this.sceneStrip.append(candidates);}
      this.sceneStrip.append(node('small','','标记为决策时位置；虚线仅表示任务关联，实际航路另以黄色显示。'));
    }
    drawScene(holder){
      if(!this.visible||!this.decision||!holder){this.sceneCanvas.hidden=this.sceneStrip.hidden=true;return;}
      if(this.sceneCanvas.parentElement!==holder)holder.append(this.sceneCanvas,this.sceneStrip);this.sceneCanvas.hidden=this.sceneStrip.hidden=false;
      const width=holder.clientWidth,height=holder.clientHeight,ratio=Math.min(2,devicePixelRatio||1);if(!width||!height)return;if(this.sceneCanvas.width!==Math.round(width*ratio)||this.sceneCanvas.height!==Math.round(height*ratio)){this.sceneCanvas.width=Math.round(width*ratio);this.sceneCanvas.height=Math.round(height*ratio);}
      const ctx=this.sceneCanvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);const d=this.decision,s=summarize(d),goal=d.task?.waypoints?.[d.task.stage],target=goal&&this.projectPoint(goal,15);
      const strip={x:this.sceneStrip.offsetLeft,y:this.sceneStrip.offsetTop,w:this.sceneStrip.offsetWidth,h:this.sceneStrip.offsetHeight};
      const label=(point,text,color,offset=-26)=>{ctx.font='600 12px Microsoft YaHei,sans-serif';const w=ctx.measureText(text).width+16,x=Math.max(4,Math.min(width-w-4,point.x-w/2));let y=Math.max(7,Math.min(height-24,point.y+offset));if(x<strip.x+strip.w&&x+w>strip.x&&y<strip.y+strip.h&&y+22>strip.y)y=Math.min(height-24,Math.max(point.y+20,strip.y+strip.h+5));ctx.fillStyle='#123443ed';ctx.fillRect(x,y,w,22);ctx.fillStyle=color;ctx.fillText(text,x+8,y+15);};
      const ring=(point,color,radius)=>{ctx.beginPath();ctx.arc(point.x,point.y,radius,0,Math.PI*2);ctx.strokeStyle='#173b4ab0';ctx.lineWidth=6;ctx.stroke();ctx.strokeStyle=color;ctx.lineWidth=3;ctx.stroke();};
      if(target){ring(target,'#f7ab62',13);label(target,d.taskId+' 当前任务点','#ffd6a2',18);}
      if(this.step===0)return;
      if(this.step===1)for(const c of s.rejected){const p=c.position&&this.projectPoint(c.position,c.altitude);if(p){ctx.fillStyle='#70869199';ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();}}
      const candidates=this.step===3?s.eligible.filter(c=>c.id===d.chosen):s.eligible;for(const [index,c]of candidates.entries()){const p=c.position&&this.projectPoint(c.position,c.altitude);if(!p)continue;const color=this.step===3?'#ffe164':'#63edca';if(target&&this.step>=2&&Math.hypot(p.x-target.x,p.y-target.y)>22){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(target.x,target.y);ctx.strokeStyle=color;ctx.lineWidth=2;ctx.setLineDash([6,7]);ctx.stroke();ctx.setLineDash([]);}ring(p,color,18);label(p,c.id+(this.step===2?' · 代价 '+number(c.cost):this.step===3?' 已接单':' 可选'),color,-32-index%2*24);}
    }
    queue(content,d){
      content.append(node('h3','',d.taskId+' · '+d.title));
      content.append(node('div','explain-callout',d.policy==='fifo'?'按创建时间逐项尝试派单；本轮检查 '+d.taskId+'。':'先处理高优先级任务，同级按创建时间；本轮检查 '+d.taskId+'。'));
      const facts=node('div','explain-facts'),task=d.task||{};facts.append(this.fact('任务 / 优先级',(taskNames[task.type]||'任务')+' / '+d.priority),this.fact('创建 → 检查',number(task.createdAt)+' → '+number(d.t)+'s'),this.fact('需求',task.people?task.people+'人 / '+(typeNames[task.requiredType]||'能力匹配'):task.payloadKg?task.payloadKg+'kg / '+(typeNames[task.requiredType]||'能力匹配'):'按任务能力匹配'));content.append(facts);
      content.append(node('p','','此任务检查前尚未派出的队列。没有可用机的任务留在队列，继续检查下一项；逐项分配后更新机队。'));
      const list=node('div','explain-queue');for(const task of d.queue||[]){const row=node('div','explain-queue-row'+(task.id===d.taskId?' active':''));row.append(node('b','',task.id),node('span','',task.title),node('b','','P'+task.priority));list.append(row);}content.append(list);
    }
    filter(content,d,s){
      content.append(node('h3','','先满足约束，再比较代价'));
      content.append(node('div','explain-callout',d.candidates.length+'架参与检查，'+s.rejected.length+'架不满足约束，'+s.eligible.length+'架进入代价比较。'));
      content.append(node('p','','按工作状态、通信、任务能力、容量、可抢占条件、航路与能源检查。每架记录首个未通过的原因；点击编号可在城市中跟随。'));
      const groups=node('div','explain-groups');groups.append(node('span','eligible','通过 '+s.eligible.length));for(const [reason,count]of s.groups)groups.append(node('span','',reason+' '+count));content.append(groups);
      for(const c of [...s.eligible,...s.rejected]){const row=node('div','explain-candidate'+(c.cost!=null?' eligible':'')),reason=node('div','explain-reason',c.cost!=null?'通过约束 · 进入候选':c.reason);reason.append(node('small','',c.requiredEnergy!=null?'当时能源 '+number(c.battery)+'% / 预算'+(c.energyLowerBound?'下界 ':' ')+number(c.requiredEnergy)+'%':c.currentTaskId?'当时执行 '+c.currentTaskId+' · '+c.currentTaskTitle:'当时能源 '+number(c.battery)+'%'));row.append(this.actorButton(c),reason);content.append(row);}
    }
    compare(content,d,s){
      content.append(node('h3','','候选代价越低，越先被选择'));
      content.append(node('div','explain-formula',d.composition==='mixed'?'代价 = 当前航段风险A* × 25 ÷ 速度 + 场站项 + 抢占项':'代价 = 当前航段风险A* × 25 + 抢占项（120）'));
      content.append(node('p','explain-footnote',d.composition==='mixed'?'风险等效代价，非到达秒数。能源预算包含后续任务和返场。':'基准加权代价，与混合机队不混用。能源按剩余任务估计。'));
      if(!s.eligible.length){content.append(node('div','explain-callout waiting','没有满足约束的候选，因此不进行代价排名。可回到上一步查看每架的拒绝原因。'));return;}
      const legend=node('div','cost-legend');legend.append(node('span','','航路项'),node('span','resource','场站项'),node('span','preempt','抢占项'));content.append(legend);
      const max=Math.max(1,...s.eligible.map(c=>c.cost));for(const c of s.eligible){const card=node('div','cost-card'+(c.id===d.chosen?' winner':'')),head=node('div','cost-card-head');head.append(this.actorButton(c),node('strong','',(c.id===d.chosen?'✓ ':'')+number(c.cost)));card.append(head);const bar=node('div','cost-bar');for(const [part,value]of [['route',c.pathCost],['resource',c.resourcePenalty],['preempt',c.preemptionPenalty]]){const segment=node('i',part);segment.style.width=Math.max(0,(value||0)/max*100)+'%';bar.append(segment);}card.append(bar);const parts=node('div','cost-parts');parts.append(node('span','','航路 '+number(c.pathCost)),node('span','','场站 +'+number(c.resourcePenalty)),node('span','','抢占 +'+number(c.preemptionPenalty)));card.append(parts,node('div','cost-energy','当时能源 '+number(c.battery)+'% ≥ 任务预算 '+number(c.requiredEnergy)+'%'+(c.preemptionPenalty?' · 将中断 '+c.currentTaskId:'')));content.append(card);}
      content.append(node('p','explain-footnote','显示值经过取整；逐任务贪心选择，未求解全局最优。'));
    }
    result(content,d,s){
      content.append(node('h3','',d.chosen?'满足约束，选取最低代价候选':'本次检查没有派出'));
      content.append(node('div','explain-result'+(d.chosen?'':' waiting'),d.chosen?d.taskId+' → '+d.chosen:d.taskId+' 保留队列'));
      let why;if(s.winner){why=s.runner?(s.gap>0?'比下一候选 '+s.runner.id+' 低 '+number(s.gap)+'。':'显示精度下与 '+s.runner.id+' 接近；选择以调度器原始精度为准。'):'这是唯一满足全部约束的候选。';if(s.winner.preemptionPenalty)why+=' 抢占 '+s.winner.currentTaskId+'，原任务重排并保留阶段。';}else why='当前没有可用候选。仿真继续后，每0.5s重新检查；空闲、通信或能源状态变化后才可能派出。';content.append(node('div','explain-callout'+(d.chosen?'':' waiting'),why));
      content.append(node('p','','派单后还须申请场站 / 航路，按容量放行。应急优先于等待者，不驱逐现有占用者。'));
      if(d.resources?.length){const resources=node('details','explain-resources');resources.append(node('summary','','查看检查时的场站 / 航路 · '+number(d.t)+'s'));for(const resource of d.resources){const row=node('div','explain-resource');row.append(node('strong','',resource.name+' / 容量'+resource.capacity),node('span','','占用 '+(resource.holders.join('、')||'无')+' · 等待 '+(resource.waiting.join('、')||'无')));resources.append(row);}content.append(resources);}
      const o=this.getOperations(),task=o.tasks.find(t=>t.id===d.taskId),current=executingActor(o,d.taskId);content.append(node('p','','当前 '+number(o.time)+'s：'+(current?task.id+' 由 '+current.id+' 执行，'+(current.holdReason||statusNames[current.status]||current.status):task?.state==='COMPLETED'?'任务已完成':task?.state==='QUEUED'?'任务仍在队列':'任务状态 '+(task?.state||'已变化'))+'。'));
      content.append(node('div','explain-callout',current?'点下方“继续观察执行”，跟随 '+current.id+' 看起降、等待与实际航路。':'点下方“继续观察执行”，返回现场看机队变化和后续派单。'));
    }
    execute(){const o=this.getOperations();if(!o)return;const actor=executingActor(o,this.decision?.taskId);if(actor)this.selectActor(actor.id,true);if(!o.active)o.start();this.close();}
  }
  return {Explainer,summarize,snapshot};
});
