// Renders a comparison result as the Markdown PR comment.

import { fmtMs, fmtNumber, fmtPct } from './compare.js';

// Hidden marker used to find and update our own comment instead of posting a new one each push.
export const MARKER = '<!-- k6-pr-guard -->';

const STATUS = {
  regressed: '🔺 regressed',
  worse: '⚠️ slower',
  better: '🟢 better',
  ok: '➖ same',
  new: '🆕 new',
};

export function renderMarkdown(result, { title = 'k6 PR Guard', baselineLabel = 'the last good run on the main branch', runUrl } = {}) {
  const lines = [MARKER];
  const pass = result.verdict === 'pass';
  lines.push(`## ${pass ? '✅' : '❌'} ${title}: ${pass ? 'no performance regression' : 'performance regression'}`);
  lines.push('');
  lines.push(result.hasBaseline ? `Compared with ${baselineLabel}.` : 'No baseline to compare with yet.');
  lines.push('');

  if (!pass) {
    lines.push('**Why it failed**');
    for (const r of result.reasons) lines.push(`- ${r}`);
    lines.push('');
  }

  if (result.rows.length) {
    lines.push('| Metric | Stat | Baseline | This PR | Change | |');
    lines.push('|---|---|---:|---:|---:|---|');
    for (const row of result.rows) {
      lines.push(`| \`${escapePipes(row.metric)}\` | ${row.stat} | ${value(row, row.baseline)} | ${value(row, row.current)} | ${change(row)} | ${STATUS[row.status]} |`);
    }
    lines.push('');
  }

  if (result.notes.length) {
    lines.push(`<details><summary>Notes (${result.notes.length})</summary>`);
    lines.push('');
    for (const n of result.notes) lines.push(`- ${n}`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  const o = result.options;
  const budget = `Budgets: p95 +${o.p95Pct}%, p99 +${o.p99Pct}%, error rate +${o.errorRatePp}pp, checks −${o.checksDropPp}pp; latency changes under ${o.minDeltaMs} ms are ignored.`;
  lines.push(`<sub>${budget}${runUrl ? ` · [Workflow run](${runUrl})` : ''}</sub>`);
  return lines.join('\n') + '\n';
}

function value(row, v) {
  if (row.unit === '%') return fmtPct(v);
  if (row.unit === 'ms') return fmtMs(v);
  return fmtNumber(v);
}

function change(row) {
  if (row.delta === null) return '–';
  if (row.unit === '%') return `${sign(row.delta)}${Math.abs(row.delta).toFixed(2)}pp`;
  const abs = row.unit === 'ms' ? `${sign(row.delta)}${fmtMs(Math.abs(row.delta))}` : `${sign(row.delta)}${fmtNumber(Math.abs(row.delta))}`;
  const pct = Number.isFinite(row.pct) ? ` (${sign(row.pct)}${Math.abs(row.pct).toFixed(1)}%)` : '';
  return abs + pct;
}

// Values that round to zero get "±" so the table never shows "−0.0 ms".
function sign(n) {
  return n >= 0.05 ? '+' : n <= -0.05 ? '−' : '±';
}

function escapePipes(s) {
  return s.replaceAll('|', '\\|');
}
