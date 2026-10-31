#!/usr/bin/env node
// p95guard: compare a load test's JSON summary with a baseline and print a pass/fail Markdown report.
// Exit codes: 0 = pass, 1 = regression, 2 = bad input or usage.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { normalizeSummary, SummaryError } from './parse.js';
import { compare, DEFAULTS } from './compare.js';
import { markerFor, NAME_PATTERN, renderMarkdown } from './report.js';
import { prNumberFromEvent, upsertPrComment } from './github.js';

const HELP = `Usage: p95guard --current <summary.json> [--baseline <summary.json>] [options]

Reads load test JSON summaries (from --summary-export or handleSummary) and fails when
latency or error rate got worse than the budget allows.

Input
  --current <file>        Summary of this run (required)
  --baseline <file>       Summary of the last good run. A missing file means "no baseline yet".
  --metric <name>         Trend metric to compare, repeatable (default: http_req_duration)

Budgets
  --p95 <pct>             Max p(95) increase in percent (default: ${DEFAULTS.p95Pct})
  --p99 <pct>             Max p(99) increase in percent (default: ${DEFAULTS.p99Pct})
  --min-delta-ms <ms>     Ignore latency changes smaller than this (default: ${DEFAULTS.minDeltaMs})
  --error-rate <pp>       Max http_req_failed increase in percentage points (default: ${DEFAULTS.errorRatePp})
  --checks <pp>           Max drop of the checks pass rate in percentage points (default: ${DEFAULTS.checksDropPp})
  --ignore-thresholds     Don't fail when the load test's own thresholds failed
  --allow-empty           Don't fail when the run made no requests

Output
  --markdown <file>       Also write the report to a file
  --json <file>           Write the full comparison result as JSON
  --comment               Post or update a PR comment (needs GITHUB_TOKEN, runs inside GitHub Actions)
  --name <id>             Test name, when one repo runs several load tests. Each name gets its own
                          PR comment. Letters, digits, ".", "_" and "-" only.
  --title <text>          Report heading (default: "p95 Guard", plus the name if given)
  --baseline-label <text> Says what the baseline is, e.g. "the last good run on main (abc1234)"
  --saving-baseline       This run is a candidate baseline (default branch), not a PR to compare
  --warn-only             Always exit 0, even on a regression
  --quiet                 Don't print the report to stdout
  -h, --help              Show this help
`;

export async function main(argv = process.argv.slice(2), env = process.env, out = process.stdout, err = process.stderr) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        current: { type: 'string' },
        baseline: { type: 'string' },
        metric: { type: 'string', multiple: true },
        p95: { type: 'string' },
        p99: { type: 'string' },
        'min-delta-ms': { type: 'string' },
        'error-rate': { type: 'string' },
        checks: { type: 'string' },
        'ignore-thresholds': { type: 'boolean', default: false },
        'allow-empty': { type: 'boolean', default: false },
        markdown: { type: 'string' },
        json: { type: 'string' },
        comment: { type: 'boolean', default: false },
        name: { type: 'string' },
        title: { type: 'string' },
        'baseline-label': { type: 'string' },
        'saving-baseline': { type: 'boolean', default: false },
        'warn-only': { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }).values;
  } catch (e) {
    err.write(`${e.message}\n\n${HELP}`);
    return 2;
  }
  if (args.help) {
    out.write(HELP);
    return 0;
  }
  if (!args.current) {
    err.write(`--current is required\n\n${HELP}`);
    return 2;
  }
  if (args.name !== undefined && !NAME_PATTERN.test(args.name)) {
    err.write(`p95guard: --name may only use letters, digits, ".", "_" and "-" (max 64), got "${args.name}"\n`);
    return 2;
  }

  let options, current, baseline;
  try {
    options = {
      ...(args.metric && { trendMetrics: args.metric }),
      ...number('p95', args.p95, 'p95Pct'),
      ...number('p99', args.p99, 'p99Pct'),
      ...number('min-delta-ms', args['min-delta-ms'], 'minDeltaMs'),
      ...number('error-rate', args['error-rate'], 'errorRatePp'),
      ...number('checks', args.checks, 'checksDropPp'),
      failOnThresholds: !args['ignore-thresholds'],
      failOnEmpty: !args['allow-empty'],
      savingBaseline: args['saving-baseline'],
    };
    current = loadSummary(args.current);
    baseline = args.baseline && existsSync(args.baseline) ? loadSummary(args.baseline) : null;
  } catch (e) {
    err.write(`p95guard: ${e.message}\n`);
    return 2;
  }

  const result = compare(current, baseline, options);
  const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined;
  const markdown = renderMarkdown(result, { name: args.name, title: args.title, baselineLabel: args['baseline-label'], runUrl });

  if (!args.quiet) out.write(markdown);
  if (args.markdown) writeFileSync(args.markdown, markdown);
  if (args.json) writeFileSync(args.json, JSON.stringify(result, null, 2));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  if (env.GITHUB_OUTPUT) {
    const outputs = { verdict: result.verdict, 'baseline-found': result.hasBaseline, regressions: result.regressions };
    if (args.markdown) outputs.report = args.markdown;
    appendFileSync(env.GITHUB_OUTPUT, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(''));
  }

  if (args.comment) await postComment(markdown, markerFor(args.name), env, err);

  if (result.verdict === 'fail' && !args['warn-only']) return 1;
  return 0;
}

async function postComment(body, marker, env, err) {
  const prNumber = prNumberFromEvent(env.GITHUB_EVENT_PATH);
  if (!prNumber) {
    err.write('p95guard: not a pull_request event, skipping the PR comment.\n');
    return;
  }
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) {
    err.write('::warning::p95guard: GITHUB_TOKEN or GITHUB_REPOSITORY missing, skipping the PR comment.\n');
    return;
  }
  try {
    const url = await upsertPrComment({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, prNumber, body, marker, apiUrl: env.GITHUB_API_URL });
    err.write(`p95guard: PR comment at ${url}\n`);
  } catch (e) {
    // Fork PRs get a read-only token. The report is still in the job summary, so don't fail the job over it.
    err.write(`::warning::p95guard: could not post the PR comment (${e.message}). The report is in the job summary.\n`);
  }
}

function loadSummary(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`cannot read ${path}`);
  }
  if (!text.trim()) throw new SummaryError(`${path} is empty. Did the load test finish and write its summary?`);
  try {
    return normalizeSummary(JSON.parse(text));
  } catch (e) {
    throw new SummaryError(`${path}: ${e instanceof SyntaxError ? 'invalid JSON' : e.message}`);
  }
}

function number(flag, raw, key) {
  if (raw === undefined) return {};
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${flag} must be a non-negative number, got "${raw}"`);
  return { [key]: n };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main();
}
