/* Shared real-route/position rendering, with 3D and non-WebGL map modes. */
window.AmaraMap = class {
  constructor(config, scene, navigate) {
    this.config = config;
    this.scene = scene;
    this.navigate = navigate;
    this.panel = document.querySelector('.map-panel');
    this.status = document.querySelector('#map-status');
    this.notice = document.querySelector('#map-notice');
    this.generation = 0;
    this.following = true;
    this.position = null;
    this.force2D = new URLSearchParams(location.search).get('map') === '2d';
    this.markers = new Map();
    this.userPosition = null;
    this.trail = [];
    this.lastAccuracyPaint = 0;
    this.lastCameraPaint = 0;
    this.tilt = true;
    document.querySelectorAll('[data-map]').forEach(button => button.addEventListener('click', () => this.control(button.dataset.map)));
    this.initialize();
  }

  selected() {
    return this.scene.incidents?.find(i => i.id === this.scene.selected_incident)
      || this.scene.incidents?.find(i => i.id === 'market-junction')
      || this.scene.incidents?.[0];
  }

  loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => reject(new Error('Renderer timeout')), 7000);
      script.src = url;
      script.onload = () => { clearTimeout(timeout); resolve(); };
      script.onerror = () => { clearTimeout(timeout); reject(new Error('Renderer unavailable')); };
      document.head.append(script);
    });
  }

  progress(title, copy) {
    this.panel.dataset.state = 'loading';
    this.status.hidden = false;
    this.status.replaceChildren();
    const heading = document.createElement('h2'), description = document.createElement('p');
    heading.textContent = title;
    description.textContent = copy;
    this.status.append(heading, description);
  }

  async initialize() {
    const generation = ++this.generation;
    this.progress('Opening your map', 'Your briefing is ready to read while the map loads.');
    if (this.force2D) return this.rasterFallback();
    try {
      const response = await fetch(this.config.map_config_url, {signal: AbortSignal.timeout(6000)});
      if (!response.ok) throw new Error('Map config unavailable');
      const {mapboxToken} = await response.json();
      if (!mapboxToken) throw new Error('Map token unavailable');
      if (!window.mapboxgl || mapboxgl.version.startsWith('2.')) await this.loadScript(this.config.mapbox_js);
      if (generation !== this.generation) return;
      if (!mapboxgl.supported({failIfMajorPerformanceCaveat: false})) await this.loadScript(this.config.mapbox_compat_js);
      if (generation !== this.generation) return;
      if (!mapboxgl.supported({failIfMajorPerformanceCaveat: false})) return this.rasterFallback();
      const compatible = mapboxgl.version.startsWith('2.');
      mapboxgl.accessToken = mapboxToken;
      this.gl = new mapboxgl.Map({
        container: 'map', style: compatible ? 'mapbox://styles/mapbox/light-v11' : 'mapbox://styles/mapbox/standard',
        center: [3.3757, 6.5121], zoom: 16.6, pitch: 66, bearing: -32,
        ...(compatible ? {} : {config: {basemap: {lightPreset: 'dawn', showPointOfInterestLabels: false, showTransitLabels: false}}}),
        failIfMajorPerformanceCaveat: false,
      });
      this.timeout = setTimeout(() => { if (!this.ready && generation === this.generation) this.rasterFallback(); }, 15000);
      this.gl.on('load', () => {
        if (generation !== this.generation) return;
        try {
          if (compatible) {
            const label = this.gl.getStyle().layers.find(layer => layer.type === 'symbol' && layer.layout?.['text-field']);
            this.gl.addLayer({id: 'amara-buildings', source: 'composite', 'source-layer': 'building', filter: ['==', 'extrude', 'true'], type: 'fill-extrusion', minzoom: 14, paint: {'fill-extrusion-color': '#d3d8c5', 'fill-extrusion-height': ['coalesce', ['get', 'height'], 0], 'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0], 'fill-extrusion-opacity': .95}}, label?.id);
          }
          this.gl.addSource('amara-route', {type: 'geojson', data: this.routeData()});
          this.gl.addSource('amara-travelled', {type:'geojson',data:{type:'FeatureCollection',features:[]}});
          this.gl.addSource('amara-accuracy', {type:'geojson', data:AmaraGeo.circle(null, 0)});
          this.gl.addLayer({id:'amara-accuracy-fill',source:'amara-accuracy',type:'fill',...(compatible?{}:{slot:'middle'}),paint:{'fill-color':'#426ac9','fill-opacity':.12}});
          this.gl.addLayer({id:'amara-accuracy-edge',source:'amara-accuracy',type:'line',...(compatible?{}:{slot:'middle'}),paint:{'line-color':'#426ac9','line-opacity':.45,'line-width':1}});
          for (const [id, color, width] of [['outline', '#fff', 8], ['line', '#365d48', 4]]) {
            this.gl.addLayer({id: `amara-route-${id}`, source: 'amara-route', type: 'line', ...(compatible ? {} : {slot: 'middle'}), layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': color, 'line-width': width, ...(id === 'line' ? {'line-dasharray': [2, 1]} : {})}});
          }
          this.gl.addLayer({id:'amara-travelled-line',source:'amara-travelled',type:'line',...(compatible?{}:{slot:'middle'}),layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#426ac9','line-width':5}});
          clearTimeout(this.timeout);
          this.mode = compatible ? 'webgl1' : 'standard';
          this.markReady();
          this.sync();
          if (this.scene.route_visible) this.fitRoute();
        } catch (_) { this.rasterFallback(); }
      });
      this.gl.on('error', () => { if (generation === this.generation && !this.ready) this.rasterFallback(); });
      this.gl.on('dragstart', () => { this.following = false; });
      this.gl.on('click', event => { if (this.pickHandler) this.finishPick([event.lngLat.lng, event.lngLat.lat]); });
      this.gl.getCanvas().addEventListener('webglcontextlost', () => { if (generation === this.generation) this.rasterFallback(); });
    } catch (_) { if (generation === this.generation) this.rasterFallback(); }
  }

  rasterFallback() {
    ++this.generation;
    clearTimeout(this.timeout);
    this.ready = false;
    if (this.gl) { this.gl.remove(); this.gl = null; }
    this.markers.clear();
    if (this.raster) this.raster.remove();
    this.mode = 'raster';
    document.querySelector('#map').hidden = true;
    this.panel.dataset.mapMode = 'raster';
    this.progress('Opening your street map', 'Using the 2D view. No graphics acceleration needed.');
    this.raster = new AmaraRasterMap({
      container: document.querySelector('#raster-map'), center: [3.3768, 6.5137], zoom: 16,
      onReady: () => { this.markReady(); this.sync(); if(this.scene.route_visible)this.fitRoute(); },
      onError: () => this.showFailure(),
      onInteract: () => { this.following = false; },
      onIncident: id => { const incident = this.scene.incidents?.find(i=>i.id===id) || this.selected(); if (incident) this.navigate(incident.detail_url); },
      onMapClick: point => { if (this.pickHandler) this.finishPick(point); },
    });
    this.sync();
  }

  markReady() {
    this.ready = true;
    this.status.hidden = true;
    this.panel.dataset.state = this.mode === 'raster' ? 'raster' : 'ready';
    this.panel.dataset.mapMode = this.mode === 'raster' ? 'raster' : 'webgl';
    document.querySelector('#map-mode').textContent = this.mode === 'raster' ? '2D' : '3D';
    this.notice.textContent = this.mode === 'raster' ? '2D street map · demo reports' : '3D map · demo reports';
    window.amaraMapReady = true;
    window.amaraMapMode = this.mode;
    window.dispatchEvent(new CustomEvent('amara-map-ready'));
  }

  showFailure() {
    this.ready = false;
    this.progress('Map imagery unavailable', 'Your briefing, sources, and journey controls are still available.');
    this.panel.dataset.state = 'failed';
    const retry = document.createElement('button');
    retry.textContent = 'Retry street map';
    retry.className = 'secondary-button mt-4';
    retry.addEventListener('click', () => this.rasterFallback());
    this.status.append(retry);
    this.notice.textContent = 'Map imagery unavailable';
    document.querySelector('#map-mode').textContent = 'Unavailable';
    window.amaraMapReady = false;
  }

  routeData() {
    return {type: 'FeatureCollection', features: this.scene.route_visible && this.scene.route?.length > 1 ? [{type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: this.scene.route}}] : []};
  }

  setScene(scene, preserveJourney = false) {
    const selectedBefore = this.scene.selected_incident;
    this.scene = preserveJourney ? {...scene, route: this.scene.route, route_visible: true, origin: this.scene.origin, destination: this.scene.destination, destination_label:this.scene.destination_label, mode: this.scene.mode} : scene;
    this.sync();
    if (scene.selected_incident && scene.selected_incident !== selectedBefore && this.ready && !preserveJourney) {
      const coordinates = this.selected()?.coordinates;
      if (coordinates) (this.raster || this.gl).easeTo({center: coordinates, duration: this.duration()});
    }
  }

  sync() {
    const incident = this.selected();
    const origin = this.scene.origin || [3.374, 6.5094];
    if (this.raster) {
      this.raster.setScene({route:this.scene.route||[],routeVisible:Boolean(this.scene.route_visible),origin,destination:this.scene.destination||origin,destinationLabel:this.scene.destination_label||'Destination',position:this.userPosition?.coordinates||null,positionVisible:Boolean(this.userPosition),positionLabel:this.positionLabel(),positionStale:this.userPosition?.stale||false,accuracy:this.userPosition?.accuracy||0,incidents:this.scene.incidents||[],trail:this.trail});
      this.decorateTraveller(this.raster.root.querySelector('.raster-person'));
      return;
    }
    if (!this.ready || !this.gl?.getSource('amara-route')) return;
    this.gl.getSource('amara-route').setData(this.routeData());
    this.gl.getSource('amara-accuracy').setData(AmaraGeo.circle(this.userPosition?.coordinates, this.userPosition?.accuracy || 0));
    const stale = this.userPosition?.stale;
    this.gl.setPaintProperty('amara-accuracy-fill','fill-color',stale?'#839082':'#426ac9');
    this.gl.setPaintProperty('amara-accuracy-edge','line-color',stale?'#839082':'#426ac9');
    const points = [];
    for (const item of this.scene.incidents || []) if(item.coordinates) points.push([`incident-${item.id}`,item.coordinates,'selected',item.review_state==='received'?'?':item.review_state==='checking'?'…':'!',item.title,()=>this.navigate(item.detail_url)]);
    if(this.userPosition)points.push(['position',this.userPosition.coordinates,`person${this.userPosition.stale?' stale':''}`,'',this.positionLabel()]);
    if (this.scene.route_visible) {
      points.push(['origin',origin,'origin','', 'Route starting point']);
      points.push(['destination',this.scene.destination || origin, 'home', '⌂', this.scene.destination_label||'Destination']);
    }
    const wanted = new Set();
    for (const [id, point, type, text, label, action] of points) {
      wanted.add(id);
      let marker = this.markers.get(id);
      if(!marker){const element=document.createElement(action?'button':'span');element.className='marker';if(action)element.addEventListener('click',event=>{event.stopPropagation();action();});marker=new mapboxgl.Marker({element}).setLngLat(point).addTo(this.gl);this.markers.set(id,marker);}
      const element=marker.getElement();
      for(const name of ['selected','person','stale','origin','home'])element.classList.toggle(name,type.split(' ').includes(name));
      if(id==='position')this.decorateTraveller(element);else element.textContent=text;
      if(id.startsWith('incident-'))element.dataset.reviewState=this.scene.incidents.find(item=>`incident-${item.id}`===id)?.review_state||'reviewed';
      element.setAttribute('aria-label',label);marker.setLngLat(point);
    }
    for(const [id,marker] of this.markers)if(!wanted.has(id)){marker.remove();this.markers.delete(id);}
    this.paintTrail();
  }

  decorateTraveller(element){
    if(!element)return;
    const show=this.demoViewActive&&this.userPosition?.simulated;
    element.classList.toggle('demo-traveller',Boolean(show));
    const mode=show?this.scene.mode:'none';
    if(element.dataset.travellerMode===mode)return;
    element.dataset.travellerMode=mode;
    if(!show){element.replaceChildren();return;}
    const shape=mode==='walking'?'<circle cx="14" cy="4" r="2"/><path d="m7 11 4-4 4 2 2 4h3M11 8l-2 7-4 6m5-7 5 2 1 5"/>':'<path d="m4 10 2-6h12l2 6M3 10h18v8H3zm2 8v3m14-3v3M6 14h2m8 0h2"/>';
    element.innerHTML=`<span class="traveller-name">Amara</span><svg viewBox="0 0 24 24" aria-hidden="true">${shape}</svg>`;
  }

  syncPosition(){
    if(!this.ready)return;
    if(this.raster){this.raster.updatePosition({position:this.userPosition?.coordinates||null,positionVisible:Boolean(this.userPosition),positionStale:this.userPosition?.stale||false,positionLabel:this.positionLabel(),accuracy:this.userPosition?.accuracy||0});this.decorateTraveller(this.raster.root.querySelector('.raster-person'));return;}
    const marker=this.markers.get('position');
    if(!marker||!this.userPosition){this.sync();return;}
    marker.setLngLat(this.userPosition.coordinates);
    marker.getElement().classList.toggle('stale',Boolean(this.userPosition.stale));
    this.decorateTraveller(marker.getElement());
    if(performance.now()-this.lastAccuracyPaint>200){
      this.lastAccuracyPaint=performance.now();
      this.gl.getSource('amara-accuracy')?.setData(AmaraGeo.circle(this.userPosition.coordinates,this.userPosition.accuracy||0));
      marker.getElement().setAttribute('aria-label',this.positionLabel());
    }
  }

  setTrail(points){this.trail=points;if(this.raster){this.raster.setTrail(points);return;}this.paintTrail();}
  paintTrail(){if(this.gl?.getSource('amara-travelled'))this.gl.getSource('amara-travelled').setData({type:'FeatureCollection',features:this.trail.length>1?[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:this.trail}}]:[]});}

  demoView(active){
    this.demoViewActive=active;this.panel.classList.toggle('demo-running',active);
    document.querySelector('#demo-map-hud').hidden=!active;
    this.following=!active;
    const workspace=document.querySelector('.workspace');
    if(active&&innerWidth<=760){if(!workspace.classList.contains('map-only'))this.demoOpenedMap=true;workspace.classList.add('map-only');document.querySelector('.mobile-panel-toggle span').textContent='Show journey';}
    if(!active&&this.demoOpenedMap){workspace.classList.remove('map-only');document.querySelector('.mobile-panel-toggle span').textContent='Show map';this.demoOpenedMap=false;}
    if(active){this.fitRoute();}else{this.hideEvent();this.setTrail([]);}
    this.syncPosition();
  }

  showEvent(event){
    if(!event.update_id&&performance.now()<(this.evidencePriorityUntil||0))return;
    if(event.update_id)this.evidencePriorityUntil=performance.now()+10000;
    this.activeEventId=event.id;
    const card=document.querySelector('#journey-event');card.replaceChildren();card.hidden=false;card.dataset.kind=event.kind||'report';
    const heading=document.createElement('div');heading.className='event-kicker';heading.textContent=event.kicker||'DEMO UPDATE';
    const close=document.createElement('button');close.className='event-close';close.type='button';close.textContent='×';close.setAttribute('aria-label','Dismiss update');
    if(event.update_id)close.dataset.dismissUpdate=event.update_id;else close.addEventListener('click',()=>this.hideEvent());
    const title=document.createElement('h2');title.textContent=event.title;
    const body=document.createElement('p');body.textContent=event.body;
    card.append(heading,close,title,body);
    if(event.observation_note){const note=document.createElement('small');note.className='event-observation-time';note.textContent=event.observation_note;card.append(note);}
    if(event.incident){
      const stage=event.review_state;
      const badge=document.createElement('span');badge.className=`badge ${stage==='checking'?'checking':stage==='received'?'neutral':event.incident.status==='unconfirmed'?'':event.incident.status}`;badge.textContent=stage==='checking'?'Checking sources…':stage==='received'?'Received · not yet reviewed':stage==='reviewed'?`AI-reviewed · ${event.incident.status_label}`:event.incident.status_label;
      const link=document.createElement('a');link.className='text-link';link.textContent=stage&&stage!=='reviewed'?'View incoming report →':'Why this update? →';link.href=event.incident.detail_url;link.dataset.panel='';link.dataset.journey='read-event';
      if(event.update_id)link.dataset.updateId=event.update_id;
      const row=document.createElement('div');row.className='event-actions';row.append(badge,link);card.append(row);
      const marker=this.raster?.incidentMarkers.get(event.incident.id)||this.markers.get(`incident-${event.incident.id}`)?.getElement();
      if(marker&&(!stage||stage==='received')){marker.classList.remove('incident-arriving');void marker.offsetWidth;marker.classList.add('incident-arriving');}
    }
    if(event.kind==='complete'){const replay=document.createElement('button');replay.type='button';replay.className='text-link';replay.dataset.journey='replay-demo';replay.textContent='Replay the journey →';card.append(replay);}
    if(window.gsap&&!matchMedia('(prefers-reduced-motion: reduce)').matches)gsap.fromTo(card,{y:10,opacity:0},{y:0,opacity:1,duration:.28,clearProps:'transform,opacity'});
  }
  hideEvent(eventId=null){if(eventId&&eventId!==this.activeEventId)return;document.querySelector('#journey-event').hidden=true;if(!eventId)this.evidencePriorityUntil=0;}

  duration() { return matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650; }

  recenter() {
    if (!this.ready) return;
    if(this.demoViewActive){this.following=false;this.fitRoute();return;}
    this.following = true;
    if(this.userPosition){this.focusPosition(this.userPosition.coordinates);return;}
    if(this.scene.route_visible){this.fitRoute();return;}
    this.previewPoint(this.selected()?.coordinates || [3.3757,6.5121]);
  }

  padding() {const compact=innerWidth<=760&&!document.querySelector('.workspace').classList.contains('map-only');return {top:this.demoViewActive?105:70,left:45,right:60,bottom:compact?Math.round(this.panel.clientHeight*.66)+20:90};}
  fitRoute() {if(!this.ready||!this.scene.route?.length)return;const points=this.scene.route;if(this.raster)this.raster.fitBounds(points,this.padding());else{const bounds=new mapboxgl.LngLatBounds();points.forEach(point=>bounds.extend(point));this.gl.fitBounds(bounds,{padding:this.padding(),maxZoom:17,duration:this.duration(),pitch:this.tilt?55:0,bearing:-20});}}
  focusPosition(point) {if(!this.ready)return;if(this.raster)this.raster.focus(point,this.padding());else this.gl.easeTo({center:point,padding:this.padding(),duration:this.duration()});}
  previewPoint(point) {if(!this.ready)return;if(this.raster)this.raster.easeTo({center:point,zoom:16});else this.gl.easeTo({center:point,zoom:16.4,pitch:this.tilt?60:0,duration:this.duration()});}
  setRoute(route) {this.scene={...this.scene,...route};this.sync();}
  positionLabel() {if(!this.userPosition)return 'Position unavailable';return `${this.userPosition.simulated?'Simulated':this.userPosition.stale?'Last known':this.userPosition.approximate?'Approximate':'Current'} position · accuracy ±${Math.round(this.userPosition.accuracy)} m`;}
  setUserPosition(sample,options={}) {this.userPosition=sample?{...sample,...options,stale:options.stale??!options.fresh}:null;if(options.continuous)this.syncPosition();else this.sync();if(sample&&options.follow&&this.following&&(!options.continuous||performance.now()-this.lastCameraPaint>250)){this.lastCameraPaint=performance.now();this.focusPosition(sample.coordinates);}}
  beginPick(handler){this.pickHandler=handler;document.querySelector('.workspace').classList.add('map-only');document.querySelector('.mobile-panel-toggle span').textContent='Show briefing';this.notice.textContent='Click to choose a point · Escape cancels';}
  finishPick(point){const handler=this.pickHandler;this.cancelPick();handler?.(point);}
  cancelPick(){this.pickHandler=null;this.notice.textContent=this.mode==='raster'?'2D street map · demo reports':'3D map · demo reports';}

  advance(fraction) {
    const route = this.scene.route;
    if (!route || route.length < 2) return;
    const value = Math.min(.95, fraction) * (route.length - 1);
    const index = Math.min(Math.floor(value), route.length - 2), portion = value - index;
    this.setUserPosition({coordinates:[route[index][0] + (route[index + 1][0] - route[index][0]) * portion, route[index][1] + (route[index + 1][1] - route[index][1]) * portion],accuracy:0,timestamp:Date.now()},{fresh:true,simulated:true,follow:true});
  }

  control(action) {
    if (!this.ready) return;
    const view = this.raster || this.gl;
    if (action === 'in') view.zoomIn();
    if (action === 'out') view.zoomOut();
    if (action === 'recenter') this.recenter();
    if (action === 'dimension' && this.gl) {
      this.tilt = !this.tilt;
      this.gl.easeTo({pitch: this.tilt ? 66 : 0, duration: this.duration()});
      document.querySelector('#map-mode').textContent = this.tilt ? '3D' : '2D';
    }
    if (action === 'explore' && this.gl){if(this.demoViewActive)this.following=true;this.gl.easeTo({center:this.userPosition?.coordinates||this.selected()?.coordinates||this.scene.destination||[3.3757,6.5121],zoom:17.1,pitch:70,bearing:-40,duration:this.duration()});}
  }
};
