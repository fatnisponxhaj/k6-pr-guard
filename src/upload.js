// Sends a run to p95 Guard Pro (https://p95guard.dev), where it becomes part of the trend history.
// Only used when an API key is configured. Upload problems are reported, never fatal.

import { isTrackedTrend } from './compare.js';
import { readEvent } from './github.js';

export const DEFAULT_API_URL = 'https://p95guard.dev';

// Same limits the API enforces (64 KB, 500 points), with headroom for the other fields.
const MAX_POINTS = 500;
const MAX_POINTS_BYTES = 60 * 1024;
const METRIC = /^[\x20-\x7E]{1,200}$/;
const STAT = /^[A-Za-z0-9().]{1,16}$/;

const KEY_STATS = ['p(95)', 'p(99)'];
const OTHER_STATS = ['p(90)', 'med', 'avg', 'max', 'min'];

/**
 * The numbers to upload, most important first: p95/p99 of tracked trends, then error rate,
 * checks and request counts, then the other trend stats. Stops before the API's limits.
 */
export function buildPoints(summary, trendMetrics) {
  const trends = [...summary.metrics.values()].filter((m) => isTrackedTrend(m, trendMetrics));
  const candidates = [];
  for (const m of trends) for (const stat of KEY_STATS) candidates.push([m.name, stat, m.values[stat]]);
  candidates.push(
    ['http_req_failed', 'rate', summary.metrics.get('http_req_failed')?.values.rate],
    ['checks', 'rate', summary.metrics.get('checks')?.values.rate],
    ['http_reqs', 'count', summary.metrics.get('http_reqs')?.values.count],
    ['http_reqs', 'rate', summary.metrics.get('http_reqs')?.values.rate],
    ['iterations', 'count', summary.metrics.get('iterations')?.values.count],
  );
  for (const m of trends) for (const stat of OTHER_STATS) candidates.push([m.name, stat, m.values[stat]]);

  const points = [];
  let bytes = 2;
  let skipped = 0;
  for (const [metric, stat, value] of candidates) {
    if (value === undefined) continue;
    if (!METRIC.test(metric) || !STAT.test(stat) || !Number.isFinite(value)) {
      skipped++;
      continue;
    }
    const point = { metric, stat, value };
    const size = JSON.stringify(point).length + 1;
    if (points.length >= MAX_POINTS || bytes + size > MAX_POINTS_BYTES) {
      skipped++;
      continue;
    }
    points.push(point);
    bytes += size;
  }
  return { points, skipped };
}

/**
 * Where the run comes from, from the GitHub Actions environment. For pull requests this is the PR's
 * head commit and branch, not the temporary merge commit GitHub checks out.
 */
export function runContext(env) {
  const pr = readEvent(env.GITHUB_EVENT_PATH)?.pull_request;
  const runUrl = env.GITHUB_RUN_ID && env.GITHUB_SERVER_URL?.startsWith('https://')
    ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
    : null;
  return {
    repo: env.GITHUB_REPOSITORY ?? null,
    branch: (pr ? pr.head?.ref : env.GITHUB_REF_NAME) ?? null,
    sha: (pr ? pr.head?.sha : env.GITHUB_SHA) ?? null,
    pr: pr?.number ?? null,
    event: env.GITHUB_EVENT_NAME ?? null,
    runUrl,
  };
}

/** POSTs the run. Resolves to { ok, message }; never throws. */
export async function uploadRun({ apiUrl = DEFAULT_API_URL, apiKey, payload, fetchImpl = fetch, timeoutMs = 10_000 }) {
  const url = `${apiUrl.replace(/\/+$/, '')}/api/v1/runs`;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'user-agent': 'p95guard-action' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return { ok: true, message: 'uploaded to p95 Guard Pro' };
    const error = await res.json().then((b) => b?.error).catch(() => null);
    if (res.status === 401) return { ok: false, message: 'the API key was rejected. Check the P95GUARD_API_KEY secret.' };
    return { ok: false, message: error ? `${error} (HTTP ${res.status})` : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, message: e.name === 'TimeoutError' ? `no answer from ${url} within ${timeoutMs / 1000} s` : e.message };
  }
}
