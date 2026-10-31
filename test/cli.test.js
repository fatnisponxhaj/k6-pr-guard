import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { upsertPrComment } from '../src/github.js';
import { MARKER } from '../src/report.js';
import { fixturePath } from './helpers.js';

function sink() {
  let text = '';
  return { write: (s) => (text += s), get text() { return text; } };
}
const run = async (argv, env = {}) => {
  const out = sink();
  const err = sink();
  const code = await main(argv, env, out, err);
  return { code, out: out.text, err: err.text };
};
const tmp = () => mkdtempSync(join(tmpdir(), 'k6-pr-guard-'));

test('exit 0 on pass, 1 on regression', async () => {
  const base = fixturePath('baseline.handle-summary.json');
  assert.equal((await run(['--current', base, '--baseline', base])).code, 0);
  const r = await run(['--current', fixturePath('regressed.handle-summary.json'), '--baseline', base]);
  assert.equal(r.code, 1);
  assert.match(r.out, /performance regression/);
});

test('--warn-only never fails', async () => {
  const r = await run(['--current', fixturePath('regressed.summary-export.json'), '--baseline', fixturePath('baseline.summary-export.json'), '--warn-only']);
  assert.equal(r.code, 0);
});

test('budgets from flags are applied', async () => {
  const r = await run(['--current', fixturePath('regressed.summary-export.json'), '--baseline', fixturePath('baseline.summary-export.json'),
    '--p95', '500', '--p99', '500', '--error-rate', '5', '--checks', '5']);
  assert.equal(r.code, 0);
});

test('missing baseline file means "no baseline", not an error', async () => {
  const r = await run(['--current', fixturePath('baseline.summary-export.json'), '--baseline', '/nope/missing.json']);
  assert.equal(r.code, 0);
  assert.match(r.out, /No baseline/);
});

test('bad input exits 2 with a clear message', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'empty.json'), '');
  writeFileSync(join(dir, 'bad.json'), '{oops');
  writeFileSync(join(dir, 'other.json'), '{"hello": 1}');
  assert.match((await run(['--current', join(dir, 'empty.json')])).err, /is empty/);
  assert.match((await run(['--current', join(dir, 'bad.json')])).err, /invalid JSON/);
  assert.match((await run(['--current', join(dir, 'other.json')])).err, /not a k6 summary/);
  assert.match((await run(['--current', join(dir, 'missing.json')])).err, /cannot read/);
  assert.equal((await run([])).code, 2);
  assert.equal((await run(['--current', join(dir, 'bad.json')])).code, 2);
  assert.equal((await run(['--current', fixturePath('baseline.summary-export.json'), '--p95', 'ten'])).code, 2);
  assert.equal((await run(['--bogus'])).code, 2);
});

test('writes markdown, json, step summary and output files', async () => {
  const dir = tmp();
  const env = { GITHUB_STEP_SUMMARY: join(dir, 'summary.md'), GITHUB_OUTPUT: join(dir, 'output') };
  await run(['--current', fixturePath('regressed.handle-summary.json'), '--baseline', fixturePath('baseline.handle-summary.json'),
    '--markdown', join(dir, 'r.md'), '--json', join(dir, 'r.json'), '--quiet'], env);
  assert.ok(readFileSync(join(dir, 'r.md'), 'utf8').startsWith(MARKER));
  assert.equal(JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8')).verdict, 'fail');
  assert.ok(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8').includes('performance regression'));
  assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), `verdict=fail\nbaseline-found=true\nregressions=8\nreport=${join(dir, 'r.md')}\n`);
});

test('--comment outside a pull request is skipped, not an error', async () => {
  const r = await run(['--current', fixturePath('baseline.handle-summary.json'), '--comment', '--quiet'], {});
  assert.equal(r.code, 0);
  assert.match(r.err, /not a pull_request event/);
});

test('a failing comment API warns but keeps the verdict', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'event.json'), JSON.stringify({ pull_request: { number: 7 } }));
  const env = { GITHUB_EVENT_PATH: join(dir, 'event.json'), GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', GITHUB_API_URL: 'http://127.0.0.1:9' };
  const r = await run(['--current', fixturePath('baseline.handle-summary.json'), '--comment', '--quiet'], env);
  assert.equal(r.code, 0);
  assert.match(r.err, /::warning::.*could not post the PR comment/);
});

function fakeGitHub(pages) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ method: init.method, url, body: init.body && JSON.parse(init.body) });
    const page = Number(new URL(url).searchParams.get('page') ?? 1);
    const json = init.method === 'GET' ? pages[page - 1] ?? [] : { html_url: 'https://github.test/c/1' };
    return { ok: true, json: async () => json, text: async () => '' };
  };
  return { calls, fetchImpl };
}

test('creates a new PR comment when none exists', async () => {
  const gh = fakeGitHub([[{ id: 1, body: 'unrelated' }]]);
  await upsertPrComment({ token: 't', repo: 'o/r', prNumber: 5, body: `${MARKER}\nhi`, apiUrl: 'https://api', fetchImpl: gh.fetchImpl });
  assert.deepEqual(gh.calls.map((c) => `${c.method} ${c.url}`), [
    'GET https://api/repos/o/r/issues/5/comments?per_page=100&page=1',
    'POST https://api/repos/o/r/issues/5/comments',
  ]);
});

test('updates our earlier comment, even on page 2', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i, body: 'chatter' }));
  const gh = fakeGitHub([page1, [{ id: 999, body: `${MARKER}\nold` }]]);
  await upsertPrComment({ token: 't', repo: 'o/r', prNumber: 5, body: `${MARKER}\nnew`, apiUrl: 'https://api', fetchImpl: gh.fetchImpl });
  const last = gh.calls.at(-1);
  assert.equal(`${last.method} ${last.url}`, 'PATCH https://api/repos/o/r/issues/comments/999');
  assert.equal(last.body.body, `${MARKER}\nnew`);
});

test('--name changes the marker and heading; bad names exit 2', async () => {
  const r = await run(['--current', fixturePath('baseline.handle-summary.json'), '--name', 'api']);
  assert.equal(r.code, 0);
  assert.ok(r.out.startsWith('<!-- k6-pr-guard:api -->'));
  assert.match(r.out, /k6 PR Guard · api/);
  const bad = await run(['--current', fixturePath('baseline.handle-summary.json'), '--name', 'x -->']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /--name may only use/);
});

test('--baseline-label and --saving-baseline show up in the report', async () => {
  const base = fixturePath('baseline.handle-summary.json');
  const label = await run(['--current', base, '--baseline', base, '--baseline-label', 'the last good run on `main` (abc1234)']);
  assert.match(label.out, /Compared with the last good run on `main` \(abc1234\)\./);
  const saving = await run(['--current', base, '--saving-baseline']);
  assert.match(saving.out, /saved as the new baseline/);
});

test('without a baseline, outputs say so', async () => {
  const dir = tmp();
  const env = { GITHUB_OUTPUT: join(dir, 'output') };
  await run(['--current', fixturePath('baseline.handle-summary.json'), '--quiet'], env);
  assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), 'verdict=pass\nbaseline-found=false\nregressions=0\n');
});

test('a named comment ignores the unnamed one and vice versa', async () => {
  const gh = fakeGitHub([[{ id: 1, body: `${MARKER}\nunnamed` }, { id: 2, body: '<!-- k6-pr-guard:api -->\nnamed' }]]);
  const opts = { token: 't', repo: 'o/r', prNumber: 5, apiUrl: 'https://api', fetchImpl: gh.fetchImpl };
  await upsertPrComment({ ...opts, body: 'x', marker: '<!-- k6-pr-guard:api -->' });
  assert.equal(gh.calls.at(-1).url, 'https://api/repos/o/r/issues/comments/2');
  await upsertPrComment({ ...opts, body: 'y' });
  assert.equal(gh.calls.at(-1).url, 'https://api/repos/o/r/issues/comments/1');
  await upsertPrComment({ ...opts, body: 'z', marker: '<!-- k6-pr-guard:web -->' });
  assert.equal(gh.calls.at(-1).method, 'POST');
});
