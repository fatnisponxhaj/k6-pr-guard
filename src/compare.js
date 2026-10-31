// Compares a load test run against the last good run and decides pass or fail.

import { isEmptyRun } from './parse.js';

export const DEFAULTS = Object.freeze({
  trendMetrics: ['http_req_duration'],
  // Max allowed latency increase, in percent of the baseline value.
  p95Pct: 10,
  p99Pct: 15,
  // Latency changes smaller than this are noise, whatever the percentage (2ms -> 3ms is +50%).
  minDeltaMs: 5,
  // Max allowed increase of http_req_failed, in percentage points (0.5% -> 1.5% is +1pp).
  errorRatePp: 1,
  // Max allowed drop of the checks pass rate, in percentage points.
  checksDropPp: 1,
  failOnThresholds: true,
  failOnEmpty: true,
  // True on the default branch, where a passing run replaces the baseline instead of being compared.
  savingBaseline: false,
});

// Sub-metric the load test adds on its own; it mostly duplicates the parent metric.
const IGNORED_TAGS = ['expected_response:true'];

/**
 * @param {import('./parse.js').Summary} current
 * @param {import('./parse.js').Summary|null} baseline
 */
export function compare(current, baseline, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const reasons = []; // why the verdict is "fail"
  const notes = []; // things worth knowing that don't fail the build
  const rows = [];

  if (isEmptyRun(current)) {
    const msg = 'The current run made no HTTP requests and no iterations. Did the load test fail to start or hit the wrong URL?';
    (opts.failOnEmpty ? reasons : notes).push(msg);
  }

  if (baseline && isEmptyRun(baseline)) {
    notes.push('The baseline run was empty, so it was ignored.');
    baseline = null;
  }
  if (!baseline && !opts.savingBaseline) {
    notes.push('No baseline yet: only the test\'s own thresholds were checked. Once this lands on the main branch, its run becomes the baseline.');
  }

  // Latency (trend) metrics, including tagged sub-metrics such as http_req_duration{scenario:checkout}.
  const stats = [
    { key: 'p(95)', budget: opts.p95Pct },
    { key: 'p(99)', budget: opts.p99Pct },
  ];
  const missingStats = new Set();
  for (const name of trendNames(current, baseline, opts.trendMetrics)) {
    const cur = current.metrics.get(name);
    const base = baseline?.metrics.get(name);
    if (!cur) {
      notes.push(`\`${name}\` is in the baseline but not in this run (renamed or removed scenario?).`);
      continue;
    }
    if (baseline && !base) notes.push(`\`${name}\` is new in this run, so it has no baseline yet.`);
    for (const { key, budget } of stats) {
      if (cur.values[key] === undefined) {
        missingStats.add(key);
        continue;
      }
      rows.push(latencyRow(name, key, base?.values[key], cur.values[key], budget, opts.minDeltaMs, cur.isTime));
    }
  }
  for (const key of missingStats) {
    notes.push(`\`${key}\` is not in the summary. Add it to \`summaryTrendStats\` in your test options to compare it.`);
  }

  // Error rate: higher is worse.
  const failed = current.metrics.get('http_req_failed');
  if (failed?.values.rate !== undefined) {
    rows.push(rateRow('http_req_failed', 'rate', baseline?.metrics.get('http_req_failed')?.values.rate, failed.values.rate, opts.errorRatePp, +1));
  }
  // Checks: lower is worse.
  const checks = current.metrics.get('checks');
  if (checks?.values.rate !== undefined) {
    rows.push(rateRow('checks', 'rate', baseline?.metrics.get('checks')?.values.rate, checks.values.rate, opts.checksDropPp, -1));
  }

  // One reason per metric, so p(95) and p(99) of the same metric share a line.
  const regressed = rows.filter((r) => r.status === 'regressed');
  for (const metric of new Set(regressed.map((r) => r.metric))) {
    reasons.push(describeRegression(metric, regressed.filter((r) => r.metric === metric)));
  }

  // The load test's own thresholds.
  const failedThresholds = [];
  for (const m of current.metrics.values()) {
    for (const t of m.thresholds) if (!t.ok) failedThresholds.push({ metric: m.name, expr: t.expr });
  }
  if (failedThresholds.length && opts.failOnThresholds) {
    for (const t of failedThresholds) reasons.push(`Threshold failed: \`${t.metric}\` \`${t.expr}\``);
  }
  if (baseline) notes.push(...thresholdChanges(baseline, current));

  if (baseline && current.durationMs && baseline.durationMs) {
    const ratio = current.durationMs / baseline.durationMs;
    if (ratio > 1.25 || ratio < 0.8) {
      notes.push(`Test duration changed from ${fmtSeconds(baseline.durationMs)} to ${fmtSeconds(current.durationMs)}, so the runs may not be comparable.`);
    }
  }

  const verdict = reasons.length ? 'fail' : 'pass';
  if (opts.savingBaseline) {
    notes.unshift(verdict === 'pass'
      ? 'This run passed, so it is saved as the new baseline for pull requests.'
      : 'This run did not pass, so the previous baseline is kept.');
  }

  return {
    verdict,
    hasBaseline: Boolean(baseline),
    regressions: regressed.length,
    reasons,
    notes,
    rows,
    failedThresholds,
    options: opts,
  };
}

function trendNames(current, baseline, bases) {
  const names = new Set();
  for (const summary of [current, baseline]) {
    if (!summary) continue;
    for (const m of summary.metrics.values()) {
      if (m.type !== 'trend' || !bases.includes(m.base)) continue;
      const tagString = Object.entries(m.tags).map(([k, v]) => `${k}:${v}`).join(',');
      if (IGNORED_TAGS.includes(tagString)) continue;
      names.add(m.name);
    }
  }
  // Parent metric first, then sub-metrics in a stable order.
  return [...names].sort((a, b) => (a.includes('{') - b.includes('{')) || a.localeCompare(b));
}

function latencyRow(metric, stat, baseline, current, budgetPct, minDeltaMs, isTime) {
  const row = { metric, stat, unit: isTime ? 'ms' : '', baseline: baseline ?? null, current, delta: null, pct: null, budget: budgetPct, status: 'new' };
  if (baseline === undefined) return row;
  row.delta = current - baseline;
  row.pct = baseline === 0 ? (current === 0 ? 0 : Infinity) : (row.delta / baseline) * 100;
  const noticeable = !isTime || Math.abs(row.delta) >= minDeltaMs;
  if (noticeable && row.pct > budgetPct) row.status = 'regressed';
  else if (noticeable && row.pct > budgetPct / 2) row.status = 'worse';
  else if (noticeable && row.pct < -budgetPct) row.status = 'better';
  else row.status = 'ok';
  return row;
}

// direction: +1 when a higher rate is worse (errors), -1 when a lower rate is worse (checks).
function rateRow(metric, stat, baseline, current, budgetPp, direction) {
  const row = { metric, stat, unit: '%', baseline: baseline ?? null, current, delta: null, pct: null, budget: budgetPp, status: 'new' };
  if (baseline === undefined) return row;
  row.delta = (current - baseline) * 100; // percentage points
  const worsening = row.delta * direction;
  if (worsening > budgetPp) row.status = 'regressed';
  else if (worsening > budgetPp / 2) row.status = 'worse';
  else if (worsening < -budgetPp) row.status = 'better';
  else row.status = 'ok';
  return row;
}

// "`http_req_duration` p(95) 29.3 ms → 69.5 ms (+137.0%), p(99) 29.9 ms → 70.3 ms (+135.2%)"
function describeRegression(metric, rows) {
  const parts = rows.map((row) => {
    if (row.unit === '%') {
      const pp = `${row.delta > 0 ? '+' : '−'}${Math.abs(row.delta).toFixed(2)}pp`;
      return `${row.stat} ${fmtPct(row.baseline)} → ${fmtPct(row.current)} (${pp})`;
    }
    const fmt = row.unit === 'ms' ? fmtMs : fmtNumber;
    const pct = Number.isFinite(row.pct) ? `+${row.pct.toFixed(1)}%` : 'up from 0';
    return `${row.stat} ${fmt(row.baseline)} → ${fmt(row.current)} (${pct})`;
  });
  return `\`${metric}\` ${parts.join(', ')}`;
}

function thresholdChanges(baseline, current) {
  const notes = [];
  const names = new Set([...baseline.metrics.keys(), ...current.metrics.keys()]);
  for (const name of names) {
    const before = (baseline.metrics.get(name)?.thresholds ?? []).map((t) => t.expr);
    const after = (current.metrics.get(name)?.thresholds ?? []).map((t) => t.expr);
    const added = after.filter((e) => !before.includes(e));
    const removed = before.filter((e) => !after.includes(e));
    if (!added.length && !removed.length) continue;
    const parts = [];
    if (removed.length) parts.push(`removed ${removed.map((e) => `\`${e}\``).join(', ')}`);
    if (added.length) parts.push(`added ${added.map((e) => `\`${e}\``).join(', ')}`);
    notes.push(`Thresholds changed on \`${name}\`: ${parts.join('; ')}.`);
  }
  return notes;
}

export function fmtMs(ms) {
  if (ms === null || ms === undefined) return '–';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`;
}

export function fmtNumber(n) {
  if (n === null || n === undefined) return '–';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function fmtPct(rate) {
  if (rate === null || rate === undefined) return '–';
  return `${(rate * 100).toFixed(2)}%`;
}

function fmtSeconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}
