(function(root,factory){
  const Player=factory();
  if(typeof module==='object'&&module.exports)module.exports=Player;
  else root.AmaraDemoPlayer=Player;
})(globalThis,function(){
  // A presentation clock, not a GPS provider. Movement stays on the supplied road geometry.
  return class AmaraDemoPlayer {
    constructor({route,geo,reportIds=[],replayEvents=null,onFrame=()=>{},onCue=()=>{},onState=()=>{},now=()=>performance.now(),requestFrame=callback=>globalThis.requestAnimationFrame(callback),cancelFrame=id=>globalThis.cancelAnimationFrame(id)}){
      this.route=route;this.geo=geo;this.onFrame=onFrame;this.onCue=onCue;this.onState=onState;
      this.now=now;this.requestFrame=requestFrame;this.cancelFrame=cancelFrame;
      this.duration=80000;this.elapsed=0;this.state='idle';this.frameId=null;this.generation=0;
      this.fired=new Set();this.total=0;this.cumulative=[0];
      for(let i=1;i<route.length;i++){this.total+=geo.distance(route[i-1],route[i]);this.cumulative.push(this.total);}
      const times=[8000,22000,48000];
      this.cues=reportIds.slice(0,3).map((id,index)=>({id:`report-${id}`,type:'report',reportId:id,at:times[index]}));
      if(replayEvents)this.cues=replayEvents.flatMap(event=>[
        {id:`${event.key}-received`,type:'report-received',eventKey:event.key,at:event.at_ms},
        {id:`${event.key}-checking`,type:'report-checking',eventKey:event.key,at:event.at_ms+500},
        {id:`${event.key}-reviewed`,type:'report-reviewed',eventKey:event.key,at:event.at_ms+event.review_after_ms},
      ]);
      this.cues.push({id:'wrong-way',type:'wrong-way',at:29500},{id:'back-on-route',type:'back-on-route',at:37500},{id:'arrived',type:'arrived',at:this.duration});
      this.cues.sort((a,b)=>a.at-b.at);
    }

    point(fraction){
      const metres=Math.max(0,Math.min(1,fraction))*this.total;
      let lo=1,hi=this.route.length-1;
      while(lo<hi){const mid=Math.floor((lo+hi)/2);if(this.cumulative[mid]<metres)lo=mid+1;else hi=mid;}
      const i=Math.max(1,lo),length=this.cumulative[i]-this.cumulative[i-1];
      const t=length?(metres-this.cumulative[i-1])/length:0;
      return [this.route[i-1][0]+(this.route[i][0]-this.route[i-1][0])*t,this.route[i-1][1]+(this.route[i][1]-this.route[i-1][1])*t];
    }

    sample(){
      const t=this.elapsed;
      const backwards=t>28000&&t<36000;
      const fraction=t<=28000 ? .45*t/28000 : t<=36000 ? .45-.10*(t-28000)/8000 : .35+.65*(t-36000)/44000;
      return {elapsed:t,duration:this.duration,fraction:Math.max(0,Math.min(1,fraction)),coordinates:this.point(fraction),backwards,complete:t>=this.duration};
    }

    emit(){
      this.onFrame(this.sample());
      for(const cue of this.cues){if(cue.at<=this.elapsed&&!this.fired.has(cue.id)){this.fired.add(cue.id);this.onCue(cue,this.sample());}}
    }

    start(){
      this.stop();this.elapsed=0;this.fired.clear();this.state='playing';this.last=this.now();this.lastPaint=-Infinity;
      this.onState(this.state);this.emit();this.schedule();
    }

    schedule(){
      const generation=this.generation;
      this.frameId=this.requestFrame(()=>{
        this.frameId=null;
        if(generation!==this.generation||this.state!=='playing')return;
        const now=this.now();
        this.elapsed=Math.min(this.duration,this.elapsed+Math.max(0,Math.min(250,now-this.last)));this.last=now;
        if(now-this.lastPaint>=32||this.elapsed===this.duration){this.lastPaint=now;this.emit();}
        if(this.elapsed===this.duration){this.state='complete';this.onState(this.state);return;}
        this.schedule();
      });
    }

    pause(){
      if(this.state!=='playing')return;
      ++this.generation;if(this.frameId!==null)this.cancelFrame(this.frameId);this.frameId=null;
      this.state='paused';this.onState(this.state);
    }

    resume(){
      if(this.state!=='paused')return;
      this.state='playing';this.last=this.now();this.onState(this.state);this.schedule();
    }

    next(){
      const cue=this.cues.find(item=>item.at>this.elapsed+1&&!['report-checking','report-reviewed'].includes(item.type));
      if(!cue)return;
      this.elapsed=cue.at;this.last=this.now();this.emit();
      if(this.elapsed===this.duration){++this.generation;if(this.frameId!==null)this.cancelFrame(this.frameId);this.frameId=null;this.state='complete';this.onState(this.state);}
    }

    stop(){
      ++this.generation;if(this.frameId!==null)this.cancelFrame(this.frameId);this.frameId=null;this.state='idle';
    }
  };
});
