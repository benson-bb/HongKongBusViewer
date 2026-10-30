(function (root) {
  'use strict';

  function nearestFeature(features, point, project, maxDistance, isEligible) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    let nearest = null;
    let nearestDistance = maxDistance;
    for (const feature of features || []) {
      if (isEligible && !isEligible(feature)) continue;
      const projected = project(feature);
      if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y)) continue;
      const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
      if (distance <= nearestDistance) {
        nearest = feature;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  const api = { nearestFeature };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MtrHitTest = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
