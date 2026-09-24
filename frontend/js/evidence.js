window.AmaraEvidence = class {
  constructor(config,map,journey,navigate,notify){
    this.config=config;this.map=map;this.journey=journey;this.navigate=navigate;this.notify=notify;
    this.cursor=0;this.feedBusy=false;this.job=null;this.result=null;this.lastSnapshot='';
    this.hasDemoCase=Boolean(config.has_demo_case);
    window.addEventListener('amara-replay-state',()=>{
      if(this.suspended()){
        clearTimeout(this.feedTimer);clearTimeout(this.jobTimer);this.feedRequest?.abort();this.jobRequest?.abort();
        document.querySelector('#evidence-progress').hidden=true;this.disableTools(true);
      }else{this.hydrate();this.refresh();if(this.job)this.pollJob();}
    });
    try{this.cursor=Number(sessionStorage.getItem(`amara-feed-${config.data_mode}`)||0);}catch(_){}
    document.addEventListener('click',event=>{
      const button=event.target.closest('[data-evidence]');
      if(button){const action=button.dataset.evidence;if(action==='switch-mode')this.switchMode(button.dataset.mode,'/evidence/');else if(action==='open-result')this.openResult();else this.createJob({action});}
      const updateLink=event.target.closest('[data-update-id]');
      if(updateLink)this.receipt(updateLink.dataset.updateId,'read');
      const dismiss=event.target.closest('[data-dismiss-update]');
      if(dismiss)this.receipt(dismiss.dataset.dismissUpdate,'dismiss').then(result=>{if(result.saved){dismiss.closest('.alert-card')?.remove();if(dismiss.closest('.journey-event'))this.map.hideEvent();}else this.notify('The update could not be dismissed. Please try again.');});
    });
    document.addEventListener('submit',event=>{
      if(event.target.matches('[data-evidence-search]')){event.preventDefault();this.createJob({action:'search',query:new FormData(event.target).get('query')});}
      if(event.target.matches('[data-evidence-submit]')){event.preventDefault();this.createJob({action:'submit',text:new FormData(event.target).get('text')});}
    });
    document.addEventListener('visibilitychange',()=>{
      clearTimeout(this.feedTimer);clearTimeout(this.jobTimer);
      if(!document.hidden){this.refresh();if(this.job)this.pollJob();}
    });
    const initialJob=new URLSearchParams(location.search).get('job');
    if(initialJob&&/^[a-f0-9-]{36}$/.test(initialJob)){this.job=initialJob;this.pollJob();}
    this.hydrate();
    this.refresh();
  }

  csrf(){return decodeURIComponent(document.cookie.split('; ').find(v=>v.startsWith('csrftoken='))?.split('=').slice(1).join('=')||'');}
  suspended(){return this.journey.replayActive||location.pathname.startsWith('/demo/evidence/');}
  async post(url,data){
    try{
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRFToken':this.csrf()},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
      return await AmaraHTTP.json(response,'The evidence request could not finish. Please try again.');
    }catch(error){throw error.userFacing?error:AmaraHTTP.failure('Could not reach the evidence service. Check your connection and try again.');}
  }

  async createJob(payload){
    if(this.suspended()){this.notify('End the demo replay before running a live evidence check.');return;}
    if(this.job||this.submitting)return;
    this.submitting=true;
    this.result=null;this.setProgress('Starting evidence check…');this.disableTools(true);
    try{
      const result=await this.post(this.config.evidence_jobs_url,payload);
      if(typeof result.job_id!=='string'||!/^[a-f0-9-]{36}$/.test(result.job_id))throw AmaraHTTP.failure('The evidence service did not confirm a new check. Please try again.');
      if(payload.action==='new_demo')this.hasDemoCase=true;
      this.job=result.job_id;
      if(payload.action==='new_demo'&&this.config.data_mode!=='demo'){location.assign(`/evidence/?job=${encodeURIComponent(this.job)}`);return;}
      this.pollJob();this.refresh();
    }catch(error){if(error.code==='no_case')this.hasDemoCase=false;this.disableTools(false);this.setProgress(error.message,true);}
    finally{this.submitting=false;}
  }

  disableTools(disabled){document.querySelectorAll('[data-evidence]:not([data-evidence="switch-mode"]),[data-evidence-search] button,[data-evidence-submit] button').forEach(button=>{const needsCase=['support','conflict','clearance','reanalyze'].includes(button.dataset.evidence)||Boolean(button.closest('[data-evidence-submit]'));button.disabled=disabled||(needsCase&&!this.hasDemoCase);});}
  hydrate(){this.disableTools(Boolean(this.job||this.submitting||this.suspended()));this.renderResult();}
  clearJobLink(id){const url=new URL(location.href);if(url.searchParams.get('job')===id){url.searchParams.delete('job');history.replaceState({},'',url.pathname+url.search+url.hash);}}
  setProgress(text,failed=false){
    const bar=document.querySelector('#evidence-progress');bar.hidden=false;bar.textContent=text;bar.dataset.failed=String(failed);
    const result=document.querySelector('#evidence-job-result');
    if(result){result.hidden=false;result.replaceChildren();const p=document.createElement('p');p.textContent=text;result.append(p);}
  }

  async pollJob(){
    clearTimeout(this.jobTimer);
    if(!this.job||document.hidden||this.suspended())return;
    const currentJob=this.job;
    if(this.pollingJob===currentJob)return;
    this.pollingJob=currentJob;
    const controller=new AbortController();this.jobRequest=controller;
    const timeout=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(`/api/evidence/jobs/${encodeURIComponent(currentJob)}/`,{signal:controller.signal});
      if(this.suspended())return;
      if([400,403,404,410].includes(response.status)){
        if(this.job!==currentJob)return;
        this.job=null;this.result={status:'failed',error_code:'job_unavailable',progress:'This check is not available in this browser. Start a new check.',result:{}};
        this.clearJobLink(currentJob);this.setProgress(this.result.progress,true);this.disableTools(false);this.renderResult();return;
      }
      if(!response.ok)throw new Error();
      const data=await response.json();if(this.job!==currentJob||this.suspended())return;
      if(data.data_mode==='demo'&&data.incident_id)this.hasDemoCase=true;
      this.setProgress(data.progress,data.status==='failed');
      if(data.status==='succeeded'||data.status==='failed'){
        this.job=null;this.result=data;this.disableTools(false);this.renderResult();this.refresh();
        this.clearJobLink(currentJob);
        if(data.status==='succeeded')setTimeout(()=>{if(!this.job)document.querySelector('#evidence-progress').hidden=true;},4500);
        return;
      }
    }catch(_){if(this.job===currentJob&&!this.suspended())this.setProgress('Checking progress… The last briefing remains available.');}
    finally{clearTimeout(timeout);if(this.pollingJob===currentJob)this.pollingJob=null;}
    if(!this.suspended())this.jobTimer=setTimeout(()=>this.pollJob(),1500);
  }

  renderResult(){
    const target=document.querySelector('#evidence-job-result');
    if(!target||!this.result)return;
    const data=this.result;target.hidden=false;target.replaceChildren();
    const heading=document.createElement('h2');heading.textContent=data.error_code==='job_unavailable'?'Check unavailable':data.result?.no_sources?'No matching reports found':data.status==='succeeded'?'Evidence check complete':'Evidence check could not finish';
    const text=document.createElement('p');text.textContent=data.status==='succeeded'?data.summary:data.progress;
    target.append(heading,text);
    if(data.status==='succeeded'){
      const meta=document.createElement('small');meta.textContent=`${data.data_mode==='demo'?'Fictional demo inputs':'Public-source inputs'} · ${data.result.report_count} reports · ${data.result.status} · ${data.result.changed?'briefing revised':'no new material change'}`;
      const link=document.createElement('button');link.type='button';link.className='text-link';link.dataset.evidence='open-result';link.textContent='Read the sources and briefing →';target.append(meta,link);
    }
  }

  async switchMode(mode,url){
    try{await this.post('/api/evidence/mode/',{mode});location.assign(url);}catch(error){this.notify(error.message);}
  }
  openResult(){if(!this.result)return;if(this.result.data_mode!==this.config.data_mode)this.switchMode(this.result.data_mode,this.result.detail_url);else this.navigate(this.result.detail_url);}
  receipt(id,action,context='area'){return this.post(`/api/updates/${id}/receipt/`,{action,context}).catch(()=>({show:false}));}

  relevance(incident,prefs,previouslyNotified=false){
    if(prefs.muted)return null;
    if(incident.has_relevant_evidence===false)return previouslyNotified?{context:'area',label:'An earlier evidence update has been revised'}:null;
    const route=this.journey.route?.geometry.coordinates;
    if(route&&incident.coordinates&&AmaraGeo.relevant([incident],route).length)return {context:'route',label:'Evidence update · near your planned route'};
    if(prefs.follow_market_road&&(incident.template_slug==='market-junction'||incident.id==='market-junction'))return {context:'followed_road',label:'Evidence update · on your followed road'};
    if(prefs.follow_yaba_area&&incident.area_scope==='yaba')return {context:'area',label:incident.coordinates?'Evidence update · Yaba area':'Yaba evidence update · exact location unknown'};
    if(previouslyNotified)return {context:'area',label:'An earlier evidence update has been revised'};
    return null;
  }

  async refresh(){
    clearTimeout(this.feedTimer);
    if(document.hidden||this.suspended())return;
    if(this.feedBusy){this.refreshAgain=true;return;}
    this.feedBusy=true;
    const controller=new AbortController();this.feedRequest=controller;
    const timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(`${this.config.feed_url}?after=${this.cursor}`,{signal:controller.signal});
      if(!response.ok)throw new Error();
      const feed=await response.json();
      if(this.suspended())return;
      if(feed.mode!==this.config.data_mode){location.reload();return;}
      const progressBar=document.querySelector('#evidence-progress');
      if(progressBar.dataset.stale==='true'&&!this.job)progressBar.hidden=true;
      progressBar.dataset.stale='false';this.lastFeedError=null;
      const signature=JSON.stringify(feed.incidents.map(i=>[i.id,i.revision,i.summary,i.analyzed_at]));
      if(signature!==this.lastSnapshot){
        const previous=this.lastSnapshot;
        this.journey.incidents=feed.incidents;
        this.journey.scene={...this.journey.scene,incidents:feed.incidents};
        if(this.journey.route)this.journey.publishRoute();else this.map.setScene({...this.map.scene,incidents:feed.incidents});
        const page=document.querySelector('.workspace').dataset.screen;
        if(previous&&['overview','updates'].includes(page))await this.navigate(location.href,false);
        else if(previous&&page==='incident')this.showRefreshNotice();
        this.lastSnapshot=signature;
      }
      const latest=new Map();for(const update of feed.updates)latest.set(update.incident.id,update);
      for(const update of latest.values()){
        if(update.delivered||update.dismissed)continue;
        const match=this.relevance(update.incident,feed.preferences,update.previously_notified);if(!match)continue;
        const claimed=await this.receipt(update.id,'claim',match.context);
        if(this.suspended())return;
        if(!claimed.show)continue;
        const event={id:`evidence-${update.id}`,kind:update.incident.status==='unconfirmed'?'caution':'report',kicker:`AI-ASSISTED UPDATE · ${update.incident.is_demo?'DEMO REPORTS':'PUBLIC SOURCES'}`,title:update.incident.title,body:update.incident.summary,observation_note:update.incident.observed_at?`Observation: ${new Date(update.incident.observed_at).toLocaleString()}`:'Observation time not supplied',incident:update.incident,update_id:update.id};
        if(this.journey.activity==='demo'){
          this.journey.revealedReports.add(update.incident.id);this.journey.publishRoute();
        }
        this.map.showEvent(event);
        this.notify(`${match.label}: ${update.incident.status_label}`);
      }
      this.cursor=feed.cursor;
      try{sessionStorage.setItem(`amara-feed-${this.config.data_mode}`,String(this.cursor));}catch(_){}
      if(feed.pending_job&&!this.job){this.job=feed.pending_job;this.disableTools(true);this.pollJob();}
    }catch(error){
      if(this.suspended())return;
      this.lastFeedError={name:error.name,message:String(error.message||'Update failed').slice(0,180)};
      const bar=document.querySelector('#evidence-progress');bar.dataset.stale='true';
      if(!this.job){bar.hidden=false;bar.textContent='Updates could not refresh. Showing the last available briefing.';}
    }finally{
      clearTimeout(timeout);
      this.feedBusy=false;
      if(!this.suspended())this.feedTimer=setTimeout(()=>this.refresh(),this.refreshAgain?0:8000);this.refreshAgain=false;
    }
  }

  showRefreshNotice(){
    if(document.querySelector('#new-evidence-notice'))return;
    const notice=document.createElement('div');notice.id='new-evidence-notice';notice.className='evidence-note';notice.textContent='A newer evidence revision is available. ';
    const button=document.createElement('button');button.className='text-link';button.textContent='Refresh briefing';button.addEventListener('click',()=>this.navigate(location.href,false));notice.append(button);document.querySelector('#panel').prepend(notice);
  }
};
