// Turns either k6 summary format into one shape the comparison code can rely on.
//
// k6 writes two JSON shapes:
//   - `k6 run --summary-export=file.json`  (legacy): metric stats sit directly on the metric,
//     thresholds are `{ "p(95)<500": <failed: boolean> }`.
//   - `handleSummary(data)` + JSON.stringify: stats live under `values`, the metric has a `type`,
//     thresholds are `{ "p(95)<500": { ok: boolean } }`.

export class SummaryError extends Error {}

const TIME_METRIC = /(duration|waiting|connecting|tls_handshaking|sending|receiving|blocked)$/;

/**
 * @typedef {{ expr: string, ok: boolean }} Threshold
 * @typedef {{
 *   name: string, base: string, tags: Record<string, string>,
 *   type: 'trend'|'rate'|'counter'|'gauge', isTime: boolean,
 *   values: Record<string, number>, thresholds: Threshold[]
 * }} Metric
 * @typedef {{ format: 'handle-summary'|'summary-export', durationMs: number|null, metrics: Map<string, Metric> }} Summary
 */

/** @returns {Summary} */
export function normalizeSummary(raw) {
  if (!raw || typeof raw !== 'object' || !raw.metrics || typeof raw.metrics !== 'object') {
    throw new SummaryError('not a k6 summary: missing "metrics" object');
  }
  const entries = Object.entries(raw.metrics);
  const isHandleSummary = entries.some(([, m]) => m && typeof m === 'object' && 'values' in m);

  const metrics = new Map();
  for (const [name, m] of entries) {
    if (!m || typeof m !== 'object') continue;
    const metric = isHandleSummary ? fromHandleSummary(name, m) : fromSummaryExport(name, m);
    if (metric) metrics.set(name, metric);
  }

  return {
    format: isHandleSummary ? 'handle-summary' : 'summary-export',
    durationMs: typeof raw.state?.testRunDurationMs === 'number' ? raw.state.testRunDurationMs : null,
    metrics,
  };
}

function fromHandleSummary(name, m) {
  const values = numericOnly(m.values ?? {});
  const thresholds = Object.entries(m.thresholds ?? {}).map(([expr, t]) => ({ expr, ok: Boolean(t?.ok) }));
  return build(name, m.type ?? guessType(values), values, thresholds, m.contains === 'time');
}

function fromSummaryExport(name, m) {
  const { thresholds: rawThresholds, ...stats } = m;
  const values = numericOnly(stats);
  const type = guessType(values);
  // Legacy rate metrics call the rate "value"; expose it as "rate" like handleSummary does.
  if (type === 'rate' && values.rate === undefined) values.rate = values.value;
  // In the legacy export the boolean means "threshold failed".
  const thresholds = Object.entries(rawThresholds ?? {}).map(([expr, failed]) => ({ expr, ok: !failed }));
  return build(name, type, values, thresholds, null);
}

function build(name, type, values, thresholds, isTime) {
  const { base, tags } = splitName(name);
  return {
    name,
    base,
    tags,
    type,
    isTime: isTime ?? (type === 'trend' && TIME_METRIC.test(base)),
    values,
    thresholds,
  };
}

function guessType(values) {
  if ('avg' in values || 'med' in values) return 'trend';
  if ('passes' in values && 'fails' in values) return 'rate';
  if ('count' in values) return 'counter';
  return 'gauge';
}

function numericOnly(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}

/** "http_req_duration{scenario:browse,method:GET}" -> { base, tags } */
export function splitName(name) {
  const open = name.indexOf('{');
  if (open === -1 || !name.endsWith('}')) return { base: name, tags: {} };
  const tags = {};
  for (const pair of name.slice(open + 1, -1).split(',')) {
    const i = pair.indexOf(':');
    if (i > 0) tags[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return { base: name.slice(0, open), tags };
}

/** True when the run did no measurable work (k6 crashed early, wrong URL, 0 iterations...). */
export function isEmptyRun(summary) {
  const reqs = summary.metrics.get('http_reqs')?.values.count ?? 0;
  const iterations = summary.metrics.get('iterations')?.values.count ?? 0;
  return reqs === 0 && iterations === 0;
}
