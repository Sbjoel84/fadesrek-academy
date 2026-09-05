'use strict';

// One explicit, honest heuristic — a simple linear trend over historical
// periods. This is NOT a trained model and makes no claim to be one; it
// exists so "predict"-shaped questions get a labeled, defensible estimate
// instead of either silence or an invented number. Every caller must surface
// `method` and `sampleSize` to the user so the estimate is never presented
// as more authoritative than it is.

/**
 * @param {Array<{label:string, value:number}>} series chronological, oldest first
 * @returns {{projected:number, trend:'up'|'down'|'flat', deltaPct:number, method:string, sampleSize:number}|null}
 */
function projectNextPeriod(series) {
  if (!series || series.length < 2) return null; // not enough history for a trend

  const values = series.map(p => p.value);
  const deltas = [];
  for (let i = 1; i < values.length; i++) deltas.push(values[i] - values[i - 1]);
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;

  const last = values[values.length - 1];
  const projected = Math.max(0, Math.round(last + avgDelta));
  const deltaPct = last ? Math.round((avgDelta / last) * 1000) / 10 : 0;

  return {
    projected,
    trend: avgDelta > 0 ? 'up' : avgDelta < 0 ? 'down' : 'flat',
    deltaPct,
    method: 'linear-trend-heuristic',
    sampleSize: series.length,
  };
}

module.exports = { projectNextPeriod };
