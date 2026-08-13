/* ============================================================
   TILT エンジン本体(+ 答えデモ再生)
   重力操作 → 同時スライド → 衝突 → 停止 → 一致ゴールで沈む
   (沈下中は固体=連鎖の支点) → CLEAR
   ============================================================ */
'use strict';

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const now=()=>performance.now();
const DIRV={U:[0,-1],D:[0,1],L:[-1,0],R:[1,0]};
const DIRNAME={U:'↑',D:'↓',L:'←',R:'→'};
const COLORS={
  r:{base:'#ff4d6d',dark:'#8f1f3a',hi:'#ffc2cf',glow:'rgba(255,77,109,'},
  b:{base:'#3fa9ff',dark:'#174a80',hi:'#c6e6ff',glow:'rgba(63,169,255,'},
  g:{base:'#3ddc97',dark:'#146a49',hi:'#c9ffe8',glow:'rgba(61,220,151,'}
};
function vib(ms){ try{ if(SaveMgr.data.set.vib&&navigator.vibrate) navigator.vibrate(ms); }catch(e){} }

/* ---------- save ---------- */
const SaveMgr={
  key:'tilt.save.v1', data:null,
  load(){
    try{ this.data=JSON.parse(localStorage.getItem(this.key)); }catch(e){ this.data=null; }
    if(!this.data||typeof this.data!=='object')
      this.data={cleared:{},unlock:0,set:{sfx:true,bgm:false,vib:true,ctl:'auto'},asked:false};
    const s=this.data.set;
    s.sfx=s.sfx!==false; s.bgm=!!s.bgm; s.vib=s.vib!==false;
    s.ctl=s.ctl||'auto'; this.data.cleared=this.data.cleared||{};
    this.data.unlock=this.data.unlock||0;
  },
  save(){ try{ localStorage.setItem(this.key,JSON.stringify(this.data)); }catch(e){} }
};

/* ---------- dom ---------- */
const cv=$('#cv'), ctx=cv.getContext('2d');
const hudEl=$('#hud'), toastEl=$('#toast'), flashEl=$('#flash');
let VW=0,VH=0,DPR=1,CELL=40,OX=0,OY=0,SAT=0,SAB=0;

function show(el){ el.classList.remove('hidden'); }
function hide(el){ el.classList.add('hidden'); }
let toastTimer=null;
function toast(msg,dur){
  toastEl.textContent=msg; toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toastEl.classList.remove('show'),dur||1800);
}
function flash(a){ flashEl.style.transition='none'; flashEl.style.opacity=a;
  requestAnimationFrame(()=>{ flashEl.style.transition='opacity .55s'; flashEl.style.opacity=0; }); }

/* ---------- game state ---------- */
const G={
  state:'title',            // title | select | playing
  phase:'ready',            // ready | moving | clearwait | clear
  levelIndex:0, level:null,
  W:0,H:0, walls:new Set(), goals:[], blocks:[],
  gravity:null, moves:0, history:[],
  acc:0, tickMs:64, anyChanged:false, chain:0,
  pauseUntil:0, clearAt:0, shake:0, zoom:1,
  bx:0,by:0, tgx:0,tgy:0,
  staticCv:null, tickGuard:0
};
const occ=new Map();
const SINK_MS=230, PAUSE_MS=80;

/* ---------- 答えデモ ---------- */
const DEMO={active:false,steps:[],i:0,timer:0,endTimer:0,done:false,restore:null};

function startDemo(){
  if(G.state!=='playing'||DEMO.active) return;
  if(G.phase!=='ready'){ toast('少し待って…'); return; }
  if(!G.level.sol||!G.level.sol.length){ toast('このステージに解答データなし'); return; }
  SFX.tap();
  // 現在の進行状況を保存(デモ後に完全復元)
  DEMO.restore={snap:snapshot(),gravity:G.gravity,history:G.history.slice()};
  parseLevel(G.level);
  G.phase='ready'; G.gravity=null; G.moves=0; G.history=[]; G.tgx=0; G.tgy=0;
  particles.length=0; buildStatic();
  DEMO.active=true; DEMO.steps=G.level.sol.slice(); DEMO.i=0; DEMO.timer=800;
  DEMO.done=false; DEMO.endTimer=0;
  const hintEl=$('#hint');
  hintEl.textContent='答え '+DEMO.steps.map(d=>DIRNAME[d]).join(' ');
  hintEl.classList.add('show');
  updateHUD();
}
function endDemo(){
  if(!DEMO.active) return;
  DEMO.active=false;
  $('#hint').classList.remove('show');
  if(DEMO.restore){
    restoreSnap(DEMO.restore.snap);
    G.gravity=DEMO.restore.gravity;
    G.history=DEMO.restore.history;
    DEMO.restore=null;
    G.phase='ready';
    buildStatic(); updateHUD();
    toast('もとの進行に戻しました');
  }
}
function demoUpdate(dt){
  if(!DEMO.active||G.state!=='playing') return;
  if(!DEMO.done){
    if(G.phase==='ready'){
      if(DEMO.i<DEMO.steps.length){
        DEMO.timer-=dt*1000;
        if(DEMO.timer<=0){
          const hintEl=$('#hint');
          hintEl.textContent='DEMO '+(DEMO.i+1)+'/'+DEMO.steps.length+'  '
            +DEMO.steps.map((d,k)=>k===DEMO.i?'【'+DIRNAME[d]+'】':DIRNAME[d]).join(' ');
          applyGravity(DEMO.steps[DEMO.i],true);
          DEMO.i++; DEMO.timer=760;
        }
      } else { DEMO.done=true; DEMO.endTimer=1500; }
    }
  } else {
    DEMO.endTimer-=dt*1000;
    if(DEMO.endTimer<=0) endDemo();
  }
}

/* ---------- snapshot / undo ---------- */
function snapshot(){
  return {
    blocks:G.blocks.map(b=>({x:b.x,y:b.y,gone:b.gone})),
    goals:G.goals.map(g=>g.filled),
    moves:G.moves
  };
}
function restoreSnap(s){
  s.blocks.forEach((sb,i)=>{
    const b=G.blocks[i];
    b.x=sb.x;b.y=sb.y;b.gone=sb.gone;
    b.sinking=false;b.sinkT=0;b.moving=false;b.sq=0;b.slide=0;
    b.px=b.x;b.py=b.y;
  });
  s.goals.forEach((f,i)=>{ G.goals[i].filled=f; G.goals[i].fillT=0; });
  G.moves=s.moves;
}

/* ---------- level setup ---------- */
function parseLevel(def){
  const h=def.map.length, w=def.map[0].length;
  G.W=w; G.H=h; G.walls=new Set(); G.goals=[];
  for(let y=0;y<h;y++){
    const row=def.map[y];
    for(let x=0;x<w;x++){
      const ch=row[x];
      if(ch==='#') G.walls.add(x+','+y);
      else if(ch==='r'||ch==='g'||ch==='b')
        G.goals.push({x,y,w:1,h:1,c:ch,filled:false,fillT:0});
    }
  }
  (def.goals||[]).forEach(g=>G.goals.push({x:g.x,y:g.y,w:g.w,h:g.h,c:g.c,filled:false,fillT:0}));
  G.blocks=def.blocks.map((b,i)=>({
    id:i,x:b.x,y:b.y,w:b.w||1,h:b.h||1,c:b.c,
    px:b.x,py:b.y,gone:false,sinking:false,sinkT:0,
    moving:false,sq:0,sqAx:'x',slide:0
  }));
}

function startLevel(i){
  DEMO.active=false; DEMO.restore=null;
  G.levelIndex=clamp(i,0,LEVELS.length-1);
  G.level=LEVELS[G.levelIndex];
  parseLevel(G.level);
  G.state='playing'; G.phase='ready';
  G.gravity=null; G.moves=0; G.history=[]; G.chain=0;
  G.shake=0; G.zoom=1; particles.length=0;
  hide($('#title'));hide($('#select'));hide($('#clear'));hide($('#settings'));hide($('#perm'));
  show(hudEl);
  $('#stageNo').textContent='STAGE '+String(G.levelIndex+1).padStart(2,'0');
  $('#stageName').textContent=G.level.name;
  $('#parNum').textContent='PAR '+G.level.par;
  updateHUD(); layout(); buildStatic();
  toast('STAGE '+String(G.levelIndex+1).padStart(2,'0')+' ― '+G.level.name,1400);
  const hintEl=$('#hint');
  if(G.level.hint && !SaveMgr.data.cleared[G.level.id]){
    hintEl.textContent=G.level.hint; hintEl.classList.add('show');
    setTimeout(()=>hintEl.classList.remove('show'),5200);
  } else hintEl.classList.remove('show');
  updateCtlBadge();
}

function restartLevel(){
  if(G.state!=='playing') return;
  if(DEMO.active){ DEMO.active=false; DEMO.restore=null; $('#hint').classList.remove('show'); }
  parseLevel(G.level);
  G.phase='ready'; G.gravity=null; G.moves=0; G.history=[]; G.chain=0;
  G.shake=0; G.zoom=1; particles.length=0;
  hide($('#clear')); updateHUD(); buildStatic();
  SFX.tap(); vib(6);
}

/* ---------- simulation ---------- */
function buildOcc(){
  occ.clear();
  for(const b of G.blocks){
    if(b.gone) continue;
    for(let i=0;i<b.w;i++)for(let j=0;j<b.h;j++)
      occ.set((b.x+i)+','+(b.y+j),b);
  }
}
function canStep(b,dx,dy){
  for(let i=0;i<b.w;i++)for(let j=0;j<b.h;j++){
    const x=b.x+i+dx, y=b.y+j+dy;
    if(x<0||y<0||x>=G.W||y>=G.H) return false;
    if(G.walls.has(x+','+y)) return false;
    const o=occ.get(x+','+y);
    if(o&&o!==b) return false;
  }
  return true;
}
function matchGoal(b){
  return G.goals.find(g=>!g.filled&&g.c===b.c&&g.x===b.x&&g.y===b.y&&g.w===b.w&&g.h===b.h);
}

function applyGravity(dir,fromDemo){
  if(G.state!=='playing'||G.phase!=='ready') return;
  if(DEMO.active&&!fromDemo) return;
  SFX.unlock();
  G.history.push(snapshot());
  if(G.history.length>300) G.history.shift();
  G.gravity=dir; G.phase='moving';
  G.anyChanged=false; G.chain=0; G.acc=0; G.tickMs=64;
  G.pauseUntil=0; G.tickGuard=0;
  G.tgx=DIRV[dir][0]*5; G.tgy=DIRV[dir][1]*5;
  SFX.whoosh(); vib(5);
  spawnWind(dir);
  updateHUD();
}

function doTick(){
  const t=now();
  if(t<G.pauseUntil) return;
  const dx=DIRV[G.gravity][0], dy=DIRV[G.gravity][1];
  buildOcc();
  const bs=G.blocks.filter(b=>!b.gone&&!b.sinking);
  const lead=b=> dx===1? b.x+b.w-1 : dx===-1? -b.x : dy===1? b.y+b.h-1 : -b.y;
  bs.sort((a,b)=>lead(b)-lead(a));

  let moved=false; const movedSet=new Set();
  for(const b of bs){
    if(canStep(b,dx,dy)){
      b.x+=dx; b.y+=dy; b.slide++; b.moving=true;
      moved=true; G.anyChanged=true; movedSet.add(b);
    }else{
      if(b.moving) collide(b,dx,dy);
      b.moving=false;
    }
  }
  // 吸収判定(沈下中は固体=連鎖の支点になる)
  buildOcc();
  let sinkStarted=false;
  for(const b of bs){
    if(movedSet.has(b)||b.sinking||b.gone) continue;
    if(canStep(b,dx,dy)) continue;
    const g=matchGoal(b);
    if(g){ startSink(b,g); sinkStarted=true; }
  }
  const sinkActive=G.blocks.some(b=>b.sinking&&!b.gone);
  if(!moved&&!sinkStarted&&!sinkActive) endMove();
}

function startSink(b,g){
  b.sinking=true; b.sinkT=0; b.moving=false; b.slide=0;
  g.filled=true; g.fillT=0;
  G.chain++; G.anyChanged=true;
  G.pauseUntil=now()+PAUSE_MS;
  SFX.chime(G.chain); vib(14);
  burst((g.x+g.w/2),(g.y+g.h/2),COLORS[b.c].base,14,150);
}

function collide(b,dx,dy){
  b.sq=1; b.sqAx=(dx!==0)?'x':'y';
  const p=Math.min(b.slide/5,1);
  SFX.thud(p); vib(Math.round(4+p*8));
  const cx=b.x+b.w/2+dx*(b.w/2), cy=b.y+b.h/2+dy*(b.h/2);
  burst(cx,cy,'rgba(200,220,255,.8)',3+Math.round(p*3),60);
  b.slide=0;
}

function endMove(){
  G.phase='ready';
  if(!G.anyChanged){
    G.history.pop();
    SFX.denied(); G.shake=1;
    updateHUD();
    return;
  }
  G.moves++;
  updateHUD();
  if(G.goals.every(g=>g.filled)){
    if(!DEMO.active){ G.phase='clearwait'; G.clearAt=now()+460; }
  }
}

function undo(){
  if(DEMO.active) return;
  if(G.state!=='playing'||G.phase!=='ready'||!G.history.length) return;
  restoreSnap(G.history.pop());
  G.gravity=null; G.tgx=0; G.tgy=0;
  SFX.undo(); vib(6);
  buildStatic(); updateHUD();
}

/* ---------- clear ---------- */
function starsFor(m,par){ return m<=par?3:(m<=par+2?2:1); }
function doClear(){
  G.phase='clear';
  const s=starsFor(G.moves,G.level.par);
  const rec=SaveMgr.data.cleared[G.level.id];
  SaveMgr.data.cleared[G.level.id]={
    m:rec?Math.min(rec.m,G.moves):G.moves,
    s:rec?Math.max(rec.s,s):s
  };
  SaveMgr.data.unlock=Math.max(SaveMgr.data.unlock,G.levelIndex+1);
  SaveMgr.save();
  G.zoom=1.045; flash(.28); SFX.clear(); vib(30);
  G.goals.forEach(g=>burst(g.x+g.w/2,g.y+g.h/2,'#ffffff',10,220));
  burst(G.W/2,G.H/2,'#9fdcff',26,260);
  const best=SaveMgr.data.cleared[G.level.id].m;
  $('#cMoves').textContent=G.moves;
  $('#cBest').textContent=best;
  $('#cPar').textContent=G.level.par;
  const starsEl=$('#stars').children;
  for(let i=0;i<3;i++){
    starsEl[i].classList.remove('on');
    if(i<s){ void starsEl[i].offsetWidth; starsEl[i].classList.add('on'); }
  }
  if(G.moves<=G.level.par) show($('#clearPerfect')); else hide($('#clearPerfect'));
  const last=G.levelIndex>=LEVELS.length-1;
  $('#btnCNext').textContent=last?'FINISH':'NEXT';
  show($('#clear'));
}

/* ---------- particles ---------- */
const particles=[];
function burst(cx,cy,color,n,spd){
  const px=OX+cx*CELL, py=OY+cy*CELL;
  for(let i=0;i<n;i++){
    if(particles.length>170) particles.shift();
    const a=Math.random()*Math.PI*2, v=spd*(.4+Math.random()*.9);
    particles.push({x:px,y:py,vx:Math.cos(a)*v,vy:Math.sin(a)*v-spd*.25,
      life:1,dec:1.6+Math.random()*1.4,size:1.5+Math.random()*3,color});
  }
}
function spawnWind(dir){
  const dx=DIRV[dir][0],dy=DIRV[dir][1];
  for(let i=0;i<7;i++){
    const t=Math.random();
    let x,y;
    if(dx!==0){ x=dx>0?OX-6:OX+G.W*CELL+6; y=OY+t*G.H*CELL; }
    else{ y=dy>0?OY-6:OY+G.H*CELL+6; x=OX+t*G.W*CELL; }
    particles.push({x,y,vx:dx*220,vy:dy*220,life:.8,dec:3.2,size:1.6,color:'rgba(160,210,255,.9)'});
  }
}

/* ---------- layout / static layer ---------- */
function measureSafe(){
  const d=document.createElement('div');
  d.style.cssText='position:fixed;top:0;left:0;width:env(safe-area-inset-top,0px);height:env(safe-area-inset-top,0px);visibility:hidden';
  document.body.appendChild(d); SAT=d.offsetWidth||0; d.remove();
  const d2=document.createElement('div');
  d2.style.cssText='position:fixed;top:0;left:0;width:env(safe-area-inset-bottom,0px);height:env(safe-area-inset-bottom,0px);visibility:hidden';
  document.body.appendChild(d2); SAB=d2.offsetWidth||0; d2.remove();
}
function resize(){
  VW=window.innerWidth; VH=window.innerHeight;
  DPR=Math.min(window.devicePixelRatio||1,2);
  cv.width=Math.round(VW*DPR); cv.height=Math.round(VH*DPR);
  cv.style.width=VW+'px'; cv.style.height=VH+'px';
  layout(); if(G.state==='playing') buildStatic();
}
function layout(){
  if(!G.W) return;
  const top=88+SAT, bottom=118+SAB;
  const availW=Math.min(VW-26,560), availH=Math.max(VH-top-bottom,120);
  CELL=clamp(Math.floor(Math.min(availW/G.W,availH/G.H)),22,86);
  OX=Math.round((VW-CELL*G.W)/2);
  OY=Math.round(top+(availH-CELL*G.H)/2);
}
function rr(c,x,y,w,h,r){
  r=Math.min(r,w/2,h/2);
  c.beginPath();
  c.moveTo(x+r,y);
  c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r);
  c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r);
  c.closePath();
}
function buildStatic(){
  const c=document.createElement('canvas');
  const bw=G.W*CELL, bh=G.H*CELL;
  c.width=Math.round(bw*DPR); c.height=Math.round(bh*DPR);
  const g=c.getContext('2d'); g.scale(DPR,DPR);
  rr(g,-8,-8,bw+16,bh+16,20);
  g.fillStyle='rgba(8,12,26,.72)'; g.fill();
  g.strokeStyle='rgba(140,190,255,.16)'; g.lineWidth=1.4; g.stroke();
  for(let y=0;y<G.H;y++)for(let x=0;x<G.W;x++){
    if(G.walls.has(x+','+y)) continue;
    const px=x*CELL,py=y*CELL;
    rr(g,px+2,py+2,CELL-4,CELL-4,CELL*.16);
    g.fillStyle='rgba(255,255,255,.034)'; g.fill();
    g.strokeStyle='rgba(255,255,255,.05)'; g.lineWidth=1; g.stroke();
  }
  for(const key of G.walls){
    const [x,y]=key.split(',').map(Number);
    const px=x*CELL,py=y*CELL;
    g.save();
    g.shadowColor='rgba(0,0,0,.55)'; g.shadowBlur=10; g.shadowOffsetY=4;
    rr(g,px+1.5,py+1.5,CELL-3,CELL-3,CELL*.2);
    const gr=g.createLinearGradient(px,py,px,py+CELL);
    gr.addColorStop(0,'#26315a'); gr.addColorStop(1,'#141b36');
    g.fillStyle=gr; g.fill();
    g.restore();
    rr(g,px+1.5,py+1.5,CELL-3,CELL-3,CELL*.2);
    g.strokeStyle='rgba(255,255,255,.14)'; g.lineWidth=1; g.stroke();
    g.beginPath(); g.moveTo(px+CELL*.22,py+3.5); g.lineTo(px+CELL*.78,py+3.5);
    g.strokeStyle='rgba(255,255,255,.22)'; g.lineWidth=1.4; g.stroke();
  }
  G.staticCv=c;
}

/* ---------- drawing ---------- */
const shards=[];
for(let i=0;i<12;i++){
  shards.push({x:Math.random(),y:Math.random(),s:.5+Math.random()*1.4,
    vx:(Math.random()-.5)*.014,vy:(Math.random()-.5)*.01,
    r:Math.random()*Math.PI,vr:(Math.random()-.5)*.3,
    c:['r','b','g'][i%3]});
}
function drawAmbient(dt){
  for(const s of shards){
    s.x+=s.vx*dt; s.y+=s.vy*dt; s.r+=s.vr*dt;
    if(s.x<-.2)s.x=1.2; if(s.x>1.2)s.x=-.2;
    if(s.y<-.2)s.y=1.2; if(s.y>1.2)s.y=-.2;
    const sz=30*s.s, x=s.x*VW, y=s.y*VH;
    ctx.save(); ctx.translate(x,y); ctx.rotate(s.r);
    ctx.globalAlpha=.05+.04*s.s;
    rr(ctx,-sz/2,-sz/2,sz,sz,sz*.24);
    ctx.fillStyle=COLORS[s.c].base; ctx.fill();
    ctx.globalAlpha=.12;
    ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.stroke();
    ctx.restore();
  }
}
function drawGoals(t){
  for(const g of G.goals){
    const px=OX+g.x*CELL, py=OY+g.y*CELL, w=g.w*CELL, h=g.h*CELL;
    const col=COLORS[g.c];
    if(!g.filled){
      const pulse=.55+.3*Math.sin(t*.0024+(g.x+g.y));
      rr(ctx,px+CELL*.14,py+CELL*.14,w-CELL*.28,h-CELL*.28,CELL*.2);
      ctx.fillStyle='rgba(3,5,12,.85)'; ctx.fill();
      ctx.save();
      ctx.shadowColor=col.glow+'.8)'; ctx.shadowBlur=10*pulse;
      ctx.strokeStyle=col.base; ctx.globalAlpha=.45+.4*pulse; ctx.lineWidth=2;
      rr(ctx,px+CELL*.14,py+CELL*.14,w-CELL*.28,h-CELL*.28,CELL*.2); ctx.stroke();
      ctx.restore();
    }else{
      g.fillT+=16;
      const k=Math.min(g.fillT/300,1);
      ctx.save();
      ctx.shadowColor=col.glow+'.9)'; ctx.shadowBlur=16;
      rr(ctx,px+CELL*.16,py+CELL*.16,w-CELL*.32,h-CELL*.32,CELL*.18);
      const gr=ctx.createLinearGradient(px,py,px,py+h);
      gr.addColorStop(0,col.hi); gr.addColorStop(.4,col.base); gr.addColorStop(1,col.dark);
      ctx.globalAlpha=.35+.65*k; ctx.fillStyle=gr; ctx.fill();
      ctx.restore();
    }
  }
}
function drawBlock(b,t){
  const col=COLORS[b.c];
  let scale=1, alpha=1;
  if(b.sinking){
    const k=Math.min(b.sinkT/SINK_MS,1);
    scale=1-k*.85; alpha=1-k*.9;
  }
  const cx=OX+(b.px+b.w/2)*CELL, cy=OY+(b.py+b.h/2)*CELL;
  let sx=scale, sy=scale;
  if(b.moving&&!b.sinking){ if(b.sqAx==='x') sx*=1.05; else sy*=1.05; }
  if(b.sq>0){
    const q=b.sq*.16;
    if(b.sqAx==='x'){ sx*=1-q; sy*=1+q*.7; } else { sy*=1-q; sx*=1+q*.7; }
  }
  const w=b.w*CELL*sx, h=b.h*CELL*sy;
  ctx.save();
  ctx.translate(cx,cy); ctx.globalAlpha=alpha;
  ctx.save();
  ctx.shadowColor='rgba(0,0,0,.5)'; ctx.shadowBlur=12; ctx.shadowOffsetY=5;
  rr(ctx,-w/2+2,-h/2+2,w-4,h-4,CELL*.18);
  ctx.fillStyle='rgba(0,0,0,.01)'; ctx.fill();
  ctx.restore();
  const gr=ctx.createLinearGradient(0,-h/2,0,h/2);
  gr.addColorStop(0,col.hi); gr.addColorStop(.28,col.base); gr.addColorStop(1,col.dark);
  rr(ctx,-w/2+2,-h/2+2,w-4,h-4,CELL*.18);
  ctx.fillStyle=gr; ctx.fill();
  ctx.save(); ctx.clip();
  const gl=ctx.createLinearGradient(0,-h/2,0,-h/2+h*.5);
  gl.addColorStop(0,'rgba(255,255,255,.5)'); gl.addColorStop(1,'rgba(255,255,255,0)');
  rr(ctx,-w/2+3,-h/2+3,w-6,h*.5,CELL*.16);
  ctx.fillStyle=gl; ctx.fill();
  ctx.restore();
  rr(ctx,-w/2+2,-h/2+2,w-4,h-4,CELL*.18);
  ctx.strokeStyle='rgba(255,255,255,.4)'; ctx.lineWidth=1.3; ctx.stroke();
  ctx.restore();
}
function drawGravArrows(t){
  const bw=G.W*CELL,bh=G.H*CELL;
  const sides=[
    {d:'U',x:OX+bw/2,y:OY-16,a:-Math.PI/2},
    {d:'D',x:OX+bw/2,y:OY+bh+16,a:Math.PI/2},
    {d:'L',x:OX-16,y:OY+bh/2,a:Math.PI},
    {d:'R',x:OX+bw+16,y:OY+bh/2,a:0}
  ];
  for(const s of sides){
    const on=G.gravity===s.d;
    ctx.save(); ctx.translate(s.x,s.y); ctx.rotate(s.a);
    ctx.globalAlpha=on?.95:.18;
    if(on){ ctx.shadowColor='rgba(140,220,255,.9)'; ctx.shadowBlur=10; }
    ctx.beginPath(); ctx.moveTo(7,0); ctx.lineTo(-5,-6); ctx.lineTo(-5,6); ctx.closePath();
    ctx.fillStyle=on?'#9fe2ff':'#ffffff'; ctx.fill();
    ctx.restore();
  }
  if(G.gravity){
    const dx=DIRV[G.gravity][0],dy=DIRV[G.gravity][1];
    let gx0,gy0,gw,gh;
    if(dx===1){ gx0=OX+bw-10;gy0=OY;gw=10;gh=bh; }
    else if(dx===-1){ gx0=OX;gy0=OY;gw=10;gh=bh; }
    else if(dy===1){ gx0=OX;gy0=OY+bh-10;gw=bw;gh=10; }
    else { gx0=OX;gy0=OY;gw=bw;gh=10; }
    const gr=ctx.createLinearGradient(gx0+(dx===-1?10:0),gy0+(dy===-1?10:0),
      gx0+(dx===1?10:gw)-(dx===1?10:0),gy0+(dy===1?10:gh)-(dy===1?10:0));
    gr.addColorStop(0,'rgba(140,210,255,.16)'); gr.addColorStop(1,'rgba(140,210,255,0)');
    ctx.fillStyle=gr; ctx.fillRect(gx0,gy0,gw,gh);
  }
}
function render(t,dt){
  ctx.setTransform(DPR,0,0,DPR,0,0);
  const bg=ctx.createRadialGradient(VW/2,VH*.35,60,VW/2,VH/2,Math.max(VW,VH)*.75);
  bg.addColorStop(0,'#0d1430'); bg.addColorStop(1,'#05070f');
  ctx.fillStyle=bg; ctx.fillRect(0,0,VW,VH);

  if(G.state==='title'||G.state==='select'){ drawAmbient(dt); }

  if(G.state==='playing'&&G.staticCv){
    G.bx+=(G.tgx-G.bx)*Math.min(1,dt*8);
    G.by+=(G.tgy-G.by)*Math.min(1,dt*8);
    G.zoom+=(1-G.zoom)*Math.min(1,dt*5);
    let shx=0,shy=0;
    if(G.shake>0){ G.shake=Math.max(0,G.shake-dt*3);
      shx=(Math.random()-.5)*G.shake*6; shy=(Math.random()-.5)*G.shake*6; }
    ctx.save();
    const cx=OX+G.W*CELL/2, cy=OY+G.H*CELL/2;
    ctx.translate(cx+shx,cy+shy); ctx.scale(G.zoom,G.zoom); ctx.translate(-cx,-cy);
    ctx.translate(G.bx,G.by);
    drawGravArrows(t);
    ctx.save(); ctx.translate(OX,OY);
    ctx.drawImage(G.staticCv,0,0,G.W*CELL,G.H*CELL);
    ctx.restore();
    drawGoals(t);
    for(const b of G.blocks) if(!b.gone) drawBlock(b,t);
    ctx.restore();
  }
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];
    p.life-=p.dec*dt;
    if(p.life<=0){ particles.splice(i,1); continue; }
    p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=260*dt;
    ctx.globalAlpha=Math.max(p.life,0);
    ctx.fillStyle=p.color;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.size*p.life+.4,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=1;
}

/* ---------- frame loop ---------- */
let lastT=now();
function frame(){
  const t=now();
  let dt=(t-lastT)/1000; lastT=t;
  dt=Math.min(dt,.05);

  if(G.state==='playing'){
    if(G.phase==='moving'){
      G.acc+=dt*1000; let guard=0;
      while(G.acc>=G.tickMs&&guard++<5){
        G.acc-=G.tickMs;
        G.tickMs=Math.max(40,G.tickMs-2.5);
        G.tickGuard++;
        doTick();
        if(G.phase!=='moving') break;
        if(G.tickGuard>2400){ endMove(); break; }
      }
    }
    demoUpdate(dt);
    if(G.phase==='clearwait'&&t>=G.clearAt) doClear();
    for(const b of G.blocks){
      if(b.gone) continue;
      if(b.sinking){ b.sinkT+=dt*1000; if(b.sinkT>=SINK_MS) b.gone=true; }
      const k=1-Math.exp(-dt*17);
      b.px+=(b.x-b.px)*k; b.py+=(b.y-b.py)*k;
      if(b.sq>0) b.sq=Math.max(0,b.sq-dt*5);
    }
  }
  render(t,dt);
  requestAnimationFrame(frame);
}

/* ---------- HUD ---------- */
function updateHUD(){
  $('#moveNum').textContent=G.moves;
  const ub=$('#btnUndo');
  if(G.history.length&&G.phase==='ready'&&!DEMO.active) ub.classList.remove('off');
  else ub.classList.add('off');
}
function updateCtlBadge(){
  const m=SaveMgr.data.set.ctl;
  $('#ctlBadge').textContent=m==='auto'?(permState==='granted'?'TILT':'SWIPE'):(m==='tilt'?'TILT':'SWIPE');
}

/* ---------- input: swipe / tap ---------- */
let pd=null;
cv.addEventListener('pointerdown',e=>{
  SFX.unlock();
  if(SaveMgr.data.set.bgm&&SFX.S.bgmOn===false&&SaveMgr.data.set.bgm) SFX.bgm(true);
  if(DEMO.active){ endDemo(); return; }   // デモ中はタップで中断→復帰
  if(G.state!=='playing') return;
  pd={x:e.clientX,y:e.clientY,t:now(),fired:false};
});
cv.addEventListener('pointermove',e=>{
  if(!pd||pd.fired||DEMO.active) return;
  const dx=e.clientX-pd.x, dy=e.clientY-pd.y;
  if(Math.hypot(dx,dy)>32){
    pd.fired=true;
    const d=Math.abs(dx)>Math.abs(dy)?(dx>0?'R':'L'):(dy>0?'D':'U');
    applyGravity(d);
  }
});
window.addEventListener('pointerup',()=>{ pd=null; });
cv.addEventListener('contextmenu',e=>e.preventDefault());

/* ---------- input: keyboard ---------- */
window.addEventListener('keydown',e=>{
  const map={ArrowUp:'U',ArrowDown:'D',ArrowLeft:'L',ArrowRight:'R',w:'U',s:'D',a:'L',d:'R'};
  const k=e.key;
  if(map[k]){ applyGravity(map[k]); e.preventDefault(); }
  else if(k==='z'||k==='u') undo();
  else if(k==='r') restartLevel();
  else if(k==='h') startDemo();          // Hキーでも答えデモ
  else if(k==='Escape'&&G.state==='playing'){ if(DEMO.active) endDemo(); else openSelect(); }
  else if(k==='Enter'&&G.phase==='clear'){
    if(G.levelIndex<LEVELS.length-1) startLevel(G.levelIndex+1); else openSelect();
  }
});

/* ---------- input: tilt ---------- */
let permState='unknown';
const TS={dir:null,hold:0,last:0,calG:0,calB:0,lastG:0,lastB:0,seen:false};
function tiltSupported(){ return 'DeviceOrientationEvent' in window; }
function needsPermission(){
  return tiltSupported()&&typeof DeviceOrientationEvent.requestPermission==='function';
}
function onOrient(e){
  if(e.beta==null||e.gamma==null) return;
  TS.seen=true; TS.lastG=e.gamma; TS.lastB=e.beta;
  if(permState!=='granted') return;
  if(SaveMgr.data.set.ctl==='swipe') return;
  const ang=(screen.orientation&&screen.orientation.angle)||window.orientation||0;
  let lr,ud;
  if(ang===0||ang===180){ lr=e.gamma-TS.calG; ud=e.beta-TS.calB; }
  else { const s=(ang===90||ang===-270)?1:-1; lr=s*(e.beta-TS.calB); ud=-s*(e.gamma-TS.calG); }
  const EN=15,EX=8;
  let d=TS.dir;
  const cand=lr>EN?'R':lr<-EN?'L':ud>EN?'D':ud<-EN?'U':null;
  if(cand) d=cand;
  else if(d&&Math.abs(lr)<EX&&Math.abs(ud)<EX) d=null;
  if(d!==TS.dir){ TS.dir=d; TS.hold=0; }
  if(d){
    TS.hold++;
    if(TS.hold>=2&&now()-TS.last>340&&d!==G.gravity){
      TS.last=now(); applyGravity(d);
    }
  }
}
function requestTilt(){
  if(!tiltSupported()){ permState='unsupported'; return Promise.resolve(false); }
  if(!needsPermission()){ permState='granted'; calibrate(); return Promise.resolve(true); }
  return DeviceOrientationEvent.requestPermission().then(r=>{
    permState=(r==='granted')?'granted':'denied';
    if(permState==='granted'){ calibrate(); toast('傾き操作をONにしました'); }
    else toast('スワイプ操作で遊べます');
    updateCtlBadge();
    return permState==='granted';
  }).catch(()=>{ permState='denied'; updateCtlBadge(); return false; });
}
function calibrate(){
  if(TS.seen){ TS.calG=TS.lastG; TS.calB=TS.lastB; toast('キャリブレーション完了'); }
  else toast('センサー情報がまだありません');
}
window.addEventListener('deviceorientation',onOrient);

/* ---------- screens ---------- */
function openTitle(){
  G.state='title'; DEMO.active=false; hide(hudEl);
  ['#select','#clear','#settings','#perm'].forEach(s=>hide($(s)));
  show($('#title'));
}
function openSelect(){
  G.state='select'; DEMO.active=false; hide(hudEl);
  ['#title','#clear','#settings','#perm'].forEach(s=>hide($(s)));
  buildGrid(); show($('#select'));
}
function buildGrid(){
  const grid=$('#grid'); grid.innerHTML='';
  const unlock=SaveMgr.data.unlock;
  LEVELS.forEach((lv,i)=>{
    const rec=SaveMgr.data.cleared[lv.id];
    const locked=i>unlock;
    const d=document.createElement('div');
    d.className='tile'+(locked?' locked':'')+(i===unlock&&!rec?' current':'');
    if(locked){
      d.innerHTML='<div class="n">🔒</div><div class="nm">'+lv.name+'</div>';
    }else{
      const s=rec?rec.s:0;
      const st='★'.repeat(s)+'<i>'+'★'.repeat(3-s)+'</i>';
      d.innerHTML='<div class="n">'+String(i+1).padStart(2,'0')+'</div>'
        +'<div class="nm">'+lv.name+'</div>'
        +'<div class="st">'+st+'</div>'
        +(rec?'<div class="best">BEST '+rec.m+'</div>':'<div class="best">PAR '+lv.par+'</div>');
      d.addEventListener('click',()=>{ SFX.tap(); startLevel(i); });
    }
    grid.appendChild(d);
  });
}
function openSettings(){ syncSettings(); show($('#settings')); }
function syncSettings(){
  const s=SaveMgr.data.set;
  $('#swSfx').classList.toggle('on',s.sfx);
  $('#swBgm').classList.toggle('on',s.bgm);
  $('#swVib').classList.toggle('on',s.vib);
  $('#btnCtl').textContent=s.ctl.toUpperCase();
}

/* ---------- UI wiring ---------- */
function wire(){
  $('#btnPlay').addEventListener('click',()=>{
    SFX.unlock(); SFX.tap();
    if(SaveMgr.data.set.bgm) SFX.bgm(true);
    const target=clamp(SaveMgr.data.unlock,0,LEVELS.length-1);
    if(SaveMgr.data.set.ctl!=='swipe'&&needsPermission()&&permState==='unknown'&&!SaveMgr.data.asked){
      SaveMgr.data.asked=true; SaveMgr.save();
      show($('#perm'));
      return;
    }
    startLevel(target);
  });
  $('#btnPermYes').addEventListener('click',()=>{
    hide($('#perm'));
    requestTilt().then(()=>startLevel(clamp(SaveMgr.data.unlock,0,LEVELS.length-1)));
  });
  $('#btnPermNo').addEventListener('click',()=>{
    hide($('#perm'));
    toast('スワイプ操作で遊べます');
    startLevel(clamp(SaveMgr.data.unlock,0,LEVELS.length-1));
  });
  $('#btnLevels').addEventListener('click',()=>{ SFX.tap(); openSelect(); });
  $('#btnSettingsT').addEventListener('click',()=>{ SFX.tap(); openSettings(); });
  $('#btnSettingsS').addEventListener('click',()=>{ SFX.tap(); openSettings(); });
  $('#btnSelBack').addEventListener('click',()=>{ SFX.tap(); openTitle(); });
  $('#btnSetClose').addEventListener('click',()=>{ SFX.tap(); hide($('#settings')); });
  $('#btnMenu').addEventListener('click',()=>{ SFX.tap(); if(DEMO.active) endDemo(); else openSelect(); });
  $('#btnUndo').addEventListener('click',()=>undo());
  $('#btnAnswer').addEventListener('click',()=>startDemo());
  $('#btnRestart').addEventListener('click',()=>restartLevel());
  $('#btnCMenu').addEventListener('click',()=>{ SFX.tap(); openSelect(); });
  $('#btnCRetry').addEventListener('click',()=>{ SFX.tap(); restartLevel(); });
  $('#btnCNext').addEventListener('click',()=>{
    SFX.tap();
    if(G.levelIndex<LEVELS.length-1) startLevel(G.levelIndex+1);
    else { toast('全ステージクリア！ありがとう'); openSelect(); }
  });
  const s=SaveMgr.data.set;
  $('#swSfx').addEventListener('click',()=>{ s.sfx=!s.sfx; SFX.S.on=s.sfx; SaveMgr.save(); syncSettings(); SFX.tap(); });
  $('#swBgm').addEventListener('click',()=>{
    s.bgm=!s.bgm; SaveMgr.save(); syncSettings();
    SFX.unlock(); SFX.bgm(s.bgm); SFX.tap();
  });
  $('#swVib').addEventListener('click',()=>{ s.vib=!s.vib; SaveMgr.save(); syncSettings(); vib(20); SFX.tap(); });
  $('#btnCtl').addEventListener('click',()=>{
    s.ctl=s.ctl==='auto'?'tilt':(s.ctl==='tilt'?'swipe':'auto');
    SaveMgr.save(); syncSettings(); updateCtlBadge(); SFX.tap();
    if(s.ctl!=='swipe'&&needsPermission()&&permState==='unknown') requestTilt();
  });
  $('#btnCal').addEventListener('click',()=>{ SFX.tap(); calibrate(); });
  let resetArm=false;
  $('#btnReset').addEventListener('click',()=>{
    if(!resetArm){ resetArm=true; $('#btnReset').textContent='REALLY? TAP AGAIN';
      setTimeout(()=>{resetArm=false;$('#btnReset').textContent='RESET SAVE DATA';},2200); return; }
    try{ localStorage.removeItem(SaveMgr.key); }catch(e){}
    SaveMgr.load(); resetArm=false;
    $('#btnReset').textContent='RESET SAVE DATA';
    toast('セーブデータを削除しました'); syncSettings();
  });
  document.addEventListener('touchmove',e=>{
    if(e.target.closest&&e.target.closest('#grid')) return;
    e.preventDefault();
  },{passive:false});
  document.addEventListener('gesturestart',e=>e.preventDefault());
  window.addEventListener('resize',resize);
  window.addEventListener('orientationchange',()=>{ setTimeout(()=>{resize();calibrate();},120); });
}

/* ---------- init ---------- */
function init(){
  SaveMgr.load();
  SFX.S.on=SaveMgr.data.set.sfx;
  if(!needsPermission()&&tiltSupported()) permState='granted';
  measureSafe(); wire(); resize(); openTitle(); updateCtlBadge();
  requestAnimationFrame(frame);
}
init();
