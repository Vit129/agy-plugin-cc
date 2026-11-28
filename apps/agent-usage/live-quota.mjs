import { estimateCapacity, levelFor, readQuota } from './quota.mjs';
import { probeNativeQuota } from './provider-quota.mjs';

export function createLiveQuotaReader({ env = process.env, now = Date.now, probe = probeNativeQuota,
  log = message => process.stderr.write(`${message}\n`), publish = () => {} } = {}) {
  const cache = new Map();
  return async function readLiveQuota(settings) {
    const rows = readQuota(settings, { env, nowSec: Math.floor(now() / 1000) });
    for (const provider of cache.keys()) {
      if (!rows.some(row => row.provider === provider)) cache.delete(provider);
    }
    const cadence = settings.refreshMinutes * 60_000;
    const freshFor = Math.max(5 * 60_000, cadence + 60_000);
    return Promise.all(rows.map(async row => {
      const previous = cache.get(row.provider);
      if (row.windows.every(window => window.state === 'live' && window.remaining !== null)) {
        if (previous?.error) previous.error = null;
        return row;
      }
      let sample = previous?.sample;
      let errorReason = previous?.error;
      if (!previous || now() - previous.attemptedAt >= cadence) {
        const attemptedAt = now();
        let next;
        try {
          next = await probe(row.provider, env, now);
          errorReason = null;
        } catch (error) {
          errorReason = error.killed ? 'timeout' : typeof error.code === 'number' ? `exit ${error.code}` : error.code || error.name;
          if (errorReason !== previous?.error) log(`Agent Usage · ${row.provider} quota probe: ${errorReason}`);
        }
        if (next) {
          sample = next;
          try {
            publish(row.provider, next, env);
          } catch (error) {
            log(`Agent Usage · ${row.provider} quota cache: ${error.code ?? error.name}`);
          }
        }
        cache.set(row.provider, { sample, attemptedAt, error: errorReason });
      }
      if (row.provider === 'claude' && errorReason) row = { ...row, state: 'error', error: errorReason };
      if (!sample) return row;
      const time = now();
      const state = time - sample.captured <= freshFor ? 'live' : 'aging';
      let usedNative = false;
      const windows = row.windows.map(window => {
        const replacement = sample.windows[window.short];
        if (!replacement || (replacement.resetsAt !== null && replacement.resetsAt * 1000 <= time)) return window;
        if (window.state === 'live' && (state !== 'live' || row.capturedAt * 1000 > sample.captured)) return window;
        if (state === 'aging' && window.remaining !== null && row.capturedAt * 1000 > sample.captured) return window;
        usedNative = true;
        return { ...window, ...replacement, state, level: levelFor(replacement.remaining, settings), source: `${row.provider}-cli` };
      });
      if (!usedNative) return row;
      return { ...row, windows, capturedAt: Math.max(row.capturedAt ?? 0, Math.floor(sample.captured / 1000)), capacity: estimateCapacity(windows, settings) };
    }));
  };
}
