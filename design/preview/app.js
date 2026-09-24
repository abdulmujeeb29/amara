/* Phase 1 interaction mock. No real GPS, AI, search, or database operations. */
const paths = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  route:'<circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v7a4 4 0 0 0 4 4h1m7-1V9a4 4 0 0 0-4-4h-1"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none"/><circle cx="16" cy="17" r="3" fill="currentColor" stroke="none"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1-1.5 3m0 3h.01"/>',
  pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  chevron:'<path d="m8 10 4 4 4-4"/>', arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>', back:'<path d="M20 12H4m6-6-6 6 6 6"/>',
  sun:'<path d="M3 17h18M6 13a6 6 0 0 1 12 0M12 2v3M4 5l2 2m14-2-2 2M2 11h2m16 0h2"/>',
  home:'<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7"/>',
  car:'<path d="m4 10 2-6h12l2 6M3 10h18v8H3zm2 8v3m14-3v3M6 14h2m8 0h2"/>',
  walk:'<circle cx="14" cy="4" r="2"/><path d="m7 11 4-4 4 2 2 4h3M11 8l-2 7-4 6m5-7 5 2 1 5"/>',
  alert:'<path d="m12 3 10 18H2zM12 9v5m0 3h.01"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', minus:'<path d="M5 12h14"/>',
  locate:'<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/><circle cx="12" cy="12" r="1"/>',
  spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  refresh:'<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  list:'<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',check:'<path d="m5 12 4 4L19 6"/>',
  external:'<path d="M14 3h7v7m0-7L10 14M9 3H3v18h18v-6"/>',
  wifi:'<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M9 16a5 5 0 0 1 6 0m-3 4h.01"/>',
  navigation:'<path d="m12 3 8 18-8-5-8 5z"/>', layers:'<path d="m12 3 10 5-10 5L2 8zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.pin}</svg>`;
const escapeHTML = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = selector => document.querySelector(selector);
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const activeMotions = new Set();
function enterMotion(target, options = {}) {
  if (!window.gsap || motionPreference.matches) return;
  const elements = typeof target === 'string' ? [...document.querySelectorAll(target)] : [...target];
  if (!elements.length) return;
  gsap.killTweensOf(elements);
  const tween = gsap.fromTo(elements, {y: 12, opacity: 0}, {
    y: 0, opacity: 1, duration: .38, stagger: .035, ease: 'power2.out',
    clearProps: 'transform,opacity', ...options,
    onComplete: () => activeMotions.delete(tween),
    onInterrupt: () => activeMotions.delete(tween),
  });
  activeMotions.add(tween);
}
motionPreference.addEventListener('change', () => {
  if (motionPreference.matches) {
    activeMotions.forEach(tween => tween.progress(1));
    activeMotions.clear();
  }
});
function closePreview() { if ($('#preview-tools').open) $('#preview-tools').close(); }
function openPreview() {
  $('#preview-tools').showModal();
  enterMotion([$('#preview-tools')], {stagger: 0, duration: .26});
}
function updateDimensionControl() {
  $('#dimension-button').textContent = rasterMap ? '2D' : state.tilt ? '3D' : '2D';
  $('#dimension-button').setAttribute('aria-label', state.tilt ? 'Switch to 2D map' : 'Switch to 3D map');
  $('#dimension-button').setAttribute('aria-pressed', String(mapReady && !rasterMap && state.tilt));
  $('#dimension-button').disabled = !mapReady || Boolean(rasterMap) || state.scenario === 'map-error';
  $('#view-type').textContent = mapReady ? (rasterMap ? '2D' : state.tilt ? '3D' : '2D') : mapInitializing ? 'Loading' : 'Unavailable';
}
$('#scenario').setAttribute('aria-label','Preview state');
document.querySelectorAll('[data-icon]').forEach(node => node.innerHTML = icon(node.dataset.icon));
let stored = {};
try { stored = JSON.parse(sessionStorage.getItem('amara-design') || '{}'); } catch (_) { /* optional storage */ }
const state = { mode: stored.mode === 'walking' ? 'walking' : 'driving', destination: stored.destination || 'Home · Alagomeji', followed: stored.followed !== false, muted: false, sound: false, stage: 0, active: false, ended: false, scenario: 'normal', area: 'Yaba, Lagos', read: new Set(), dismissed: new Set(), progress: 0, following: true, tilt: true, panelHidden: false, resume: stored.active === true, localExpanded: false };
state.journeyStep = 'setup';
let map, positionMarker, mapReady = false, mockTimer, toastTimer, mapTimeout, recalculating = false;
let rasterMap, simulatedPosition = null;
let mapAttempt = 0, mapInitializing = false;
const mapDiagnostics = {run_id: crypto.randomUUID(), code: 'not_started', renderer: 'standard', sdk_loaded: false, webgl_supported: false, token_configured: false};
const mapProblems = {
  config_unavailable: ['Map settings could not load', 'The local preview could not read its map configuration.', 'Check that the preview server is running, then retry.'],
  token_missing: ['A map token is missing', 'The preview needs a Mapbox public token to load the map.', 'Set MAPBOX_PUBLIC_TOKEN in the local .env file. It must be a public pk. token.'],
  sdk_unavailable: ['The map renderer could not load', 'The local server could not deliver the map renderer.', 'The server needs access to api.mapbox.com to cache the renderer. Retry after restoring connectivity.'],
  webgl_unavailable: ['Browser graphics are unavailable', 'This browser cannot create the WebGL graphics needed for 3D.', 'In Chrome: Settings → System → enable “Use graphics acceleration when available”, then relaunch Chrome. A browser or device policy may also block WebGL.'],
  token_rejected: ['Map access was rejected', 'Mapbox rejected the map request for this browser.', 'Check token validity and allowed URLs for http://localhost:8765 and http://127.0.0.1:8765. A map provider permission response is not a graphics error.'],
  network_unavailable: ['Map data could not load', 'A map request failed. The cause may be connectivity or a blocked request.', 'Check whether your network or browser extensions block api.mapbox.com or mapbox map resources. The server-delivered renderer does not eliminate the need to download geographic data.'],
  map_timeout: ['The map is taking too long', 'The renderer started, but the map did not finish loading.', 'Retry once. If it repeats, check your connection and browser map-request blocking. This timeout alone does not identify the root cause.'],
  context_lost: ['Browser graphics were interrupted', 'The browser lost its graphics context.', 'Close unused graphics-heavy tabs and retry. If this repeats, check Chrome graphics acceleration and available device resources.'],
  initialization_failed: ['The map could not start', 'The renderer failed during initialization.', 'Open the browser console to inspect the underlying error. Do not share messages containing tokens. The local diagnostic code identifies the failing stage without exposing credentials.'],
  raster_unavailable: ['Map images are unavailable', 'The 2D map could not download its street imagery. Your briefing and journey controls still work.', 'Check the Mapbox token, map-service availability, and network connection. The 2D fallback does not need WebGL, but it still needs map imagery.'],
};
function reportMapState(code) {
  mapDiagnostics.code = code;
  fetch('/map-diagnostics', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(mapDiagnostics)}).catch(()=>{});
}
function mapFailure(code) {
  if (!rasterMap && code !== 'raster_unavailable') {
    reportMapState(code);
    startRasterMap(code);
    return;
  }
  showMapFailure(code);
}
function showMapFailure(code) {
  clearTimeout(mapTimeout);
  if (mapDiagnostics.code === code && !$('#map-problem').hidden) return;
  mapReady = false;
  mapInitializing = false;
  window.amaraMapReady = false;
  const problem = mapProblems[code] || mapProblems.initialization_failed;
  $('.map-panel').dataset.mapState = 'failed';
  $('#map-fallback').style.visibility = 'visible';
  $('#map-problem').hidden = false;
  $('#map-problem').innerHTML = `${icon('layers')}<h2>${problem[0]}</h2><p>${problem[1]}</p><div class="map-problem-actions"><button data-action="retry-map">Try again</button><button data-action="map-diagnostics">View cause ${icon('arrow')}</button></div>`;
  $('#map-notice').textContent = 'Map imagery unavailable · briefing still accessible';
  $('#map-notice').dataset.loadState = 'fallback';
  updateDimensionControl();
  reportMapState(code);
}
function startRasterMap(reason) {
  const attempt = ++mapAttempt;
  clearTimeout(mapTimeout);
  if (map) { map.remove(); map = undefined; }
  if (rasterMap) rasterMap.remove();
  positionMarker = undefined;
  mapReady = false;
  mapInitializing = true;
  window.amaraMapReady = false;
  window.amaraMapMode = 'raster';
  mapDiagnostics.renderer = 'raster';
  mapDiagnostics.fallback_reason = reason;
  $('.map-panel').dataset.mapMode = 'raster';
  $('.map-panel').dataset.mapState = 'loading';
  $('.map-panel').setAttribute('aria-label', 'Neighbourhood map');
  $('#map').classList.add('hidden');
  $('#map-problem').hidden = false;
  $('#map-problem').innerHTML = `${icon('layers')}<h2>Loading your street map</h2><p>Opening the 2D view. No graphics acceleration needed.</p>`;
  $('#map-notice').textContent = 'Loading 2D street imagery';
  $('#map-notice').dataset.loadState = 'loading';
  reportMapState('loading_raster');
  try {
    rasterMap = new AmaraRasterMap({
      container: $('#raster-map'), center: [3.3768,6.5137], zoom: 16,
      onReady: () => {
        if (attempt !== mapAttempt) return;
        mapReady = true;
        mapInitializing = false;
        window.amaraMapReady = true;
        $('.map-panel').dataset.mapState = 'ready';
        $('#map-problem').hidden = true;
        $('#map-fallback').style.visibility = 'hidden';
        $('#map-notice').textContent = '2D street map · fictional reports';
        $('#map-notice').dataset.loadState = 'ready';
        syncMapContext();
        updateDimensionControl();
        reportMapState('ready_raster');
      },
      onError: () => { if (attempt === mapAttempt) showMapFailure('raster_unavailable'); },
      onInteract: () => { state.following = false; },
      onIncident: () => navigate('incident/market-junction'),
    });
    syncMapContext();
    updateDimensionControl();
  } catch (_) { showMapFailure('raster_unavailable'); }
}
function explainMapFailure() {
  const problem = mapProblems[mapDiagnostics.code] || mapProblems.initialization_failed;
  showModal(problem[0], `<p class="modal-copy">${problem[1]}</p><div class="evidence-note">${problem[2]}</div><div class="map-diagnostic-code">${escapeHTML(mapDiagnostics.code)}</div><p class="fine-print">Renderer: ${escapeHTML(mapDiagnostics.renderer)} · SDK ${mapDiagnostics.sdk_loaded?'loaded':'unavailable'} · Graphics ${mapDiagnostics.webgl_supported?'supported':'unavailable'}</p><p class="fine-print">Only diagnostic codes and support flags stay on this local server. No keys or raw request URLs are recorded.</p>`);
}
function classifyMapError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (error?.status === 401 || error?.status === 403) return 'token_rejected';
  if (/webgl|graphics context/.test(message)) return 'webgl_unavailable';
  if (/fetch|network|load|ajax/.test(message) || error?.status) return 'network_unavailable';
  return 'initialization_failed';
}
function loadCompatibleRenderer() {
  return new Promise((resolve,reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/map-compat.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
let renderedSurface = '', renderedStage = -1;
const start = [3.3740,6.5094], destination = [3.3796,6.5182];
const routes = {
  driving: [start,[3.3730,6.5105],[3.3757,6.5121],[3.3772,6.5145],[3.3777,6.5161],destination],
  walking: [start,[3.3753,6.5108],[3.3774,6.5134],[3.3781,6.5157],destination],
};
function save() { try { sessionStorage.setItem('amara-design', JSON.stringify({mode:state.mode,destination:state.destination,followed:state.followed,active:state.active})); } catch (_) {} }
function page() { return location.hash.replace('#/','') || 'overview'; }
function navigate(to) { if (page() === to) render(); else location.hash = '/' + to; state.panelHidden=false; applyPanel(); }
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent=message; $('#toast').classList.add('visible'); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500); }
function badge(status) { const cls=status.startsWith('Confirmed')?'confirmed':status==='Corroborated'?'corroborated':'neutral'; return `<span class="badge ${status==='Unconfirmed'?'':cls}">${icon(status==='Unconfirmed'?'alert':'shield')}${escapeHTML(status)}</span>`; }
function currentIncident() {
  if(state.scenario==='confirmed') return {status:'Confirmed by Demo Desk',headline:'Lane obstruction confirmed',summary:'The fictional Demo Desk explicitly confirms an eastbound lane obstruction. Other road conditions are unknown.',time:'6:38 PM',updated:'6:42 PM',reports:6};
  if(state.scenario==='conflict') return {status:'Unconfirmed',headline:'Reports disagree at the junction',summary:'Two accounts describe a blocked lane. A separate account disputes the same observation. The conflict is unresolved.',time:'6:37–6:38 PM',updated:'6:43 PM',reports:6};
  if(state.stage>=2) return {status:'Corroborated',headline:'Vehicles reportedly moved',summary:'One newer account says traffic is passing. That clearance claim is unconfirmed; the earlier obstruction had independent support.',time:'6:44 PM',updated:'6:45 PM',reports:6};
  if(state.stage===1) return {status:'Corroborated',headline:'Lane obstruction near the market',summary:'Two independent demo observers describe vehicles blocking the eastbound lane. Their reports match in place and time.',time:'6:37–6:38 PM',updated:'6:41 PM',reports:5};
  return {status:'Unconfirmed',headline:'Roadblock reported near the market',summary:'Three messages mention an obstruction at Market Junction. They trace back to one account, with no independent confirmation yet.',time:'Not supplied',updated:'6:35 PM',reports:3};
}
function nav() { const selected=page().startsWith('incident')?'overview':page(); $('#navigation').innerHTML=[['overview','grid','Overview'],['journey','route','My journey'],['alerts','bell','Updates'],['saved','bookmark','Following'],['settings','settings','Settings']].map(([id,i,label])=>`<a class="rail-link ${selected===id?'active':''}" href="#/${id}" aria-label="${label}" ${selected===id?'aria-current="page"':''} data-tooltip="${label}">${icon(i)}<span class="nav-label">${label}</span></a>`).join(''); }
function trustNote(){return `<div class="trust-note">${icon('shield')}<div><strong>Clarity, not guesswork.</strong><br>Every update shows its evidence. No reports does not mean a road is safe.</div></div>`;}
function modeControl(){return `<div class="segmented" role="group" aria-label="Travel mode"><button data-mode="walking" aria-pressed="${state.mode==='walking'}" ${recalculating?'disabled':''}>${icon('walk')}Walking</button><button data-mode="driving" aria-pressed="${state.mode==='driving'}" ${recalculating?'disabled':''}>${icon('car')}Driving</button></div>`;}
function routeCard(){return `<div class="route-card"><div class="section-heading"><h2>Heading home?</h2>${icon('route')}</div><label class="destination-field">${icon('home')}<input id="destination" aria-label="Destination" value="${escapeHTML(state.destination)}" placeholder="Choose a destination"></label>${modeControl()}<button class="primary-button" data-action="preview-route">Check my way home ${icon('arrow')}</button></div>`;}
function incidentCard(){const item=currentIncident();return `<article class="priority-card"><div class="priority-header">${badge(item.status)}<small>${state.stage===0?'5 min ago':'Just updated'}</small></div><div class="priority-main"><h3>${item.headline}</h3><p>${item.summary}</p><div class="priority-meta">${icon('pin')}Market Junction · Yaba</div></div><div class="priority-footer"><span>${state.active?'Near your illustrative route':state.followed?'On your followed road':'In your selected area'}</span><a class="text-link" href="#/incident/market-junction">View evidence ${icon('arrow')}</a></div></article>`;}
function otherIncidents(){return `<button class="incident-row" data-action="other-incident" data-incident="roadworks"><span class="incident-symbol">${icon('layers')}</span><span><h3>Roadworks on Herbert Macaulay Way</h3><p>Corroborated · 2 fictional sources</p></span><span class="row-right">6:20 PM</span></button><button class="incident-row" data-action="other-incident" data-incident="traffic"><span class="incident-symbol amber">${icon('car')}</span><span><h3>Slow traffic at the junction</h3><p>Unconfirmed · 1 fictional account</p></span><span class="row-right">6:28 PM</span></button>`;}
function banner(){const notices={stale:['clock','Updates are paused. Last successful refresh: 6:12 PM. Conditions may have changed.'],offline:['wifi','You’re offline. Showing the last saved demo briefing. New updates are unavailable.'],gps:['locate','Location is unavailable. Choose a starting point to preview a route.'],unresolved:['pin','One report has an unclear location. It appears in the briefing, but has no precise map marker.'],conflict:['alert','Sources disagree about the same place and time. Review the conflicting evidence.']}; const n=notices[state.scenario];return n?`<div class="status-banner" role="status">${icon(n[0])}<span>${n[1]}</span></div>`:'';}
function emptyBox(title,copy,action='reset-state',label='Back to demo',i='shield'){return `<div class="state-box">${icon(i)}<h3>${title}</h3><p>${copy}</p><button class="secondary-button" data-action="${action}">${label}</button></div>`;}
function welcome(){return `<div class="eyebrow">A LITTLE MORE CLARITY</div><h1>Your way home.<br>Better informed.</h1><div class="welcome-art">${icon('route')}</div><p class="greeting-sub">Know what’s been reported around you, when it happened, and what the evidence says.</p><div class="welcome-actions"><button class="primary-button" data-action="area">${icon('pin')}Choose an area</button><button class="secondary-button" data-action="location">${icon('locate')}Use my location</button></div><p class="fine-print">Location is optional. In this design preview, permission responses and positions are simulated.</p>${trustNote()}`;}
function overview() {
  if (state.scenario === 'welcome') return welcome();
  const empty = state.scenario === 'empty', coverage = state.scenario === 'coverage';
  const d = currentIncident();
  const shortSummary = state.stage >= 2
    ? 'One newer account reports clearance. It still needs independent support.'
    : state.stage === 1
      ? 'Two independent demo observers describe the same blocked lane.'
      : 'Three messages share one unverified account. The observation time is unknown.';
  const update = `<article class="focus-update">
    <div class="eyebrow">${icon('bookmark')}${state.followed ? 'ON YOUR FOLLOWED ROAD' : 'IN YOUR SELECTED AREA'}</div>
    <h2>${d.headline}</h2><p>${shortSummary}</p>
    <div class="focus-update-meta">${badge(state.stage >= 2 ? 'Unconfirmed' : d.status)}<small>Updated ${d.updated}</small></div>
    <a class="text-link" href="#/incident/market-junction">See the evidence ${icon('arrow')}</a>
  </article>`;
  return `<div class="overview-intro"><div class="eyebrow">${icon('sun')}YOUR EVENING BRIEFING</div>
    <h1>A clearer way<br>home.</h1><p class="greeting-sub">Good evening, Amara.<br>Here’s what matters before you head out.</p></div>
    ${banner()}${state.resume ? `<div class="status-banner">${icon('route')}<span>Your demo journey is paused. <button class="text-link" data-action="resume">Resume journey</button></span></div>` : ''}
    ${state.scenario === 'loading'
      ? '<div class="skeleton tall" role="status" aria-label="Mock briefing loading"></div><button class="text-link" data-action="reset-state">Finish mock loading →</button>'
      : coverage ? emptyBox('No coverage for this area yet', 'Current road conditions are unknown.', 'area', 'Choose another area', 'pin')
      : empty ? emptyBox('No matching reports found', 'No reports does not mean the road is safe.', 'advance', 'Add a demo report') : update}
    <div class="plan-entry"><button class="primary-button" data-action="preview-route">Check my way home ${icon('arrow')}</button>
    <p class="quiet-caption">${escapeHTML(state.destination)} · ${state.mode === 'walking' ? 'Walking' : 'Driving'}<br>Choose your destination and travel mode next.</p></div>
    ${empty || coverage ? '' : `<details id="local-more" class="local-disclosure" ${state.localExpanded ? 'open' : ''}>
      <summary><span>Elsewhere nearby <span class="count">2</span></span>${icon('chevron')}</summary>
      <div class="local-content">${otherIncidents()}<a class="text-link" href="#/alerts">All updates ${icon('arrow')}</a></div></details>`}
    <div class="quiet-trust">${icon('shield')}<span><strong>Evidence, not assumptions.</strong><br>Reports help you decide. They don’t certify a safe route.</span></div>`;
}
function detail(){const d=currentIncident();const sources=state.scenario==='confirmed'?['R1','R2','R3','R4','R5','D1']:state.scenario==='conflict'?['R1','R2','R3','R4','R5','C1']:state.stage>=2?['R1','R2','R3','R4','R5','R6']:state.stage===1?['R1','R2','R3','R4','R5']:['R1','R2','R3'];return `<a class="back-link" href="#/${state.active?'journey':'overview'}">${icon('back')}Back to ${state.active?'journey':'overview'}</a><div class="eyebrow">INCIDENT BRIEFING · FICTIONAL</div>${badge(d.status)}<div class="detail-header"><h1>${d.headline}</h1><div class="detail-location">${icon('pin')}Market Junction · Yaba, Lagos</div></div>${banner()}<div class="info-grid"><div><small>Observed</small><strong>${d.time}</strong></div><div><small>Briefing updated</small><strong>${d.updated} WAT</strong></div></div><div class="evidence-section"><h3>What we know</h3><p>${d.summary} <a class="text-link" href="#sources">See sources ↓</a></p></div><div class="evidence-section"><h3>What remains unclear</h3><p>${state.stage>=2?'Whether the clearance is independently confirmed. This report does not establish conditions along the rest of the route.':state.stage===1?'The reason for the obstruction and whether it has cleared. No evidence establishes armed activity.':'When the original observation happened, whether it was firsthand, and whether the road is currently obstructed.'}</p></div><div class="section-heading" id="sources"><h2>The evidence <span class="count">${sources.length}</span></h2><small>All sources are fictional</small></div>${sources.map(source=>sourceRow(source)).join('')}<div class="evidence-note">${icon('layers')} ${state.stage||state.scenario==='confirmed'||state.scenario==='conflict'?'Forwarded messages R1–R3 still count as one origin. Later firsthand reports are shown separately.':'3 messages. 1 original account. Repetition isn’t independent confirmation.'}</div><div class="section-heading"><h2>How this update changed</h2></div><div class="timeline"><div><strong>6:32 PM · Initial report</strong>Secondhand claim received; observation time missing.</div><div><strong>6:35 PM · Repeats grouped</strong>Two forwards linked to the original report.</div>${state.stage>=1?'<div><strong>6:41 PM · Independent support</strong>R4 and R5 describe the same obstructed lane.</div>':''}${state.stage>=2?'<div><strong>6:45 PM · Reported clearance</strong>R6 says vehicles moved. Clearance remains unconfirmed.</div>':''}${state.scenario==='conflict'?'<div><strong>6:43 PM · Contradiction</strong>C1 disputes the observation. Evidence is unresolved.</div>':''}</div><button class="primary-button" data-action="preview-route">See on my route ${icon('arrow')}</button><p class="fine-print">Demo date: 22 September 2026 · Africa/Lagos</p>`;}
const sourceData={
 R1:{name:'Original community message',kind:'Secondhand · original account',observed:'Not supplied',published:'6:32 PM',text:'My cousin says vehicles are being stopped at Market Junction. I don’t know when they saw it.'},
 R2:{name:'Forwarded message',kind:'Repeats R1 · not independent',observed:'Not supplied',published:'6:34 PM',text:'Forwarding R1: someone’s cousin says vehicles are being stopped at Market Junction.'},
 R3:{name:'Neighbourhood group repost',kind:'Repeats R2 → R1',observed:'Not supplied',published:'6:35 PM',text:'Copied from the neighbourhood group: the same cousin’s report about Market Junction.'},
 R4:{name:'Demo observer A',kind:'Firsthand · separate account',observed:'6:37 PM',published:'6:39 PM',text:'I am at Market Junction. Two vehicles are blocking the eastbound lane.'},
 R5:{name:'Demo observer B',kind:'Firsthand · independent in fixture',observed:'6:38 PM',published:'6:41 PM',text:'From the opposite side of Market Junction, I can see two stationary vehicles obstructing the eastbound lane.'},
 R6:{name:'Later clearance account',kind:'Firsthand claim · unconfirmed clearance',observed:'6:44 PM',published:'6:45 PM',text:'Those two vehicles have moved; traffic is passing now.'},
 C1:{name:'Conflicting demo observer',kind:'Contradicts R4/R5 · unresolved',observed:'6:38 PM',published:'6:43 PM',text:'At 6:38 PM I was at the same Market Junction and saw no blocked lane.'},
 D1:{name:'Demo Desk',kind:'Fictional designated source',observed:'6:38 PM',published:'6:42 PM',text:'For this fictional scenario, Demo Desk explicitly confirms an obstruction of the eastbound lane at 6:38 PM. No other claim is confirmed.'},
};
function sourceRow(id){const s=sourceData[id];return `<button class="source-row" data-source="${id}"><span class="source-avatar">${id}</span><span><strong>${s.name}</strong><small>${s.kind}</small></span>${icon('external')}</button>`;}
function journeyFlow() {
  if (state.ended) return `<div class="journey-intro"><div class="completed-icon">${icon('check')}</div><h1>Journey ended.</h1><p>Simulated movement has stopped.</p></div><button class="primary-button" data-action="new-journey">Plan another journey ${icon('arrow')}</button><a class="quiet-link" href="#/saved">Manage followed roads</a><p class="fine-print">No real GPS was used. Your follow preferences are saved.</p>`;
  const review = state.journeyStep === 'review' || state.active;
  const d = currentIncident();
  if (!review) return `<a class="back-link" href="#/overview">${icon('back')}Overview</a>
    <div class="journey-intro"><span class="step-label">1 of 2 · Your destination</span><h1>Where are you headed?</h1></div>
    ${state.resume?'<div class="status-banner">Your previous demo journey is paused. Starting again is always your choice.</div>':''}
    <div class="journey-origin">${icon('locate')}From My shop · Yaba Market</div>
    <label class="journey-destination" for="destination">Destination<input id="destination" value="${escapeHTML(state.destination)}" placeholder="Choose a destination" autocomplete="off"></label>
    <div class="journey-mode-label">How are you travelling?</div>${modeControl()}
    <button class="primary-button journey-primary" data-action="review-route" ${recalculating?'disabled':''}>Review my route ${icon('arrow')}</button>
    <p class="fine-print">Illustrative route and estimates · design preview</p>`;
  if (state.scenario === 'route-error') return `<button class="back-link" data-action="edit-trip">${icon('back')}Edit journey</button><h1>Your route</h1>${emptyBox('Route unavailable','Your destination is saved. Try again.','retry-route','Retry route','route')}`;
  return `<button class="back-link" data-action="${state.active?'journey-options':'edit-trip'}">${icon(state.active?'settings':'back')}${state.active?'Journey options':'Edit journey'}</button>
    <div class="journey-intro"><span class="step-label">${state.active?'Simulated journey':'2 of 2 · Before you go'}</span><h1>${state.active?'On your way.':'Your route home.'}</h1></div>
    ${state.scenario==='gps'?banner():''}
    <div class="trip-at-a-glance"><div><strong>${recalculating?'…':state.mode==='walking'?'24':'8'}<small> min</small></strong><span>${state.mode==='walking'?'1.7':'2.4'} km · ${state.mode==='walking'?'Walking':'Driving'}</span></div><span class="trip-destination">${icon('home')}${escapeHTML(state.destination)}</span></div>
    <div class="journey-report"><div class="journey-report-top">${icon('alert')}<strong>One report near your route</strong>${badge(state.stage>=2?'Unconfirmed':d.status)}</div><p>${state.stage>=2?'A new clearance claim needs independent support.':'Market Junction · '+(state.stage===0?'Observation time unknown':'Observed 6:37–6:38 PM')}</p><a class="text-link" href="#/incident/market-junction">Read the briefing ${icon('arrow')}</a></div>
    ${state.active?`<div class="progress-track" aria-label="Simulated journey progress"><i style="width:${state.progress}%"></i></div><button class="primary-button journey-primary" data-action="end-journey">End journey</button><button class="quiet-link" data-action="step">Advance demo position ${icon('arrow')}</button>`:`<button class="primary-button journey-primary" data-action="start-journey" ${recalculating?'disabled':''}>Start demo journey ${icon('navigation')}</button>`}
    <p class="fine-print">${state.active?'Simulated position. No real GPS is active.':'Reported conditions, not a guarantee of safety.'}</p>`;
}
function journey(){if(state.ended)return `<a class="back-link" href="#/overview">${icon('back')}Back to overview</a><div class="completed"><div class="completed-icon">${icon('check')}</div><h1>Journey ended.</h1><p>Your demo movement has stopped.<br>You’re in control of what happens next.</p></div><div class="mini-summary"><div class="eyebrow">YOUR PRIVACY, BY DESIGN</div><p>The real app will stop GPS tracking here. This preview never accessed your location.</p></div><button class="primary-button" data-action="new-journey">Plan another journey ${icon('arrow')}</button><a class="secondary-button" style="margin-top:10px" href="#/saved">Manage followed roads</a><p class="fine-print">Ending a journey doesn’t unfollow your saved roads.</p>`;return `<a class="back-link" href="#/overview">${icon('back')}Back to overview</a><div class="eyebrow">${state.active?'YOUR JOURNEY · SIMULATED':'BEFORE YOU GO'}</div><h1>${state.active?'A clearer view ahead.':'Your way home.'}</h1><p class="greeting-sub">${state.active?'Position and route progress are simulated.':'Check the reports along your route before leaving.'}</p>${banner()}<div class="route-stops"><div class="stop">${icon('locate')}My shop · Yaba Market <small>Demo origin</small></div><div class="stop-line"></div><div class="stop">${icon('home')}<span>${escapeHTML(state.destination)}</span><button class="text-link" data-action="destination-edit" aria-label="Change destination">Edit</button></div></div>${modeControl()}${state.scenario==='route-error'?emptyBox('We couldn’t calculate this route','Your destination is saved. Try again or change your travel mode.','retry-route','Retry route','route'):`<div class="route-numbers"><strong>${recalculating?'…':state.mode==='walking'?'24':'8'}</strong><span>min <span style="padding:0 8px">·</span> ${state.mode==='walking'?'1.7':'2.4'} km</span></div><div class="route-facts"><span>${icon('route')}Illustrative ${state.mode} route</span><span>${icon('clock')}Demo estimate</span></div><div class="mini-summary"><div class="eyebrow">${icon('spark')}ROUTE BRIEFING · MOCK AI OUTPUT</div><p>${recalculating?'Updating the illustrative route and report relevance…':state.mode==='walking'?'One reported obstruction near your walking route. Pedestrian access is not established by these reports.':'One reported obstruction on your driving route. Check its sources and freshness before setting off.'}</p></div>${incidentCard()}${state.active?`<div class="progress-track" aria-label="Simulated journey progress"><i style="width:${state.progress}%"></i></div><button class="secondary-button" style="width:100%;margin-top:15px" data-action="step">${icon('navigation')}Advance simulated position</button><button class="end-button" data-action="end-journey">End journey</button>`:`<button class="primary-button" style="margin-top:20px" data-action="start-journey" ${recalculating?'disabled':''}>${icon('navigation')}Start demo journey</button><p class="fine-print">Illustrative route, not a verified safe route.<br>No real location is requested in this preview.</p>`}`}`;}
function alertScreen(){const d=currentIncident();const key='main-'+state.stage+'-'+state.scenario;return `<div class="eyebrow">ONLY WHAT’S RELEVANT</div><h1>Your updates.</h1><p class="greeting-sub">A little less noise. The changes that matter.</p><div class="section-heading"><h2>Today · 22 September</h2><button class="text-link" data-action="read-all">Mark all as read</button></div>${banner()}<div class="alert-list">${state.dismissed.has(key)?emptyBox('You’re caught up','Dismissed updates remain available in incident history.','restore-alert','Restore demo alert','bell'):`<article class="alert-card ${state.read.has(key)?'':'unread'}">${badge(d.status)}<h3>${d.headline}</h3><p>${d.summary}</p><div class="priority-meta">${icon('bookmark')}${state.followed?'On your followed road':'In your selected area'} · ${d.updated}</div><div class="alert-actions"><a class="text-link" href="#/incident/market-junction" data-action="read-main">View evidence ${icon('arrow')}</a><button data-action="dismiss-alert">Dismiss</button></div></article>`}<article class="alert-card">${badge('Corroborated')}<h3>Roadworks on Herbert Macaulay Way</h3><p>Two fictional reports describe temporary roadworks. Last observation: 6:15 PM.</p><div class="alert-actions"><button class="text-link" data-action="other-incident" data-incident="roadworks">View details ${icon('arrow')}</button><small>6:20 PM</small></div></article></div>${trustNote()}`;}
function savedScreen(){return `<div class="eyebrow">BEFORE YOU EVEN LEAVE</div><h1>Places you follow.</h1><p class="greeting-sub">Get relevant in-app updates without sharing your live location.</p>${!state.followed||state.scenario==='unfollowed'?emptyBox('Your regular roads, in one place','Follow your road home to see updates before you start a journey.','follow-road','Follow Market Road','bookmark'):`<article class="route-card" style="margin-top:24px"><div class="section-heading"><h2>Market Road, Yaba</h2>${icon('bookmark')}</div><p class="greeting-sub">Your usual way home · 1 relevant incident</p><div class="settings-row"><div><strong>Road updates</strong><p>${state.muted?'Muted on this device':'Shown while Amara is open'}</p></div><button class="switch" role="switch" aria-label="Road updates" aria-checked="${!state.muted}" data-action="mute"></button></div><div class="alert-actions"><a class="text-link" href="#/incident/market-junction">View latest briefing ${icon('arrow')}</a><button data-action="unfollow">Unfollow</button></div></article>`}<button class="secondary-button" style="width:100%;margin-top:14px" data-action="area">${icon('plus')}Choose another area</button>${trustNote()}`;}
function settingsScreen(){return `<div class="eyebrow">YOUR JOURNEY, YOUR CHOICE</div><h1>Make it yours.</h1><p class="greeting-sub">Simple controls. No surprises.</p><div class="section-heading"><h2>Preferred travel mode</h2></div>${modeControl()}<div class="settings-row"><div><strong>Optional alert sounds</strong><p>Visual updates always remain available.</p></div><button class="switch" role="switch" aria-label="Alert sounds" aria-checked="${state.sound}" data-action="sound"></button></div><div class="settings-row"><div><strong>Location sharing</strong><p>This preview uses simulated positions only.</p></div>${badge('Not tracking')}</div><div class="settings-row"><div><strong>Background notifications</strong><p>Future option. Current alerts appear in-app.</p></div><span class="badge neutral">Not enabled</span></div><div class="section-heading"><h2>Your selected area</h2><button class="text-link" data-action="area">Change</button></div><p class="greeting-sub">${escapeHTML(state.area)}</p><div class="section-heading"><h2>About this design</h2></div><p class="greeting-sub">Phase 1 interactive preview. Map imagery may load from Mapbox; reports, routes, AI summaries, and journey positions are mocked.</p><button class="secondary-button" style="margin-top:18px;width:100%" data-action="open-help">Explore the demo ${icon('arrow')}</button>`;}
function render() {
  const focusMode = document.activeElement?.dataset.mode;
  nav();
  const p = page(), surface = `${p}:${state.scenario}:${state.active}:${state.ended}:${state.journeyStep}`;
  const surfaceChanged = surface !== renderedSurface;
  $('.workspace').dataset.screen = p;
  $('#panel').innerHTML = p === 'journey' ? journeyFlow() : p === 'alerts' ? alertScreen() : p === 'saved' ? savedScreen() : p === 'settings' ? settingsScreen() : p === 'incident/market-junction' ? detail() : overview();
  $('#area-label').textContent = state.area;
  $('#scenario').value = state.scenario;
  $('#journey-floating').innerHTML = state.active ? `<div class="journey-card">${icon('navigation')}<div><strong>${state.following ? 'Following your demo journey' : 'Exploring the map'}</strong><p>${state.scenario === 'gps' ? 'Location unavailable · proximity paused' : `${state.mode === 'walking' ? 'Walking' : 'Driving'} to ${escapeHTML(state.destination)} · simulated`}</p></div><button class="journey-end" data-action="end-journey" aria-label="End active demo journey">End journey</button></div>` : '';
  $('#map').classList.toggle('hidden', state.scenario === 'map-error' || Boolean(rasterMap));
  $('#raster-map').classList.toggle('hidden', state.scenario === 'map-error');
  $('#map-fallback').style.visibility = state.scenario === 'map-error' ? 'visible' : '';
  if (state.scenario === 'map-error') {
    $('#map-notice').textContent = 'Illustration only · 3D map unavailable';
    $('#map-notice').dataset.loadState = 'fallback';
    $('.map-panel').dataset.mapState = 'failed';
    $('#map-problem').hidden = false;
    $('#map-problem').innerHTML = `<h2>Simulated map failure</h2><p>This is a design-review state, not a diagnosed browser failure.</p><div class="map-problem-actions"><button data-action="reset-state">Restore preview</button></div>`;
  } else if (mapReady) {
    $('#map-notice').textContent = rasterMap ? '2D street map · fictional reports' : 'Mapbox basemap · fictional reports';
    $('#map-notice').dataset.loadState = 'ready';
    $('.map-panel').dataset.mapState = 'ready';
    $('#map-problem').hidden = true;
  }
  if (surfaceChanged) {
    $('#map-callout').innerHTML = '';
    enterMotion([...$('#panel').children], {stagger: .025, duration: .32});
  } else if (state.stage !== renderedStage) {
    enterMotion($('#panel').querySelectorAll('.focus-update, .priority-card'), {duration: .28, stagger: 0});
  }
  renderedSurface = surface;
  renderedStage = state.stage;
  if (focusMode && !surfaceChanged) $(`[data-mode="${focusMode}"]`)?.focus({preventScroll:true});
  syncMapContext();
  updateDimensionControl();
  save();
}
function applyPanel(){ $('.workspace').classList.toggle('map-only',state.panelHidden);$('#panel-toggle-label').textContent=state.panelHidden?'Show briefing':'Show map'; }
function showModal(title,body){$('#modal-body').innerHTML=`<div class="modal-header"><h2 id="modal-title">${title}</h2><button class="close-small" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div>${body}`;if(!$('#modal').open)$('#modal').showModal();enterMotion([$('#modal')],{duration:.24,stagger:0});}
function sourceModal(id){const s=sourceData[id];showModal(s.name,`<span class="demo-tag">FICTIONAL SOURCE · ${id}</span><blockquote class="modal-source">“${s.text}”</blockquote><div class="modal-meta"><div><small>Observed</small>${s.observed}</div><div><small>Published</small>${s.published} WAT</div></div><div class="evidence-note">${s.kind}. ${id==='R5'?'Independent origin is part of this labelled demo fixture, not an inference verified by this preview.':'This is an internal demo record, not a real social-media post.'}</div><p class="fine-print">22 Sep 2026 · All personal identities are fictional.</p>`);}
function routeLine(){if(rasterMap){syncMapContext();return;}if(!mapReady||!map?.getSource('demo-route'))return;map.getSource('demo-route').setData({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:routes[state.mode]}});}
function recenter(){if(!mapReady)return;const routeView=page()==='journey'&&state.journeyStep==='review'||state.active;if(rasterMap){rasterMap.easeTo({center:routeView?[3.3768,6.5137]:[3.3757,6.5121],zoom:16});return;}map.easeTo({center:routeView?[3.3768,6.5137]:[3.3757,6.5121],zoom:routeView?15.7:16.65,pitch:state.tilt?66:0,bearing:-32,duration:motionPreference.matches?0:850});}
function syncMapContext() {
  const routeVisible = page() === 'journey' && state.journeyStep === 'review' || state.active;
  if (rasterMap) {
    rasterMap.setScene({route:routes[state.mode],routeVisible,position:simulatedPosition||start,destination,incident:[3.3757,6.5121]});
    return;
  }
  if (!mapReady) return;
  for (const layer of ['demo-route-outline', 'demo-route-line']) {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', routeVisible ? 'visible' : 'none');
  }
  document.querySelectorAll('.marker.home, .marker.person').forEach(marker => { marker.hidden = !routeVisible; });
}
function setMode(mode) {
  if (mode === state.mode || recalculating) return;
  if ($('#destination')) state.destination = $('#destination').value;
  const old = state.mode;
  recalculating = true;
  render();
  setTimeout(() => {
    recalculating = false;
    if (state.scenario === 'route-error') {
      toast('Route unavailable. Previous mode retained.');
      state.mode = old;
    } else {
      state.mode = mode;
      state.progress = 0;
      simulatedPosition = start;
      routeLine();
      if (positionMarker) positionMarker.setLngLat(start);
    }
    render();
    if ($('#modal').open && $('#modal .segmented')) $('#modal .segmented').outerHTML = modeControl();
  }, 250);
}
function advanceEvidence(){closePreview();if($('#modal').open)$('#modal').close();if(['empty','coverage','loading'].includes(state.scenario)){state.scenario='normal';state.stage=0;}else{state.scenario='normal';if(state.stage>=2){toast('Latest demo revision already shown. Reset to replay.');return;}state.stage++;}render();if(state.followed&&!state.muted||state.active)toast(state.stage===2?'New clearance report · still unconfirmed.':state.stage===1?'New evidence · briefing updated.':'New fictional report added.');}
function showCallout(){if(['empty','coverage','map-error'].includes(state.scenario)){$('#map-callout').innerHTML='';return;}const d=currentIncident();$('#map-callout').innerHTML=`<div class="floating-incident"><button class="close-small" data-action="close-callout" aria-label="Close map incident">${icon('close')}</button>${badge(d.status)}<h3>Market Junction</h3><p>${state.stage>=2?'Clearance claim awaiting support':state.stage===1?'Two independent demo observations':'3 messages · 1 original account'}</p><a href="#/incident/market-junction" class="text-link">Read the evidence ${icon('arrow')}</a></div>`;}
function movePosition(){if(!state.active||state.scenario==='gps')return;state.progress=Math.min(state.progress+15,90);const route=routes[state.mode];const f=state.progress/100*(route.length-1),i=Math.min(Math.floor(f),route.length-2),t=f-i;const point=[route[i][0]+(route[i+1][0]-route[i][0])*t,route[i][1]+(route[i+1][1]-route[i][1])*t];simulatedPosition=point;if(positionMarker)positionMarker.setLngLat(point);if(mapReady&&state.following)(rasterMap||map).easeTo({center:point,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:700});render();}
function endJourney(){state.active=false;state.ended=true;clearInterval(mockTimer);$('#modal').close();render();navigate('journey');save();}
document.addEventListener('click',event=>{const mode=event.target.closest('[data-mode]');if(mode){setMode(mode.dataset.mode);return;}const source=event.target.closest('[data-source]');if(source){sourceModal(source.dataset.source);return;}const area=event.target.closest('[data-area]');if(area){state.area=area.dataset.area;state.scenario=state.area==='Yaba, Lagos'?'normal':'coverage';$('#modal').close();render();navigate('overview');return;}const node=event.target.closest('[data-action]');if(!node)return;const a=node.dataset.action;switch(a){
 case 'retry-map':initializeMap();break;
 case 'map-diagnostics':explainMapFailure();break;
 case 'review-route':{const input=$('#destination');if(!input.value.trim()){input.focus();return;}state.destination=input.value.trim();state.journeyStep='review';render();recenter();break;}
 case 'edit-trip':state.journeyStep='setup';render();break;
 case 'journey-options':showModal('Journey options',`<p class="modal-copy">Change travel mode without ending the simulation.</p>${modeControl()}<button class="secondary-button" style="margin-top:18px;width:100%" data-action="close-modal">Done</button>`);break;
 case 'open-preview':openPreview();break;
 case 'close-preview':closePreview();break;
 case 'explore-3d':if(mapReady&&!rasterMap&&state.scenario!=='map-error'){state.tilt=true;updateDimensionControl();map.easeTo({center:[3.3757,6.5121],zoom:17.1,pitch:70,bearing:-40,duration:motionPreference.matches?0:1100});state.panelHidden=true;applyPanel();}else{toast(rasterMap?'Your street map is available in 2D.':'Map is still loading.');}break;
 case 'preview-route':{const input=$('#destination');if(input){const value=input.value.trim();if(!value){input.focus();toast('Choose a destination first.');return;}state.destination=value;}if($('#modal').open)$('#modal').close();state.ended=false;state.journeyStep=page().startsWith('incident')?'review':'setup';navigate('journey');routeLine();recenter();break;}
 case 'start-journey':case 'resume':showModal('Ready to try the journey?',`<div class="modal-copy"><p>Explore the moving-map experience with a <strong>simulated position</strong>. This preview won’t request or track your actual location.</p><p>In the working app, this step will ask for browser location permission.</p></div><div class="modal-buttons"><button class="secondary-button" data-action="close-modal">Not yet</button><button class="primary-button" data-action="confirm-start">Start simulation ${icon('arrow')}</button></div>`);break;
 case 'confirm-start':state.active=true;state.resume=false;state.ended=false;state.journeyStep='review';state.progress=5;state.following=true;simulatedPosition=start;$('#modal').close();navigate('journey');render();recenter();clearInterval(mockTimer);mockTimer=setInterval(movePosition,12000);toast('Demo journey started. No real GPS is active.');break;
 case 'end-journey':showModal('End this journey?',`<p class="modal-copy">Simulated movement will stop. Your followed-road preferences will stay as you set them.</p><div class="modal-buttons"><button class="secondary-button" data-action="close-modal">Keep going</button><button class="primary-button" data-action="confirm-end">End journey</button></div>`);break;
 case 'confirm-end':endJourney();break;
 case 'new-journey':state.ended=false;state.progress=0;state.journeyStep='setup';render();break;
 case 'step':movePosition();if(state.scenario==='gps')toast('Position unavailable in this mock state.');break;
 case 'advance':advanceEvidence();break;
 case 'close-modal':$('#modal').close();break;
 case 'close-callout':$('#map-callout').innerHTML='';break;
 case 'read-main':state.read.add('main-'+state.stage+'-'+state.scenario);break;
 case 'read-all':state.read.add('main-'+state.stage+'-'+state.scenario);render();toast('All demo updates marked as read.');break;
 case 'dismiss-alert':state.dismissed.add('main-'+state.stage+'-'+state.scenario);render();break;
 case 'restore-alert':state.dismissed.clear();render();break;
 case 'follow-road':state.followed=true;state.scenario='normal';render();toast('Following Market Road. No live location needed.');break;
 case 'unfollow':state.followed=false;render();toast('Unfollowed Market Road. Your active journey is unchanged.');break;
 case 'mute':state.muted=!state.muted;render();break;
 case 'sound':state.sound=!state.sound;render();toast('Preference preview saved. No sound plays in this mock.');break;
 case 'reset-state':case 'retry-route':state.scenario='normal';render();break;
 case 'reset':closePreview();clearInterval(mockTimer);simulatedPosition=start;Object.assign(state,{stage:0,active:false,ended:false,resume:false,progress:0,scenario:'normal',followed:true,muted:false,mode:'driving',destination:'Home · Alagomeji',area:'Yaba, Lagos',localExpanded:false,journeyStep:'setup'});state.read.clear();state.dismissed.clear();$('#modal').close();navigate('overview');render();routeLine();recenter();$('#map-callout').innerHTML='';if(positionMarker)positionMarker.setLngLat(start);toast('Demo reset.');break;
 case 'area':showModal('Choose your area',`<p class="modal-copy">Start with an area you care about. Following an area doesn’t require GPS.</p><div class="choice-list"><button data-area="Yaba, Lagos">${icon('pin')}Yaba, Lagos <span class="badge neutral">Demo coverage</span></button><button data-area="Ikeja, Lagos">${icon('pin')}Ikeja, Lagos <small>No demo reports</small></button><button data-area="Lekki, Lagos">${icon('pin')}Lekki, Lagos <small>No demo reports</small></button></div><button class="secondary-button" data-action="location">${icon('locate')}Preview location permission</button>`);break;
 case 'location':showModal('Share your location?',`<div class="modal-copy"><p>Amara uses your location to find nearby reports. Tracking during a journey starts only when you choose to begin.</p><p><strong>Mock permission screen.</strong> These buttons simulate the browser response.</p></div><div class="modal-buttons"><button class="secondary-button" data-action="deny-location">Don’t allow</button><button class="primary-button" data-action="allow-location">Allow in demo</button></div>`);break;
 case 'deny-location':state.scenario='gps';$('#modal').close();navigate('overview');render();break;
 case 'allow-location':state.area='Yaba, Lagos';state.scenario='normal';$('#modal').close();navigate('overview');render();toast('Demo location selected. No actual GPS was requested.');break;
 case 'destination-edit':showModal('Where are you heading?',`<label class="modal-copy" for="destination-edit">Destination label for the illustrative route</label><input class="modal-input" id="destination-edit" value="${escapeHTML(state.destination)}"><div class="modal-buttons"><button class="primary-button" data-action="save-destination">Save destination</button></div><p class="fine-print">This mock changes the label; real destination search is part of implementation.</p>`);break;
 case 'save-destination':{const value=$('#destination-edit').value.trim();if(!value){$('#destination-edit').focus();return;}state.destination=value;$('#modal').close();render();break;}
 case 'zoom-in':if(mapReady)(rasterMap||map).zoomIn();break;
 case 'zoom-out':if(mapReady)(rasterMap||map).zoomOut();break;
 case 'toggle-3d':if(rasterMap)break;state.tilt=!state.tilt;updateDimensionControl();if(mapReady)map.easeTo({pitch:state.tilt?66:0,duration:motionPreference.matches?0:650});break;
 case 'recenter':state.following=true;recenter();render();break;
 case 'toggle-panel':state.panelHidden=!state.panelHidden;applyPanel();break;
 case 'other-incident':{const road=node.dataset.incident==='roadworks';showModal(road?'Roadworks reported':'Slow traffic reported',`${badge(road?'Corroborated':'Unconfirmed')}<p class="modal-copy" style="margin-top:15px">${road?'Two independent fictional accounts report roadworks on Herbert Macaulay Way.':'One fictional account reports slow traffic near the junction. Independent support is missing.'}</p><div class="info-grid" style="margin-top:18px"><div><small>Observed</small><strong>${road?'6:15 PM':'6:25 PM'}</strong></div><div><small>Updated</small><strong>${road?'6:20 PM':'6:28 PM'}</strong></div></div><div class="evidence-note">Mock source ${road?'RW1: “I saw a crew working on the road.”<br>RW2: “Cones and a work crew are present.”':'T1: “Traffic is moving slowly here.”'}<br>22 Sep 2026 · These are fictional reports.</div>`);break;}
 case 'open-help':showModal('Meet Amara.',`<p class="modal-copy">A clearer way home, with the evidence in view.</p><div class="choice-list"><button data-action="reset">${icon('grid')}1. Explore the local briefing</button><button data-action="preview-route">${icon('route')}2. Switch walking / driving</button><button data-action="advance">${icon('spark')}3. Add new fictional evidence</button></div><p class="modal-copy">Open <strong>Mock preview</strong> in the header to try all 14 states. Reports, summaries, routes, and positions are mocked. Only the basemap connects to Mapbox.</p>`);break;
}});
$('#scenario').addEventListener('change',event=>{closePreview();state.scenario=event.target.value;if(state.scenario==='unfollowed')navigate('saved');else if(state.scenario==='route-error'){state.journeyStep='review';navigate('journey');}else if(['conflict','confirmed'].includes(state.scenario))navigate('incident/market-junction');else navigate('overview');render();});
window.addEventListener('hashchange',()=>{if(location.hash==='#sources'){document.getElementById('sources')?.scrollIntoView();return;}render();$('#panel').scrollTop=0;state.panelHidden=false;applyPanel();});
$('#modal').addEventListener('click',event=>{if(event.target===$('#modal'))$('#modal').close();});
$('#preview-tools').addEventListener('click',event=>{if(event.target===$('#preview-tools'))closePreview();});
document.addEventListener('toggle',event=>{if(event.target.id==='local-more'){state.localExpanded=event.target.open;if(event.target.open)enterMotion(event.target.querySelectorAll('.local-content > *'),{duration:.25,stagger:.025});}},true);
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInterval(mockTimer);}else if(state.active){state.active=false;state.resume=true;render();toast('Demo journey paused while away. Resume explicitly.');}});
document.addEventListener('click',event=>{if(event.target.closest('a[href="#sources"]')){event.preventDefault();document.getElementById('sources')?.scrollIntoView({block:'start'});}},true);
async function initializeMap() {
  const attempt = ++mapAttempt;
  clearTimeout(mapTimeout);
  if (map) { map.remove(); map = undefined; }
  if (rasterMap) { rasterMap.remove(); rasterMap = undefined; }
  $('#map').classList.remove('hidden');
  $('.map-panel').dataset.mapMode = 'webgl';
  mapReady = false;
  mapInitializing = true;
  window.amaraMapReady = false;
  $('.map-panel').dataset.mapState = 'loading';
  $('#map-problem').hidden = false;
  $('#map-problem').innerHTML = `${icon('layers')}<h2>Loading your 3D map</h2><p>Checking the renderer and browser graphics…</p>`;
  $('#map-notice').textContent = 'Loading 3D · no route conditions inferred';
  $('#map-notice').dataset.loadState = 'loading';
  updateDimensionControl();
  reportMapState('loading');
  try {
    let config;
    try {
      const result = await fetch('/config.json', {signal:AbortSignal.timeout(8000)});
      if (!result.ok) throw new Error();
      config = await result.json();
    } catch (_) { if (attempt === mapAttempt) mapFailure('config_unavailable'); return; }
    if (attempt !== mapAttempt) return;
    mapDiagnostics.token_configured = Boolean(config.mapboxToken);
    if (!config.mapboxToken) { mapFailure('token_missing'); return; }
    if (new URLSearchParams(location.search).get('map') === '2d') { startRasterMap('requested_2d'); return; }
    mapDiagnostics.sdk_loaded = Boolean(window.mapboxgl);
    if (!window.mapboxgl) { mapFailure('sdk_unavailable'); return; }
    if (!mapboxgl.supported({failIfMajorPerformanceCaveat:false})) {
      try { await loadCompatibleRenderer(); } catch (_) { mapFailure('sdk_unavailable'); return; }
      if (attempt !== mapAttempt) return;
    }
    const compatible = mapboxgl.version.startsWith('2.');
    mapDiagnostics.renderer = compatible ? 'webgl1' : 'standard';
    mapDiagnostics.webgl_supported = mapboxgl.supported({failIfMajorPerformanceCaveat:false});
    if (!mapDiagnostics.webgl_supported) { mapFailure('webgl_unavailable'); return; }
    mapboxgl.accessToken = config.mapboxToken;
    map = new mapboxgl.Map({
      container: 'map', style: compatible ? 'mapbox://styles/mapbox/light-v11' : 'mapbox://styles/mapbox/standard',
      center: [3.3757, 6.5121], zoom: 16.65, pitch: 66, bearing: -32,
      ...(compatible ? {} : {config: {basemap: {lightPreset: 'dawn', showPointOfInterestLabels: false, showTransitLabels: false}}}),
      attributionControl: true, failIfMajorPerformanceCaveat:false,
    });
    reportMapState('loading_style');
    mapTimeout = setTimeout(() => {
      if (attempt === mapAttempt && !mapReady) mapFailure('map_timeout');
    }, 30000);
    map.on('load', () => {
      if (attempt !== mapAttempt) return;
      clearTimeout(mapTimeout);
      if (compatible) {
        const labelLayer = map.getStyle().layers.find(layer => layer.type === 'symbol' && layer.layout?.['text-field']);
        map.addLayer({id:'compatible-3d-buildings',source:'composite','source-layer':'building',filter:['==','extrude','true'],type:'fill-extrusion',minzoom:14,paint:{'fill-extrusion-color':'#d3d8c5','fill-extrusion-height':['coalesce',['get','height'],0],'fill-extrusion-base':['coalesce',['get','min_height'],0],'fill-extrusion-opacity':.95}}, labelLayer?.id);
      }
      mapReady = true;
      mapInitializing = false;
      $('.map-panel').dataset.mapState = 'ready';
      $('#map-problem').hidden = true;
      $('#map-fallback').style.visibility = 'hidden';
      map.addSource('demo-route', {type: 'geojson', data: {type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: routes[state.mode]}}});
      map.addLayer({id: 'demo-route-outline', type: 'line', source: 'demo-route', ...(compatible?{}:{slot: 'middle'}), layout: {'line-join': 'round', 'line-cap': 'round'}, paint: {'line-color': '#ffffff', 'line-width': 9, 'line-opacity': .9}});
      map.addLayer({id: 'demo-route-line', type: 'line', source: 'demo-route', ...(compatible?{}:{slot: 'middle'}), layout: {'line-join': 'round', 'line-cap': 'round'}, paint: {'line-color': '#365d48', 'line-width': 5, 'line-dasharray': [2, 1]}});
      [
        [[3.3757, 6.5121], 'alert', 'Market Junction: view fictional evidence', 'incident'],
        [destination, 'home', 'Demo destination', 'home'],
        [start, '', 'Simulated starting position', 'person'],
      ].forEach(([point, i, label, type]) => {
        const element = document.createElement(type === 'incident' ? 'button' : 'div');
        element.className = 'marker ' + (type === 'incident' ? 'selected' : type);
        element.innerHTML = i ? icon(i) : '';
        element.setAttribute('aria-label', label);
        if (type === 'incident') element.addEventListener('click', () => { showCallout(); enterMotion($('#map-callout').children, {duration: .22, stagger: 0}); });
        const marker = new mapboxgl.Marker({element}).setLngLat(point).addTo(map);
        if (type === 'person') positionMarker = marker;
      });
      syncMapContext();
      if (page() === 'journey') recenter();
      $('#map-notice').textContent = compatible ? '3D compatibility view · fictional reports' : 'Mapbox basemap · fictional reports';
      $('#map-notice').dataset.loadState = 'ready';
      window.amaraMapReady = true;
      window.amaraMapMode = compatible ? 'webgl1' : 'standard';
      updateDimensionControl();
      reportMapState('ready');
    });
    map.on('dragstart', () => { state.following = false; if (state.active) render(); });
    map.on('error', event => {
      if (attempt === mapAttempt && !mapReady) mapFailure(classifyMapError(event.error));
    });
    map.getCanvas().addEventListener('webglcontextlost', () => {
      if (attempt === mapAttempt) mapFailure('context_lost');
    });
  } catch (error) {
    if (attempt === mapAttempt) mapFailure(classifyMapError(error));
  }
}
render();initializeMap();
