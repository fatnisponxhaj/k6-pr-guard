import { readFileSync } from 'node:fs';
import { normalizeSummary } from '../src/parse.js';

export const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
export const load = (name) => normalizeSummary(fixture(name));
export const fixturePath = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname;

/** Builds a small handleSummary-style summary for edge-case tests. */
export function makeSummary({ p95 = 100, p99 = 150, errorRate = 0, checks = 1, reqs = 100, durationMs = 10000, extra = {}, thresholds = {} } = {}) {
  const trend = (values) => ({ type: 'trend', contains: 'time', values });
  return normalizeSummary({
    state: { testRunDurationMs: durationMs },
    metrics: {
      http_reqs: { type: 'counter', values: { count: reqs, rate: reqs / 10 } },
      iterations: { type: 'counter', values: { count: reqs, rate: reqs / 10 } },
      http_req_duration: { ...trend({ avg: p95 / 2, med: p95 / 2, 'p(95)': p95, ...(p99 !== null && { 'p(99)': p99 }) }), thresholds: thresholds.http_req_duration },
      http_req_failed: { type: 'rate', values: { rate: errorRate, passes: 0, fails: 0 }, thresholds: thresholds.http_req_failed },
      checks: { type: 'rate', values: { rate: checks, passes: 0, fails: 0 } },
      ...extra,
    },
  });
}

export const subTrend = (p95, p99 = p95 * 1.2) => ({ type: 'trend', contains: 'time', values: { avg: p95 / 2, 'p(95)': p95, 'p(99)': p99 } });
