(() => {
  const config = JSON.parse(document.querySelector('#app-config').textContent);
  let scene = JSON.parse(document.querySelector('#map-state').textContent);
  const panel = document.querySelector('#panel'), modal = document.querySelector('#modal');
  const workspace = document.querySelector('.workspace');
  const panelToggle = document.querySelector('.mobile-panel-toggle');
  let requestNumber = 0, messageTimer, map, journey, evidence;

  function syncPanel(){
    AmaraPanel.sync({workspace,panel,toggle:panelToggle,compact:matchMedia('(max-width: 760px)').matches,activeElement:document.activeElement});
  }
  new MutationObserver(syncPanel).observe(workspace,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',syncPanel);
  syncPanel();

  function message(text) {
    clearTimeout(messageTimer);
    const target = document.querySelector('#app-message');
    target.textContent = text; target.hidden = false;
    messageTimer = setTimeout(() => { target.hidden = true; }, 4500);
  }

  function motion() {
    if (!window.gsap || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo([...panel.children], {y: 9, opacity: 0}, {y: 0, opacity: 1, duration: .28, stagger: .02, clearProps: 'transform,opacity'});
  }

  async function navigate(url, push = true) {
    const target = new URL(url, location.origin);
    if (target.origin !== location.origin) { location.assign(target.href); return; }
    const number = ++requestNumber;
    map?.cancelPick();
    try {
      const response = await fetch(target, {headers: {'X-Amara-Partial': '1'}, signal: AbortSignal.timeout(12000)});
      if (!response.ok && response.status !== 400) throw new Error('Page unavailable');
      const data = await response.json();
      if (number !== requestNumber) return;
      panel.innerHTML = data.html; panel.scrollTop = 0; document.title = data.title;
      document.querySelector('.workspace').dataset.screen = data.section;
      document.querySelector('.workspace').classList.remove('map-only');
      syncPanel();
      document.querySelector('.mobile-panel-toggle span').textContent = 'Show map';
      document.querySelectorAll('[data-nav]').forEach(link => {
        const selected = link.dataset.nav === (data.section === 'incident' ? 'overview' : data.section);
        link.classList.toggle('active', selected);
        if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
      });
      scene = data.map_state;
      journey.hydrate(scene);
      evidence?.hydrate();
      if (push) history.pushState({}, '', target.pathname + target.search + target.hash);
      if(evidence&&!evidence.suspended()){evidence.hydrate();evidence.refresh();}
      panel.focus({preventScroll: true}); motion();
    } catch (_) { message('This view could not load. Your current briefing is still available.'); }
  }

  document.addEventListener('click', event => {
    if(event.target.closest('a[href="#panel"]')){
      event.preventDefault();workspace.classList.remove('map-only');syncPanel();
      panelToggle.querySelector('span').textContent='Show map';panel.focus({preventScroll:true});return;
    }
    const link = event.target.closest('a[data-panel]');
    if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); navigate(link.href); return; }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'toggle-panel') {
      const workspace = document.querySelector('.workspace'); workspace.classList.toggle('map-only');
      syncPanel();
      document.querySelector('.mobile-panel-toggle span').textContent = workspace.classList.contains('map-only') ? 'Show briefing' : 'Show map';
      if(map.following)map.recenter();
    }
    if (action === 'about') {
      document.querySelector('#modal-title').textContent = 'Meet Amara';
      document.querySelector('#modal-content').innerHTML = '<p class="modal-copy">Amara combines real routes with source-linked evidence. Check reports runs AI analysis; public-source search uses Tavily. Uncertainty and original sources remain visible.</p><p class="modal-copy mt-3">The laptop journey simulates movement and timed report delivery. AI evidence revisions are separate real processing results, published only after validation.</p><p class="modal-copy mt-3">Live GPS is optional and stops on end or pause. No movement history is saved.</p>';
      modal.showModal();
    }
    if (action === 'close-modal') modal.close();
    if (action === 'end-journey') journey.end();
  });

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('[data-preference-form]')) return;
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      const response = await fetch(form.action, {method: 'POST', headers: {'X-Amara-Partial': '1'}, body: new FormData(form), signal: AbortSignal.timeout(10000)});
      if (!response.ok || !(await response.json()).saved) throw new Error();
      form.querySelector('.save-state').textContent = 'Saved to your browser’s preferences.';
      evidence?.refresh();
    } catch (_) { form.querySelector('.save-state').textContent = 'Could not save. Please try again.'; }
    finally { submit.disabled = false; }
  });
  window.addEventListener('popstate', () => navigate(location.href, false));
  modal.addEventListener('click', event => { if (event.target === modal) modal.close(); });
  history.replaceState({}, '', location.href);
  map = new AmaraMap(config, scene, navigate);
  journey = new AmaraJourney(config, map, message);
  journey.hydrate(scene);
  evidence = new AmaraEvidence(config, map, journey, navigate, message);
  window.amara = {navigate, map, journey, evidence};
})();
