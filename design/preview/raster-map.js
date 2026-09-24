/* Real Web Mercator raster map. DOM images + SVG, with no canvas or WebGL. */
class AmaraRasterMap {
  constructor({container, center, zoom, onReady, onError, onInteract, onIncident, onMapClick}) {
    this.root = container;
    this.center = [...center];
    this.zoom = Math.round(zoom);
    this.onReady = onReady;
    this.onError = onError;
    this.onInteract = onInteract;
    this.onMapClick = onMapClick;
    this.onIncident = onIncident;
    this.incidentMarkers = new Map();
    this.tiles = new Map();
    this.ready = false;
    this.failed = false;
    this.scene = {route: [], routeVisible: false, position: center, destination: center, incident: center};
    this.controller = new AbortController();
    this.root.hidden = false;
    this.root.tabIndex = 0;
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', '2D street map. Use arrow keys to pan, plus and minus to zoom.');
    this.root.innerHTML = `<div class="raster-tiles"></div>
      <svg class="raster-overlay" aria-hidden="true"><circle class="raster-accuracy"/><path class="raster-route-outline"/><path class="raster-route"/><path class="raster-travelled"/></svg>
      <button class="raster-marker raster-incident" aria-label="Market Junction: read incident briefing">!</button>
      <span class="raster-marker raster-person" role="img" aria-label="Simulated position"></span>
      <span class="raster-marker raster-home" role="img" aria-label="Demo destination">⌂</span>
      <span class="raster-marker raster-origin" role="img" aria-label="Route starting point"></span>
      <div class="raster-incident-group"></div>
      <div class="mapboxgl-ctrl-bottom-left"><div class="mapboxgl-ctrl"><a class="mapboxgl-ctrl-logo" href="https://www.mapbox.com/" target="_blank" rel="noopener" aria-label="Mapbox"></a></div></div>
      <div class="mapboxgl-ctrl-bottom-right"><div class="mapboxgl-ctrl mapboxgl-ctrl-attrib">© <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></div></div>`;
    this.tileLayer = this.root.querySelector('.raster-tiles');
    this.svg = this.root.querySelector('svg');
    this.root.querySelector('.raster-incident').addEventListener('click', onIncident, {signal: this.controller.signal});
    this.bindControls();
    this.observer = new ResizeObserver(() => this.render());
    this.observer.observe(this.root);
    this.render();
  }

  static world([lng, lat], zoom) {
    const size = 256 * 2 ** zoom;
    const sin = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180);
    return [(lng + 180) / 360 * size, (.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
  }

  static geographic([x, y], zoom) {
    const size = 256 * 2 ** zoom;
    return [x / size * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / size))) * 180 / Math.PI];
  }

  project(coordinates) {
    const point = AmaraRasterMap.world(coordinates, this.zoom);
    const center = AmaraRasterMap.world(this.center, this.zoom);
    return [point[0] - center[0] + this.width / 2, point[1] - center[1] + this.height / 2];
  }

  setScene(scene) {
    this.scene = {...this.scene, ...scene};
    this.renderOverlay();
  }

  renderOverlay() {
    if (!this.width || !this.height) return;
    this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    const path = this.scene.routeVisible ? this.scene.route.map((point, index) => `${index ? 'L' : 'M'}${this.project(point).join(',')}`).join(' ') : '';
    this.svg.querySelectorAll('.raster-route-outline,.raster-route').forEach(element => element.setAttribute('d', path));
    this.renderTrail();
    const circle = this.svg.querySelector('.raster-accuracy');
    const positionVisible = this.scene.positionVisible ?? this.scene.routeVisible;
    const position = this.scene.position;
    circle.style.display = positionVisible && position && this.scene.accuracy > 0 ? '' : 'none';
    if (position) {
      const [x, y] = this.project(position);
      circle.setAttribute('cx', x); circle.setAttribute('cy', y);
      circle.setAttribute('r', Math.max(0, (this.scene.accuracy || 0) / (40075016.686 * Math.cos(position[1] * Math.PI / 180) / (256 * 2 ** this.zoom))));
      circle.classList.toggle('stale', Boolean(this.scene.positionStale));
    }
    for (const [selector, coordinates, visible] of [
      ['.raster-incident', this.scene.incident, true],
      ['.raster-person', this.scene.position, positionVisible],
      ['.raster-home', this.scene.destination, this.scene.routeVisible],
      ['.raster-origin', this.scene.origin, this.scene.routeVisible && Boolean(this.scene.origin)],
    ]) {
      const marker = this.root.querySelector(selector);
      if (!coordinates) { marker.hidden = true; continue; }
      const [x, y] = this.project(coordinates);
      marker.style.left = `${x}px`;
      marker.style.top = `${y}px`;
      marker.hidden = !visible;
    }
    this.root.querySelector('.raster-person').classList.toggle('stale', Boolean(this.scene.positionStale));
    this.root.querySelector('.raster-person').setAttribute('aria-label', this.scene.positionLabel || 'Simulated position');
    this.root.querySelector('.raster-home').setAttribute('aria-label', this.scene.destinationLabel || 'Destination');
    if (Array.isArray(this.scene.incidents)) {
      this.root.querySelector('.raster-incident').hidden = true;
      const wanted = new Set();
      for (const incident of this.scene.incidents) {
        if (!incident.coordinates) continue;
        wanted.add(incident.id);
        let marker = this.incidentMarkers.get(incident.id);
        if (!marker) {
          marker = document.createElement('button'); marker.className = 'raster-marker raster-incident-item'; marker.textContent = '!';
          marker.addEventListener('click', () => this.onIncident(incident.id), {signal: this.controller.signal});
          this.root.querySelector('.raster-incident-group').append(marker); this.incidentMarkers.set(incident.id, marker);
        }
        const [x, y] = this.project(incident.coordinates);
        marker.textContent=incident.review_state==='received'?'?':incident.review_state==='checking'?'…':'!';
        marker.style.left = `${x}px`; marker.style.top = `${y}px`; marker.setAttribute('aria-label', incident.title);marker.dataset.reviewState=incident.review_state||'reviewed';
      }
      for (const [id, marker] of this.incidentMarkers) if (!wanted.has(id)) { marker.remove(); this.incidentMarkers.delete(id); }
    }
  }

  updatePosition(state){
    this.scene={...this.scene,...state};
    const marker=this.root.querySelector('.raster-person'),circle=this.svg.querySelector('.raster-accuracy');
    if(!state.position||!state.positionVisible){marker.hidden=true;circle.style.display='none';return;}
    const [x,y]=this.project(state.position);marker.hidden=false;marker.style.left=`${x}px`;marker.style.top=`${y}px`;
    marker.classList.toggle('stale',Boolean(state.positionStale));marker.setAttribute('aria-label',state.positionLabel||'Position');
    circle.style.display=state.accuracy>0?'':'none';circle.setAttribute('cx',x);circle.setAttribute('cy',y);
    circle.setAttribute('r',Math.max(0,(state.accuracy||0)/(40075016.686*Math.cos(state.position[1]*Math.PI/180)/(256*2**this.zoom))));
    circle.classList.toggle('stale',Boolean(state.positionStale));
  }
  setTrail(points){this.scene.trail=points;this.renderTrail();}
  renderTrail(){const points=this.scene.trail||[];this.svg.querySelector('.raster-travelled').setAttribute('d',points.map((point,index)=>`${index?'L':'M'}${this.project(point).join(',')}`).join(' '));}

  render() {
    if (this.removed) return;
    this.width = this.root.clientWidth;
    this.height = this.root.clientHeight;
    if (!this.width || !this.height) return;
    const center = AmaraRasterMap.world(this.center, this.zoom);
    const left = center[0] - this.width / 2, top = center[1] - this.height / 2;
    const n = 2 ** this.zoom;
    const keys = new Set();
    const pending = [];
    for (let y = Math.floor(top / 256); y <= Math.floor((top + this.height) / 256); y++) {
      for (let x = Math.floor(left / 256); x <= Math.floor((left + this.width) / 256); x++) {
        if (y < 0 || y >= n) continue;
        const wrappedX = ((x % n) + n) % n;
        const key = `${this.zoom}/${x}/${y}`;
        keys.add(key);
        let tile = this.tiles.get(key);
        if (!tile) {
          const image = document.createElement('img');
          image.alt = '';
          image.draggable = false;
          tile = {image, status: 'loading', url: `/raster/${this.zoom}/${wrappedX}/${y}.png`};
          this.tiles.set(key, tile);
          image.onload = () => {
            tile.status = 'loaded';
            if (this.removed || !this.tiles.has(key)) return;
            if (!this.ready) {
              this.ready = true;
              this.onReady();
            }
          };
          image.onerror = () => { tile.status = 'failed'; this.checkFailures(); };
          this.tileLayer.append(image);
          pending.push(tile);
        }
        tile.image.style.transform = `translate(${Math.round(x * 256 - left)}px,${Math.round(y * 256 - top)}px)`;
      }
    }
    for (const [key, tile] of this.tiles) {
      if (!keys.has(key)) { tile.image.onload = tile.image.onerror = null; tile.image.remove(); this.tiles.delete(key); }
    }
    // Register the whole visible set before any cached image callback can fire.
    for (const tile of pending) tile.image.src = tile.url;
    this.renderOverlay();
    this.checkFailures();
  }

  checkFailures() {
    if (this.removed || this.failed || !this.tiles.size) return;
    if ([...this.tiles.values()].every(tile => tile.status === 'failed')) {
      this.failed = true;
      this.onError();
    }
  }

  easeTo({center, zoom}) {
    if (center) this.center = [...center];
    if (zoom !== undefined) this.zoom = Math.max(8, Math.min(18, Math.round(zoom)));
    this.render();
  }

  zoomIn() { this.easeTo({zoom: this.zoom + 1}); }
  zoomOut() { this.easeTo({zoom: this.zoom - 1}); }
  getZoom() { return this.zoom; }

  focus(point, padding = {}) {
    const world = AmaraRasterMap.world(point, this.zoom);
    const offset = [((padding.left || 0) - (padding.right || 0)) / 2, ((padding.top || 0) - (padding.bottom || 0)) / 2];
    this.center = AmaraRasterMap.geographic([world[0] - offset[0], world[1] - offset[1]], this.zoom);
    this.render();
  }

  fitBounds(points, padding = {}) {
    if (!points?.length) return;
    const worlds = points.map(point => AmaraRasterMap.world(point, 0));
    const xs = worlds.map(point => point[0]), ys = worlds.map(point => point[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = Math.max(80, this.width - (padding.left || 0) - (padding.right || 0));
    const height = Math.max(80, this.height - (padding.top || 0) - (padding.bottom || 0));
    this.zoom = Math.max(8, Math.min(17, Math.floor(Math.log2(Math.min(width / Math.max(maxX - minX, .00001), height / Math.max(maxY - minY, .00001))))));
    this.focus(AmaraRasterMap.geographic([(minX + maxX) / 2, (minY + maxY) / 2], 0), padding);
  }

  pan(dx, dy) {
    const point = AmaraRasterMap.world(this.center, this.zoom);
    this.center = AmaraRasterMap.geographic([point[0] - dx, point[1] - dy], this.zoom);
    this.render();
  }

  bindControls() {
    const options = {signal: this.controller.signal};
    this.root.addEventListener('pointerdown', event => {
      if (event.target.closest('button,a') || event.button !== 0) return;
      this.drag = [event.clientX, event.clientY];
      this.dragStart = [...this.drag];
      this.root.setPointerCapture(event.pointerId);
      this.onInteract();
    }, options);
    this.root.addEventListener('pointermove', event => {
      if (!this.drag) return;
      const dx = event.clientX - this.drag[0], dy = event.clientY - this.drag[1];
      this.drag = [event.clientX, event.clientY];
      this.pan(dx, dy);
    }, options);
    this.root.addEventListener('pointerup', event => {
      if (this.dragStart && Math.hypot(event.clientX - this.dragStart[0], event.clientY - this.dragStart[1]) < 6 && !event.target.closest('button,a')) {
        const rect = this.root.getBoundingClientRect(), center = AmaraRasterMap.world(this.center, this.zoom);
        this.onMapClick?.(AmaraRasterMap.geographic([center[0] + event.clientX - rect.left - this.width / 2, center[1] + event.clientY - rect.top - this.height / 2], this.zoom));
      }
      this.dragStart = null;
    }, options);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.root.addEventListener(type, () => { this.drag = null; }, options);
    this.root.addEventListener('keydown', event => {
      if (event.target !== this.root) return;
      const pans = {ArrowLeft:[90,0], ArrowRight:[-90,0], ArrowUp:[0,90], ArrowDown:[0,-90]};
      if (pans[event.key]) { event.preventDefault(); this.onInteract(); this.pan(...pans[event.key]); }
      else if (['+','=','-'].includes(event.key)) { event.preventDefault(); event.key === '-' ? this.zoomOut() : this.zoomIn(); }
    }, options);
  }

  remove() {
    this.removed = true;
    this.controller.abort();
    this.observer.disconnect();
    for (const tile of this.tiles.values()) tile.image.onload = tile.image.onerror = null;
    this.tiles.clear();
    this.root.innerHTML = '';
    this.root.hidden = true;
  }
}
