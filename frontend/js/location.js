(function (root, factory) {
  const Tracker = factory();
  if (typeof module === 'object' && module.exports) module.exports = Tracker;
  else root.AmaraLocation = Tracker;
})(globalThis, function () {
  return class AmaraLocation {
    constructor(options = {}) {
      this.provider = options.geolocation || globalThis.navigator?.geolocation;
      this.secure = options.secure ?? globalThis.isSecureContext;
      this.now = options.now || Date.now;
      this.schedule = options.setInterval || globalThis.setInterval;
      this.cancel = options.clearInterval || globalThis.clearInterval;
      this.onChange = options.onChange || (() => {});
      this.maxAge = options.maxAge ?? 30000;
      this.maxAccuracy = options.maxAccuracy ?? 150;
      this.watchId = null;
      this.timer = null;
      this.generation = 0;
      this.status = 'idle';
      this.sample = null;
    }

    snapshot() {
      const age = this.sample ? Math.max(0, this.now() - this.sample.timestamp) : null;
      const fresh = this.status === 'tracking' && age !== null && age <= this.maxAge && this.sample.accuracy <= this.maxAccuracy;
      return {status: this.status, sample: this.sample, age, fresh, watching: this.watchId !== null};
    }

    emit() { this.onChange(this.snapshot()); }

    clear() {
      ++this.generation;
      if (this.watchId !== null) this.provider?.clearWatch(this.watchId);
      this.watchId = null;
      if (this.timer !== null) this.cancel(this.timer);
      this.timer = null;
    }

    start() {
      this.clear();
      if (!this.secure || !this.provider) { this.status = 'unsupported'; this.emit(); return; }
      this.status = 'requesting';
      this.emit();
      const generation = this.generation;
      let id;
      try { id = this.provider.watchPosition(position => {
        if (generation !== this.generation) return;
        const {longitude, latitude, accuracy} = position.coords || {};
        if (![longitude, latitude, accuracy, position.timestamp].every(Number.isFinite) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90 || accuracy < 0 || position.timestamp > this.now() + 5000) {
          this.status = 'unavailable'; this.emit(); return;
        }
        this.sample = {coordinates: [longitude, latitude], accuracy, timestamp: position.timestamp};
        this.status = this.now() - position.timestamp > this.maxAge ? 'stale' : accuracy > this.maxAccuracy ? 'approximate' : 'tracking';
        this.emit();
      }, error => {
        if (generation !== this.generation) return;
        if (error.code === 1) { this.clear(); this.status = 'denied'; }
        else this.status = error.code === 3 ? 'timeout' : 'unavailable';
        this.emit();
      }, {enableHighAccuracy: true, maximumAge: 5000, timeout: 15000}); }
      catch (_) { this.clear(); this.status = 'unavailable'; this.emit(); return; }
      // A test/provider may invoke a denial synchronously before returning its ID.
      if (generation !== this.generation) { this.provider.clearWatch(id); return; }
      this.watchId = id;
      this.timer = this.schedule(() => this.refresh(), 5000);
      this.emit();
    }

    refresh() {
      if (this.sample && this.watchId !== null && this.now() - this.sample.timestamp > this.maxAge) this.status = 'stale';
      this.emit();
    }

    stop(status = 'ended') {
      this.clear();
      this.status = status;
      if (status !== 'paused') this.sample = null;
      this.emit();
    }

    pause() { this.stop('paused'); }
  };
});
