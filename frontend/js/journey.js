window.AmaraJourney = class {
  constructor(config, map, notify) {
    this.config = config;
    this.map = map;
    this.notify = notify;
    this.mode = 'driving';
    this.places = {origin: null, destination: null};
    this.route = null;
    this.activity = null;
    this.ended = false;
    this.busy = false;
    this.serial = 0;
    this.searchSerial = 0;
    this.suggestions = {origin: [], destination: []};
    this.locateSerial = 0;
    this.gps = null;
    this.demoFraction = 0;
    this.reportState = '';
    this.revealedReports = new Set();
    this.demoEvents = [];
    this.demoTrail = [];
    this.replayActive = false;
    this.savedScenario = null;
    this.tracker = new AmaraLocation({onChange: state => this.onLocation(state)});
    document.addEventListener('input', event => this.onInput(event));
    document.addEventListener('keydown', event => this.onKey(event));
    document.addEventListener('change', event => {
      if (event.target.matches('[name="mode"], [name="review-mode"]')) {
        const next = event.target.value;
        if(this.route?.replay)this.loadSavedReplay(next,Boolean(this.activity==='demo'));
        else if (this.route) this.calculate(next); else this.mode = next;
      }
    });
    document.addEventListener('click', event => {
      const choice = event.target.closest('[data-place-choice]');
      if (choice) { this.selectPlace(choice.dataset.field, this.suggestions[choice.dataset.field]?.[Number(choice.dataset.placeChoice)]); return; }
      if (!event.target.closest('.place-field')) { this.closeSuggestions('origin'); this.closeSuggestions('destination'); }
      const action = event.target.closest('[data-journey]')?.dataset.journey;
      if (action) this.action(action);
    });
    document.addEventListener('submit', event => {
      if (event.target.matches('[data-journey-form]')) { event.preventDefault(); this.calculate(this.mode); }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    window.addEventListener('pagehide', () => this.pause());
  }

  inside(point) {
    const [west, south, east, north] = this.config.lagos_bounds;
    return AmaraGeo.valid(point) && point[0] >= west && point[0] <= east && point[1] >= south && point[1] <= north;
  }

  hydrate(scene) {
    this.scene = scene;
    if(!this.replayActive){this.liveScene=scene;this.incidents=scene.incidents||[];}
    if(this.activity==='demo'&&scene.page!=='journey'){
      this.pauseDemo();
      const context=document.createElement('div');context.id='journey-reading-context';context.className='journey-reading-context';
      const label=document.createElement('span');label.textContent='Journey paused while you read.';
      const resume=document.createElement('button');resume.type='button';resume.className='text-link';resume.dataset.journey='return-to-journey';resume.textContent='Continue journey →';
      context.append(label,resume);document.querySelector('#panel').prepend(context);
    }
    if (!this.route && scene.mode) this.mode = scene.mode;
    this.sampleOrigin = scene.sample_origin || this.sampleOrigin || [3.374, 6.5094];
    this.sampleDestination = scene.sample_destination || this.sampleDestination || [3.3796, 6.5182];
    this.sampleOriginLabel = scene.sample_origin_label || this.sampleOriginLabel || 'Sample start · Yaba';
    this.sampleDestinationLabel = scene.sample_destination_label || this.sampleDestinationLabel || 'Sample destination · Alagomeji';
    ++this.searchSerial;
    ++this.locateSerial;
    this.searchRequest?.abort();
    this.map.setScene(this.replayActive?{...scene,incidents:this.incidents}:scene, Boolean(this.route));
    if (this.route) this.publishRoute();
    if (scene.selected_incident && this.activity) {
      if(this.activity==='demo')this.pauseDemo();
      const selected=this.incidents.find(incident=>incident.id===scene.selected_incident);
      if(selected?.coordinates){this.map.following=false;this.map.previewPoint(selected.coordinates);}
    }
    for (const field of ['origin', 'destination']) {
      const input = document.querySelector(`[data-place="${field}"]`);
      if (input && this.places[field]) input.value = this.places[field].label;
    }
    if (!this.route) {
      try { if (sessionStorage.getItem('amara-journey-interrupted')) this.plannerStatus('Tracking stopped when the page closed. Choose a route and start again explicitly.'); } catch (_) {}
    }
    this.render();
  }

  plannerStatus(text) { const target = document.querySelector('#planner-status'); if (target) target.textContent = text; }
  routeStatus(text) { const target = document.querySelector('#route-status'); if (target) target.textContent = text; }
  placeFeedback(field, text) { const target = document.querySelector(`#${field}-feedback`); if (target) target.textContent = text; }

  onInput(event) {
    const field = event.target.dataset.place;
    if (!field) return;
    this.places[field] = null;
    ++this.searchSerial;
    this.searchRequest?.abort();
    clearTimeout(this.searchTimer);
    this.closeSuggestions('origin');this.closeSuggestions('destination');
    this.placeFeedback(field, '');
    this.updateReady();
    const query = event.target.value.trim();
    if (query.length < 3) return;
    const serial = this.searchSerial;
    this.searchTimer = setTimeout(() => this.search(field, query, serial), 350);
  }

  async search(field, query, serial) {
    this.searchRequest = new AbortController();
    this.placeFeedback(field, 'Searching Lagos addresses and landmarks…');
    try {
      const response = await fetch(`${this.config.places_url}?q=${encodeURIComponent(query)}`, {signal: this.searchRequest.signal});
      const data = await AmaraHTTP.json(response,'Address search is temporarily unavailable. Try again or pick a point on the map.');
      if (serial !== this.searchSerial) return;
      if (!Array.isArray(data.places)) throw AmaraHTTP.failure('Address search is temporarily unavailable. Try again or pick a point on the map.');
      const list = document.querySelector(`#${field}-options`), input = document.querySelector(`[data-place="${field}"]`);
      if (!list || !input) return;
      this.suggestions[field] = data.places;
      list.replaceChildren();
      this.suggestions[field].forEach((place, index) => {
        const li = document.createElement('li'), button = document.createElement('button');
        button.type = 'button'; button.role = 'option'; button.setAttribute('aria-selected', 'false');
        const name = document.createElement('span'); name.className = 'place-result-name'; name.textContent = place.label; button.append(name);
        if (place.source_label) { const source = document.createElement('small'); source.className = 'place-result-source'; source.textContent = place.source_label; button.append(source); }
        button.dataset.placeChoice = String(index); button.dataset.field = field;
        li.setAttribute('role', 'presentation'); li.append(button); list.append(li);
      });
      list.hidden = this.suggestions[field].length === 0;
      input.setAttribute('aria-expanded', String(!list.hidden));
      this.placeFeedback(field, this.suggestions[field].length ? 'Select a result to confirm this point.' : 'No match for this name. Pick a point on the map, or use Start laptop demo above.');
    } catch (error) { if (serial === this.searchSerial && error.name !== 'AbortError') this.placeFeedback(field, AmaraHTTP.explain(error,'Could not reach address search. Check your connection, or pick a point on the map.')); }
  }

  closeSuggestions(field) {
    const list = document.querySelector(`#${field}-options`);
    if (list) list.hidden = true;
    document.querySelector(`[data-place="${field}"]`)?.setAttribute('aria-expanded', 'false');
  }

  onKey(event) {
    const field = event.target.dataset.place || event.target.dataset.field;
    if (event.key === 'Escape') { if (field) this.closeSuggestions(field); this.map.cancelPick(); return; }
    if (event.key === 'Enter' && event.target.dataset.place && this.suggestions[field]?.length === 1 && !document.querySelector(`#${field}-options`).hidden) {
      event.preventDefault(); this.selectPlace(field, this.suggestions[field][0]); return;
    }
    if (!field || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const options = [...document.querySelectorAll(`#${field}-options:not([hidden]) button`)];
    if (!options.length) return;
    event.preventDefault();
    const index = options.indexOf(document.activeElement);
    options[index<0?(event.key==='ArrowDown'?0:options.length-1):(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length].focus();
  }

  selectPlace(field, place) {
    if (!place || !this.inside(place.coordinates)) { this.plannerStatus('Choose a point within Lagos.'); return; }
    ++this.searchSerial;
    ++this.locateSerial;
    this.searchRequest?.abort();
    this.places[field] = {label: place.label, coordinates: [...place.coordinates]};
    const input = document.querySelector(`[data-place="${field}"]`);
    if (input) input.value = place.label;
    this.closeSuggestions(field);
    this.placeFeedback(field, 'Point selected.');
    this.plannerStatus('');
    this.map.previewPoint(place.coordinates);
    this.updateReady();
  }

  updateReady() {
    const button = document.querySelector('#review-route');
    if (button) button.disabled = this.busy || !this.places.origin || !this.places.destination;
    document.querySelectorAll('[data-journey="laptop-demo"], [data-journey="sample"]').forEach(button => { button.disabled = this.busy; });
  }

  async launchLaptopDemo() {
    return this.loadSavedReplay(this.mode,true);
  }

  setReplay(active){
    this.replayActive=active;
    const label=document.querySelector('#data-mode-label');if(label)label.textContent=active?'Demo replay':this.config.is_demo?'Demo data':'Public sources';
    window.dispatchEvent(new CustomEvent('amara-replay-state',{detail:{active}}));
  }

  async loadSavedReplay(mode,autoplay=true){
    if (this.busy) return;
    const serial=++this.serial;
    this.routeRequest?.abort();this.stopDemoClock();this.tracker.stop();
    if(!this.replayActive)this.liveScene={...this.scene,incidents:this.incidents};
    this.setReplay(true);this.busy=true;this.render();
    const message = document.querySelector('#demo-launch-status');
    if(message)message.textContent='Loading the saved demo…';
    try{
      if(!this.savedScenario){
        const response=await fetch(this.config.demo_scenario_url,{signal:AbortSignal.timeout(12000)});
        const data=await AmaraHTTP.json(response,'The saved demo could not load. Please try again.');
        if(data.mode!=='demo_replay'||!data.routes?.walking||!data.routes?.driving||!Array.isArray(data.events))throw AmaraHTTP.failure('The saved demo is incomplete. Prepare it before presenting.');
        this.savedScenario=data;
      }
      if(serial!==this.serial)return;
      this.mode=mode;this.route={...this.savedScenario.routes[mode],replay:true};this.ended=false;
      this.places={origin:{label:this.savedScenario.origin.label,coordinates:[...this.savedScenario.origin.coordinates]},destination:{label:this.savedScenario.destination.label,coordinates:[...this.savedScenario.destination.coordinates]}};
      this.resetReplayIncidents();this.publishRoute();this.map.fitRoute();
      this.routeStatus('Saved route and AI results · demo replay · no live analysis during playback.');
      if(message)message.textContent='';
      this.busy=false;this.render();
      if(autoplay)this.start('demo');
    }catch(error){
      this.busy=false;this.setReplay(false);this.activity=null;this.map.demoView(false);
      this.incidents=this.liveScene?.incidents||[];
      if(message)message.textContent=AmaraHTTP.explain(error,'The saved demo could not load. Check the connection to the app and try again.');
      this.render();
    }
  }

  resetReplayIncidents(){
    const unique=new Map();
    for(const event of this.savedScenario.events){
      if(!unique.has(event.result.incident.id))unique.set(event.result.incident.id,{...event.result.incident,status:'unconfirmed',status_label:'Not yet reviewed',summary:event.received_text,review_state:'received',detail_url:event.detail_url+'?state=received'});
    }
    this.incidents=[...unique.values()];
  }

  locate() {
    if (!isSecureContext || !navigator.geolocation) { this.plannerStatus('Location needs HTTPS or localhost. Search or pick a starting point instead.'); return; }
    const serial = ++this.locateSerial;
    this.plannerStatus('Waiting for your location permission…');
    navigator.geolocation.getCurrentPosition(position => {
      if (serial !== this.locateSerial) return;
      const point = [position.coords.longitude, position.coords.latitude];
      if (!this.inside(point)) { this.plannerStatus('Your location is outside this Lagos planning area. Choose a Lagos starting point manually or try the sample route.'); return; }
      if (!Number.isFinite(position.coords.accuracy) || Date.now() - position.timestamp > 30000) { this.plannerStatus('That location is stale or unavailable. Pick a starting point instead.'); return; }
      this.selectPlace('origin', {label: 'My current location', coordinates: point});
      this.plannerStatus(`Location sampled · accuracy ±${Math.round(position.coords.accuracy)} m. No continuous tracking has started.`);
    }, error => {
      if (serial !== this.locateSerial) return;
      this.plannerStatus(error.code === 1 ? 'Location permission was denied. Search or pick a starting point instead.' : 'Your location could not be obtained. Try again or choose a point manually.');
    }, {enableHighAccuracy: true, timeout: 12000, maximumAge: 5000});
  }

  async calculate(mode, explicitOrigin = null, demoRoute = Boolean(this.route?.demo_route)) {
    if (!this.places.origin || !this.places.destination) { this.plannerStatus('Choose both a starting point and destination from search or the map.'); return false; }
    const serial = ++this.serial;
    this.routeRequest?.abort();
    this.routeRequest = new AbortController();
    const oldMode = this.mode;
    const demoWasPlaying=this.activity==='demo'&&this.player?.state==='playing';
    const wasDemo=this.activity==='demo';
    let restartDemo=false;
    if(wasDemo)this.pauseDemo();
    const current = this.gps?.fresh && this.inside(this.gps.sample.coordinates) ? this.gps.sample.coordinates : null;
    const origin = explicitOrigin || (this.activity === 'live' && current ? current : this.places.origin.coordinates);
    this.busy = true; this.render();
    this.plannerStatus('Finding a real route…'); this.routeStatus('Updating route…');
    try {
      const csrf = document.cookie.split('; ').find(value => value.startsWith('csrftoken='))?.split('=').slice(1).join('=');
      const response = await fetch(this.config.routes_url, {
        method: 'POST', signal: this.routeRequest.signal,
        headers: {'Content-Type': 'application/json', 'X-CSRFToken': decodeURIComponent(csrf || '')},
        body: JSON.stringify({origin_lng: origin[0], origin_lat: origin[1], destination_lng: this.places.destination.coordinates[0], destination_lat: this.places.destination.coordinates[1], mode, demo_route:demoRoute}),
      });
      const data = await AmaraHTTP.json(response,'The route service is temporarily unavailable. Please try again.');
      if (serial !== this.serial) return false;
      if (!data.route || data.route.source !== 'mapbox' || !Array.isArray(data.route.geometry?.coordinates)) throw AmaraHTTP.failure(data.error || 'The route service returned an incomplete route. Please try again.');
      this.route = data.route; this.mode = mode; this.ended = false;
      restartDemo=wasDemo;
      this.lastLiveAlong = null;
      this.publishRoute();
      this.map.fitRoute();
      this.plannerStatus('');
      const snapped = (this.route.snap_distances_m || []).some(distance => distance > 50);
      this.routeStatus(this.route.demo_route ? 'Prepared demo route via the fictional Market Junction report.' : snapped ? 'The route uses nearby routable streets at your selected points. Check the map.' : 'Real Mapbox route · estimate, not a safety assessment.');
      return true;
    } catch (error) {
      if (serial !== this.serial || error.name === 'AbortError') return false;
      this.mode = oldMode;
      const text = AmaraHTTP.explain(error,'Could not reach the route service. Check your connection and try again.');
      this.plannerStatus(text); this.routeStatus(`${text}${this.route ? ' Previous route retained.' : ''}`);
      return false;
    } finally {
      if (serial === this.serial) {
        this.busy=false;
        if(restartDemo&&this.activity==='demo'){this.start('demo');if(!demoWasPlaying)this.pauseDemo();}
        else if(wasDemo&&demoWasPlaying&&this.activity==='demo')this.resumeDemo();
        this.render();
      }
    }
  }

  publishRoute() {
    if (!this.route) return;
    this.relevant = AmaraGeo.relevant(this.incidents || [], this.route.geometry.coordinates);
    const visible=this.activity==='demo'?this.relevant.filter(report=>this.revealedReports.has(report.id)):[...this.relevant];
    const selected=this.incidents.find(incident=>incident.id===this.scene.selected_incident);
    if(selected&&!visible.some(incident=>incident.id===selected.id))visible.push(selected);
    this.map.setRoute({route: this.route.geometry.coordinates, route_visible: true, origin: this.route.origin, destination: this.route.destination, destination_label: this.places.destination.label, mode: this.mode, incidents: visible, route_source: 'mapbox'});
    this.renderReports();
  }

  renderReports() {
    const target = document.querySelector('#route-reports');
    if (!target || !this.route) return;
    if(this.activity==='demo'){this.renderDemoFeed(target);return;}
    const positionState=this.activity==='demo'?this.demoState:this.gps;
    const accurate = Boolean(this.activity && positionState?.fresh);
    const projection = accurate ? AmaraGeo.project(positionState.sample.coordinates, this.route.geometry.coordinates) : null;
    const onRoute = projection && projection.distance <= Math.max(75, positionState.sample.accuracy * 2);
    const reports = onRoute ? this.relevant.filter(report => report.along_m >= projection.along - 20) : this.relevant;
    const prefix=this.config.is_demo?'demo ':'';
    const title = onRoute ? `${reports.length} ${prefix}report${reports.length === 1 ? '' : 's'} ahead` : `${reports.length} ${prefix}report${reports.length === 1 ? '' : 's'} near this route`;
    const signature = JSON.stringify([title, reports.map(report => report.id)]);
    if (target.dataset.signature === signature) return;
    target.dataset.signature = signature;
    target.replaceChildren();
    const heading = document.createElement('h2'); heading.className = 'text-sm font-semibold'; heading.textContent = title; target.append(heading);
    if (!reports.length) { const text = document.createElement('p'); text.textContent = 'No matching reports does not establish that the road is safe.'; target.append(text); }
    let extra;
    if(reports.length>1){extra=document.createElement('details');extra.className='more-route-reports';const summary=document.createElement('summary');summary.textContent=`${reports.length-1} more report${reports.length>2?'s':''}`;extra.append(summary);}
    for (const [index,report] of reports.entries()) {
      const link = document.createElement('a'); link.href = report.detail_url; link.dataset.panel = ''; link.className = 'route-report-link';
      const label = document.createElement('strong'); label.textContent = report.title;
      const detail = document.createElement('span'); detail.textContent = `${report.status_label} · ${report.is_demo?'fictional evidence':'public-source evidence'}`;
      link.append(label, detail); (index===0?target:extra).append(link);
    }
    if(extra)target.append(extra);
  }

  onLocation(state) {
    this.gps = state;
    if (this.activity !== 'live') return;
    this.movingBack = false;
    if(state.fresh && this.route){const projection=AmaraGeo.project(state.sample.coordinates,this.route.geometry.coordinates);if(projection&&projection.distance<=Math.max(75,state.sample.accuracy*2)){this.movingBack=this.lastLiveAlong!=null&&projection.along<this.lastLiveAlong-Math.max(25,state.sample.accuracy*2);this.lastLiveAlong=projection.along;}}
    this.map.setUserPosition(state.sample, {fresh: state.fresh, stale:!['tracking','approximate'].includes(state.status), approximate:state.status==='approximate', simulated: false, follow: state.status === 'tracking' || state.status === 'approximate'});
    if (state.fresh && !this.initialFixHandled) {
      this.initialFixHandled = true;
      if (this.inside(state.sample.coordinates) && AmaraGeo.distance(state.sample.coordinates, this.route.origin) > 100) this.calculate(this.mode, state.sample.coordinates);
    }
    this.render();
  }

  start(kind) {
    if (!this.route || this.busy) return;
    if(kind==='live'&&this.route.replay){
      this.setReplay(false);this.incidents=this.liveScene?.incidents||[];
      this.calculate(this.mode,null,false).then(success=>{if(success)this.start('live');});return;
    }
    this.tracker.stop(); this.stopDemoClock();
    this.activity = kind; this.ended = false; this.initialFixHandled = false; this.demoPaused = false; this.lastLiveAlong = null;
    this.map.demoView(kind==='demo');
    try { sessionStorage.setItem('amara-journey-interrupted', '1'); } catch (_) {}
    if (kind === 'live') {this.publishRoute();this.tracker.start();}
    else {
      if(this.route.replay){this.setReplay(true);this.resetReplayIncidents();}
      this.demoIndex=0;this.demoPaused=false;this.demoComplete=false;this.demoFrame=null;
      this.revealedReports.clear();this.demoEvents=[];this.demoTrail=[];this.currentDemoEvent=null;this.lastDemoUI=-1000;this.lastTrail=-1000;
      this.map.hideEvent();this.map.setTrail([]);this.map.setUserPosition(null);this.publishRoute();
      this.player=new AmaraDemoPlayer({route:this.route.geometry.coordinates,geo:AmaraGeo,reportIds:this.relevant.map(report=>report.id),replayEvents:this.route.replay?this.savedScenario.events:null,
        onFrame:frame=>this.onDemoFrame(frame),onCue:(cue,frame)=>this.onDemoCue(cue,frame),onState:state=>{
          this.demoPaused=state==='paused';this.demoComplete=state==='complete';this.renderStatus();
        }});
      this.mapReadyHandler=()=>{if(this.activity==='demo'&&!this.demoPaused&&!document.hidden&&this.player.state==='idle'){this.map.fitRoute();this.player.start();}};
      if(this.map.ready)this.mapReadyHandler();else window.addEventListener('amara-map-ready',this.mapReadyHandler);
    }
    this.render();
  }

  onDemoFrame(frame){
    if(this.activity!=='demo')return;
    this.demoFrame=frame;this.demoFraction=frame.fraction;
    this.demoState={sample:{coordinates:frame.coordinates,accuracy:12,timestamp:Date.now()},fresh:true,backwards:frame.backwards,offRoute:false,label:frame.backwards?'Amara is heading back':'Amara is moving toward home'};
    this.map.setUserPosition(this.demoState.sample,{fresh:true,simulated:true,follow:true,continuous:true});
    if(frame.elapsed-this.lastTrail>=250||frame.complete){this.lastTrail=frame.elapsed;this.demoTrail.push([...frame.coordinates]);if(this.demoTrail.length>360)this.demoTrail.shift();this.map.setTrail(this.demoTrail);}
    if(frame.elapsed-this.lastDemoUI>=500||frame.complete){this.lastDemoUI=frame.elapsed;this.renderStatus();if(this.currentDemoEvent&&this.currentDemoEvent.kind!=='complete'&&frame.elapsed-this.currentDemoEvent.elapsed>11000){this.map.hideEvent(this.currentDemoEvent.id);this.currentDemoEvent=null;}}
  }

  onDemoCue(cue,frame){
    if(this.activity!=='demo')return;
    if(cue.type.startsWith('report-')&&cue.eventKey){this.onReplayReport(cue,frame);return;}
    let event;
    if(cue.type==='report'){
      const report=this.relevant.find(item=>item.id===cue.reportId);if(!report)return;
      this.revealedReports.add(report.id);this.publishRoute();
      event={id:cue.id,elapsed:frame.elapsed,kind:report.status==='unconfirmed'?'caution':'report',kicker:'NEW DEMO REPORT · ON YOUR ROUTE',title:report.title,body:report.summary,incident:report};
    }else if(cue.type==='wrong-way'){
      event={id:cue.id,elapsed:frame.elapsed,kind:'caution',kicker:'JOURNEY UPDATE · SIMULATION',title:'Amara is heading back',body:'Movement is now going back along the planned route. Amara makes the change visible instead of leaving you guessing.'};
    }else if(cue.type==='back-on-route'){
      event={id:cue.id,elapsed:frame.elapsed,kind:'recovery',kicker:'JOURNEY UPDATE · SIMULATION',title:'Back toward the destination',body:'The marker is moving toward Alagomeji again. Your route and earlier updates remain in view.'};
    }else{
      event={id:cue.id,elapsed:frame.elapsed,kind:'complete',kicker:'SIMULATED JOURNEY COMPLETE',title:'Journey complete',body:'Amara reached the end of the planned route. You saw the journey unfold, with updates along the way.'};
    }
    this.demoEvents.push(event);this.demoIndex=this.demoEvents.length;this.currentDemoEvent=event;this.map.showEvent(event);this.renderReports();
  }

  onReplayReport(cue,frame){
    const saved=this.savedScenario.events.find(event=>event.key===cue.eventKey);if(!saved)return;
    const state=cue.type.slice('report-'.length),result=saved.result;
    const existing=this.incidents.find(incident=>incident.id===result.incident.id);
    const incident=state==='reviewed'?{...result.incident,review_state:'reviewed',detail_url:saved.detail_url}:{...existing,review_state:state,status_label:state==='checking'?'Checking sources':'Not yet reviewed',summary:saved.received_text,detail_url:`${saved.detail_url}?state=${state}`};
    this.incidents=this.incidents.map(item=>item.id===incident.id?incident:item);
    this.revealedReports.add(incident.id);this.publishRoute();
    const id=`replay-${saved.key}`,old=this.demoEvents.find(event=>event.id===id);
    const event={id,elapsed:frame.elapsed,received_elapsed:old?.received_elapsed??frame.elapsed,review_state:state,
      kind:state==='reviewed'?(incident.status==='unconfirmed'?'caution':'report'):state==='received'?'received':'processing',
      kicker:state==='reviewed'?'AI-REVIEWED · DEMO REPLAY':state==='checking'?'CHECKING SOURCES · DEMO REPLAY':'REPORT RECEIVED · DEMO REPLAY',
      title:state==='reviewed'?incident.title:saved.received_title,
      body:state==='reviewed'?incident.summary:state==='checking'?'Comparing these reports with their sources. The prepared AI result will appear shortly.':saved.received_text,
      observation_note:state==='reviewed'?`Saved AI result · prepared ${new Date(result.prepared_at).toLocaleString()}`:'Not yet reviewed in this replay.',incident};
    if(old)this.demoEvents[this.demoEvents.indexOf(old)]=event;else this.demoEvents.push(event);
    this.demoIndex=this.demoEvents.length;this.currentDemoEvent=event;this.map.showEvent(event);this.renderReports();
  }

  renderDemoFeed(target){
    const signature=`demo:${this.demoEvents.map(event=>`${event.id}:${event.review_state||''}:${event.incident?.status||''}`).join(',')}`;
    if(target.dataset.signature===signature)return;
    target.dataset.signature=signature;target.replaceChildren();
    const heading=document.createElement('h2');heading.className='text-sm font-semibold';heading.textContent='Updates along the way';target.append(heading);
    if(!this.demoEvents.length){const waiting=document.createElement('p');waiting.className='waiting-updates';waiting.textContent='Watch the marker move. Updates will appear as the journey unfolds.';target.append(waiting);return;}
    for(const event of this.demoEvents.slice(-4).reverse()){
      const row=document.createElement(event.incident?'a':'div');row.className='journey-feed-item';
      const time=document.createElement('span');time.className='feed-time';time.textContent=this.formatTime(event.received_elapsed??event.elapsed);
      const content=document.createElement('span');const title=document.createElement('strong');title.textContent=event.title;content.append(title);
      if(event.review_state){const state=document.createElement('small');state.className=`feed-review-state ${event.review_state}`;state.textContent=event.review_state==='reviewed'?`AI-reviewed · ${event.incident.status_label}`:event.review_state==='checking'?'Checking sources…':'Received · not yet reviewed';content.append(state);}
      row.append(time,content);
      if(event.incident){row.href=event.incident.detail_url;row.dataset.panel='';row.dataset.journey='read-event';}
      target.append(row);
    }
  }

  formatTime(ms){const seconds=Math.floor(ms/1000);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
  advanceDemo(){if(this.activity==='demo')this.player?.next();}
  pauseDemo(){if(this.activity!=='demo')return;this.demoPaused=true;this.player?.pause();this.renderStatus();}
  resumeDemo(){if(this.activity!=='demo'||this.busy)return;this.demoPaused=false;this.map.demoView(true);if(this.player?.state==='idle')this.mapReadyHandler?.();else this.player?.resume();this.renderStatus();}
  stopDemoClock(){this.player?.stop();if(this.mapReadyHandler)window.removeEventListener('amara-map-ready',this.mapReadyHandler);this.mapReadyHandler=null;}

  pause() {
    ++this.locateSerial;
    if (this.activity === 'live') this.tracker.pause();
    if (this.activity === 'demo') this.pauseDemo();
  }

  end() {
    ++this.serial; this.routeRequest?.abort(); this.busy = false;
    this.activity = null; this.tracker.stop(); this.stopDemoClock();
    if(this.replayActive){this.setReplay(false);this.incidents=this.liveScene?.incidents||[];}
    this.map.demoView(false);this.map.setUserPosition(null); this.ended = true;
    this.publishRoute();
    try { sessionStorage.removeItem('amara-journey-interrupted'); } catch (_) {}
    this.render(); this.notify('Journey ended. Location tracking has stopped.');
  }

  renderStatus() {
    if(this.activity==='demo')this.renderDemoClock();
    const target = document.querySelector('#gps-status');
    if (!target) return;
    target.hidden = !this.activity;
    if (!this.activity) return;
    if (this.activity === 'demo') {
      const frame=this.demoFrame;
      const text=this.demoComplete?'Demo complete. Replay it or inspect any update.':this.demoPaused?'Journey paused. Press Resume to continue.':!frame?'Getting the map ready. The journey will start automatically…':frame.backwards?'Amara is heading back along the road.':'Amara is moving toward Alagomeji. Watch for updates on the map.';
      if(target.textContent!==text)target.textContent=text;
      target.dataset.status=frame?.backwards?'approximate':'demo';
      const pause=document.querySelector('[data-journey="toggle-demo"]');if(pause){pause.textContent=this.demoPaused?'Resume':'Pause';pause.disabled=this.demoComplete;}
      const next=document.querySelector('[data-journey="advance-demo"]');if(next)next.disabled=this.demoComplete;
      const heading=document.querySelector('#journey-heading');if(heading&&this.demoComplete)heading.textContent='Demo complete.';
      return;
    }
    const state = this.gps || this.tracker.snapshot();
    const messages = {
      requesting: 'Waiting for location permission or a fresh GPS fix…',
      tracking: `Live position · accuracy ±${Math.round(state.sample?.accuracy || 0)} m`,
      approximate: `Approximate position · accuracy ±${Math.round(state.sample?.accuracy || 0)} m. Ahead-of-you claims are paused.`,
      stale: `Last location ${Math.round((state.age || 0) / 1000)} seconds ago. Waiting for a fresh fix.`,
      denied: 'Location permission denied. Your route preview still works; allow location in browser settings to resume.',
      unavailable: 'Location is currently unavailable. The last position is not live.',
      timeout: 'A fresh location fix is taking too long. You can retry.',
      paused: 'Tracking paused while the tab was away. Tap Resume location to continue.',
      unsupported: 'Live location requires HTTPS or localhost and browser geolocation support. Route preview still works.',
    };
    let text = messages[state.status] || 'Location tracking is stopped.';
    const projection = state.fresh ? AmaraGeo.project(state.sample.coordinates, this.route.geometry.coordinates) : null;
    const offRoute = projection && projection.distance > Math.max(75, state.sample.accuracy * 2);
    if (state.fresh && !this.inside(state.sample.coordinates)) text += ' Your location is outside the Lagos planning area.';
    else if (offRoute) text += ' You are away from the planned route.';
    else if(this.movingBack)text += ' You are moving back along the planned route.';
    target.textContent = text; target.dataset.status = state.status;
    document.querySelectorAll('[data-journey="resume"]').forEach(button => { button.hidden = !['paused', 'denied', 'unavailable', 'timeout', 'stale'].includes(state.status); });
    document.querySelectorAll('[data-journey="replan"]').forEach(button => { button.hidden = !offRoute || !this.inside(state.sample.coordinates); button.disabled = this.busy; });
  }

  renderDemoClock(){
    const frame=this.demoFrame,elapsed=frame?.elapsed||0,duration=this.player?.duration||80000;
    const time=`${this.formatTime(elapsed)} / ${this.formatTime(duration)}`,percent=Math.round(elapsed/duration*100);
    const progress=document.querySelector('#demo-progress');if(progress){progress.hidden=false;progress.querySelector('.demo-progress-track span').style.width=`${percent}%`;progress.querySelector('[role="progressbar"]').setAttribute('aria-valuenow',percent);document.querySelector('#demo-progress-time').textContent=time;}
    document.querySelector('#demo-map-time').textContent=time;
    document.querySelector('#demo-map-state').textContent=this.demoComplete?'Journey complete':this.demoPaused?'Journey paused':!frame?'Getting ready…':frame.backwards?'Amara is heading back':'Amara is moving';
  }

  render() {
    if(!this.activity)document.querySelector('#journey-reading-context')?.remove();
    const setup = document.querySelector('#journey-setup'), review = document.querySelector('#journey-review');
    if (setup && review) { setup.hidden = Boolean(this.route); review.hidden = !this.route; }
    document.querySelectorAll('[name="mode"], [name="review-mode"]').forEach(input => { input.checked = input.value === this.mode; input.disabled = this.busy; });
    document.querySelectorAll('[data-journey="start-live"]').forEach(button => { button.hidden = Boolean(this.activity); button.disabled = this.busy; });
    document.querySelectorAll('[data-journey="start-demo"]').forEach(button => { button.hidden = Boolean(this.activity); button.disabled=this.busy; });
    document.querySelectorAll('[data-journey="end"]').forEach(button => { button.hidden = !this.activity; });
    document.querySelectorAll('[data-journey="advance-demo"]').forEach(button => { button.hidden = this.activity !== 'demo'; });
    document.querySelectorAll('.demo-playback').forEach(element=>{element.hidden=this.activity!=='demo';});
    document.querySelectorAll('[data-journey="resume"], [data-journey="replan"]').forEach(button => { button.hidden = true; });
    const floating = document.querySelector('.map-sim-end'); if (floating) floating.hidden = !this.activity;
    const progress=document.querySelector('#demo-progress');if(progress)progress.hidden=this.activity!=='demo';
    if (this.route && review) {
      document.querySelector('#route-minutes').textContent = Math.max(1, Math.ceil(this.route.duration_s / 60));
      document.querySelector('#route-distance').textContent = `${(this.route.distance_m / 1000).toFixed(1)} km · ${this.mode === 'walking' ? 'Walking' : 'Driving'}`;
      document.querySelector('#route-destination').textContent = this.places.destination.label;
      document.querySelector('#journey-heading').textContent = this.ended ? 'Journey ended.' : this.activity==='demo' ? 'Amara is heading home.' : this.activity ? 'On your way.' : 'Your route.';
      document.querySelector('#journey-stage').textContent = this.ended ? 'Location tracking stopped' : this.replayActive ? 'Demo replay · saved AI results' : this.activity === 'live' ? 'Live GPS journey' : this.activity === 'demo' ? 'Simulation · no GPS' : '2 of 2 · Real Mapbox route';
      const details = document.querySelector('.live-location-options'); if (details) details.hidden = Boolean(this.activity);
      const aiTools=document.querySelector('.ai-journey-tools');if(aiTools)aiTools.hidden=this.replayActive;
      this.renderReports(); this.renderStatus();
    }
    this.updateReady();
  }

  action(action) {
    if(action==='return-to-journey'&&this.activity==='demo')Promise.resolve(this.map.navigate('/journey/')).then(()=>{if(document.querySelector('#journey-review')&&this.activity==='demo')this.resumeDemo();});
    if (action === 'laptop-demo') this.launchLaptopDemo();
    if (action === 'locate') this.locate();
    if (action === 'sample') {
      this.loadSavedReplay(this.mode,false);
    }
    if (action.startsWith('pick-')) {
      const field = action.slice(5);
      this.plannerStatus(`Click the map to choose your ${field === 'origin' ? 'starting point' : 'destination'}. Escape cancels.`);
      this.map.beginPick(point => {
        this.selectPlace(field, {label: `Map-selected ${field === 'origin' ? 'starting point' : 'destination'}`, coordinates: point});
        document.querySelector('.workspace').classList.remove('map-only');
      });
    }
    if (action === 'edit') { if (this.activity) this.end();if(this.replayActive){this.setReplay(false);this.incidents=this.liveScene?.incidents||[];} ++this.serial; this.routeRequest?.abort(); this.busy=false; this.route = null; this.map.setRoute({route_visible: false, route: [], incidents: this.incidents}); this.render(); const custom=document.querySelector('#custom-route');if(custom)custom.open=true; }
    if (action === 'start-live') this.start('live');
    if (action === 'start-demo') { this.demoPaused = false; this.start('demo'); }
    if (action === 'end') this.end();
    if (action === 'advance-demo') this.advanceDemo();
    if (action === 'toggle-demo' && this.activity==='demo' && !this.demoComplete) {
      if(this.demoPaused)this.resumeDemo();else this.pauseDemo();
    }
    if(action==='read-event'&&this.activity==='demo'){this.pauseDemo();this.map.hideEvent();}
    if (action === 'replay-demo') this.start('demo');
    if (action === 'resume' && this.activity === 'live') { this.tracker.start(); this.render(); }
    if (action === 'replan' && this.gps?.fresh) this.calculate(this.mode, this.gps.sample.coordinates);
  }
};
