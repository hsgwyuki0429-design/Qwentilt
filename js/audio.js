/* TILT オーディオエンジン(全音WebAudio合成・外部ファイル不要) */
'use strict';
const SFX = (function(){
  let ac=null, master=null, noiseBuf=null, bgm=null;
  const S={ on:true, bgmOn:false };

  function ensure(){
    if(!ac){
      const AC=window.AudioContext||window.webkitAudioContext;
      if(!AC) return false;
      ac=new AC();
      master=ac.createGain(); master.gain.value=.9; master.connect(ac.destination);
      noiseBuf=ac.createBuffer(1, ac.sampleRate*0.6, ac.sampleRate);
      const d=noiseBuf.getChannelData(0);
      for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
    }
    if(ac.state==='suspended') ac.resume();
    return true;
  }
  function noise(t0,dur,f0,f1,g,type){
    const src=ac.createBufferSource(); src.buffer=noiseBuf;
    const bp=ac.createBiquadFilter(); bp.type=type||'bandpass';
    bp.frequency.setValueAtTime(f0,t0);
    if(f1) bp.frequency.exponentialRampToValueAtTime(Math.max(f1,20),t0+dur);
    bp.Q.value=1;
    const gn=ac.createGain();
    gn.gain.setValueAtTime(0,t0);
    gn.gain.linearRampToValueAtTime(g,t0+.008);
    gn.gain.exponentialRampToValueAtTime(.0001,t0+dur);
    src.connect(bp); bp.connect(gn); gn.connect(master);
    src.start(t0); src.stop(t0+dur+.05);
  }
  function tone(t0,f0,f1,dur,g,type){
    const o=ac.createOscillator(); o.type=type||'sine';
    o.frequency.setValueAtTime(f0,t0);
    if(f1&&f1!==f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1,1),t0+dur);
    const gn=ac.createGain();
    gn.gain.setValueAtTime(0,t0);
    gn.gain.linearRampToValueAtTime(g,t0+.006);
    gn.gain.exponentialRampToValueAtTime(.0001,t0+dur);
    o.connect(gn); gn.connect(master);
    o.start(t0); o.stop(t0+dur+.05);
  }
  const api={
    S,
    unlock(){ ensure(); },
    tap(){ if(!S.on||!ensure())return; tone(ac.currentTime,950,700,.05,.05); },
    whoosh(){ if(!S.on||!ensure())return; noise(ac.currentTime,.16,900,240,.10); },
    thud(p){ if(!S.on||!ensure())return; const t=ac.currentTime;
      tone(t,120,48,.09,.10+.16*Math.min(p,1)); noise(t,.05,300,120,.05,'lowpass'); },
    chime(i){ if(!S.on||!ensure())return; const t=ac.currentTime;
      const f=520*Math.pow(1.09,Math.min(Math.max(i-1,0),7));
      tone(t,f,f,.28,.12); tone(t,f*1.5,f*1.5,.22,.06);
      noise(t,.12,2400,4200,.02,'highpass'); },
    clear(){ if(!S.on||!ensure())return; const t=ac.currentTime;
      [523,659,784,1047,1319].forEach((f,k)=>tone(t+k*.075,f,f,.35,.10,'triangle'));
      noise(t+.1,.7,3000,7000,.03,'highpass'); },
    undo(){ if(!S.on||!ensure())return; tone(ac.currentTime,520,330,.12,.06); },
    denied(){ if(!S.on||!ensure())return; tone(ac.currentTime,150,120,.08,.045,'square'); },
    bgm(on){
      S.bgmOn=on;
      if(!on){
        if(bgm){ try{ bgm.g.gain.linearRampToValueAtTime(0,ac.currentTime+.4);}catch(e){}
          const n=bgm; setTimeout(()=>{try{n.os.forEach(o=>o.stop());}catch(e){}},600); bgm=null; }
        return;
      }
      if(bgm||!ensure()) return;
      const t=ac.currentTime;
      const g=ac.createGain(); g.gain.setValueAtTime(0,t);
      g.gain.linearRampToValueAtTime(.034,t+1.4); g.connect(master);
      const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=660; lp.connect(g);
      const os=[110,164.81,220,329.63].map((f,i)=>{
        const o=ac.createOscillator(); o.type=i<2?'sine':'triangle';
        o.frequency.value=f; o.detune.value=(i%2?4:-3);
        const og=ac.createGain(); og.gain.value=i<2?.5:.22;
        o.connect(og); og.connect(lp); o.start(); return o;
      });
      const lfo=ac.createOscillator(); lfo.frequency.value=.07;
      const lg=ac.createGain(); lg.gain.value=.012;
      lfo.connect(lg); lg.connect(g.gain); lfo.start(); os.push(lfo);
      bgm={g,os};
    }
  };
  return api;
})();
