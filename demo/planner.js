(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LowAirPlanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // 成员 3：风险感知 A*。八邻域、禁止穿角、可退化为最短距离 A*。
  class MinHeap {
    constructor() { this.items = []; }
    push(item) {
      const a = this.items; a.push(item); let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].f <= item.f) break;
        a[i] = a[p]; i = p;
      }
      a[i] = item;
    }
    pop() {
      const a = this.items, top = a[0], tail = a.pop();
      if (!a.length) return top;
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= a.length) break;
        if (c + 1 < a.length && a[c + 1].f < a[c].f) c++;
        if (a[c].f >= tail.f) break;
        a[i] = a[c]; i = c;
      }
      a[i] = tail; return top;
    }
    get length() { return this.items.length; }
  }
  const moves = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  function octile(a, b) {
    const dx = Math.abs(a.x-b.x), dy = Math.abs(a.y-b.y);
    return Math.max(dx,dy) + (Math.SQRT2-1)*Math.min(dx,dy);
  }
  function astar({ width, height, start, goal, blocked, risk = () => ({ ground:0, link:0 }), weights = { ground:0, link:0 } }) {
    if (![width,height,start.x,start.y,goal.x,goal.y].every(Number.isInteger) || width<1 || height<1) throw new Error('Invalid grid');
    if (![weights.ground,weights.link].every(v=>Number.isFinite(v)&&v>=0)) throw new Error('Risk weights must be nonnegative');
    const inside = (x,y) => x>=0 && y>=0 && x<width && y<height;
    if (!inside(start.x,start.y) || !inside(goal.x,goal.y) || blocked(start.x,start.y) || blocked(goal.x,goal.y)) return { path:[], cost:Infinity, expanded:0 };
    const n=width*height, id=(x,y)=>y*width+x, g=new Float64Array(n), parent=new Int32Array(n), closed=new Uint8Array(n);
    g.fill(Infinity); parent.fill(-1);
    const s=id(start.x,start.y), target=id(goal.x,goal.y), heap=new MinHeap();
    g[s]=0; heap.push({id:s,f:octile(start,goal),g:0}); let expanded=0;
    while (heap.length) {
      const current=heap.pop(), k=current.id;
      if (closed[k] || current.g > g[k]+1e-9) continue;
      closed[k]=1; expanded++;
      if (k===target) {
        const path=[];
        for (let p=k;p!==-1;p=parent[p]) path.push({x:p%width,y:Math.floor(p/width)});
        return {path:path.reverse(),cost:g[k],expanded};
      }
      const x=k%width,y=Math.floor(k/width), r0=risk(x,y);
      for (const [dx,dy] of moves) {
        const nx=x+dx,ny=y+dy;
        if (!inside(nx,ny)||blocked(nx,ny)) continue;
        if (dx&&dy&&(blocked(x+dx,y)||blocked(x,y+dy))) continue;
        const nk=id(nx,ny); if (closed[nk]) continue;
        const r1=risk(nx,ny), length=Math.hypot(dx,dy);
        const cost=length*(1+weights.ground*(r0.ground+r1.ground)/2+weights.link*(r0.link+r1.link)/2);
        const candidate=g[k]+cost;
        if (candidate+1e-9<g[nk]) {
          g[nk]=candidate; parent[nk]=k;
          heap.push({id:nk,g:candidate,f:candidate+octile({x:nx,y:ny},goal)});
        }
      }
    }
    return {path:[],cost:Infinity,expanded};
  }
  function pathLength(path) { let n=0; for(let i=1;i<path.length;i++) n+=Math.hypot(path[i].x-path[i-1].x,path[i].y-path[i-1].y); return n; }
  return { astar, octile, pathLength, MinHeap };
});
