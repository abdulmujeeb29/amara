(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AmaraGeo = api;
})(globalThis, function () {
  const R = 6371008.8, rad = Math.PI / 180;
  const valid = point => Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;

  function distance(a, b) {
    const lat = (b[1] - a[1]) * rad, lng = (b[0] - a[0]) * rad;
    const value = Math.sin(lat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(lng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(value)));
  }

  function project(point, route) {
    if (!valid(point) || !Array.isArray(route) || route.length < 2) return null;
    let best = null, total = 0;
    const xScale = R * rad * Math.cos(point[1] * rad), yScale = R * rad;
    for (let index = 0; index < route.length - 1; index++) {
      const a = route[index], b = route[index + 1];
      if (!valid(a) || !valid(b)) return null;
      const ax = (a[0] - point[0]) * xScale, ay = (a[1] - point[1]) * yScale;
      const dx = (b[0] - a[0]) * xScale, dy = (b[1] - a[1]) * yScale;
      const length = distance(a, b), squared = dx * dx + dy * dy;
      const t = squared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / squared)) : 0;
      const separation = Math.hypot(ax + t * dx, ay + t * dy);
      if (!best || separation < best.distance) best = {distance: separation, along: total + t * length, index, coordinates: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]};
      total += length;
    }
    return {...best, total, fraction: total ? best.along / total : 0};
  }

  function pointAlong(route, fraction) {
    if (!Array.isArray(route) || !route.length) return null;
    let total = 0;
    const lengths = route.slice(1).map((point, index) => { const length = distance(route[index], point); total += length; return length; });
    let remaining = Math.max(0, Math.min(1, fraction)) * total;
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i] && lengths[i] > 0) {
        const t = remaining / lengths[i];
        return [route[i][0] + (route[i + 1][0] - route[i][0]) * t, route[i][1] + (route[i + 1][1] - route[i][1]) * t];
      }
      remaining -= lengths[i];
    }
    return [...route[route.length - 1]];
  }

  function circle(center, metres) {
    if (!valid(center) || !Number.isFinite(metres) || metres <= 0) return {type: 'FeatureCollection', features: []};
    const lat = center[1] * rad, lng = center[0] * rad, angular = metres / R, points = [];
    for (let i = 0; i <= 64; i++) {
      const bearing = i / 64 * 2 * Math.PI;
      const y = Math.asin(Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing));
      const x = lng + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat), Math.cos(angular) - Math.sin(lat) * Math.sin(y));
      points.push([x / rad, y / rad]);
    }
    return {type: 'FeatureCollection', features: [{type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: [points]}}]};
  }

  function relevant(incidents, route, corridor = 150) {
    return incidents.flatMap(incident => {
      const projection = project(incident.coordinates, route);
      return projection && projection.distance <= corridor ? [{...incident, route_distance_m: projection.distance, along_m: projection.along}] : [];
    }).sort((a, b) => a.along_m - b.along_m);
  }

  return {valid, distance, project, pointAlong, circle, relevant};
});
