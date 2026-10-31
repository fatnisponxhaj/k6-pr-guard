# k6 PR Guard

Catch performance regressions in pull requests. k6 PR Guard compares each k6 run with the last good run on your main branch and posts the change in p95/p99 latency, error rate and checks as a pass/fail PR comment.

```
## ❌ k6 PR Guard: performance regression

Why it failed
- `http_req_duration` p(95) went from 30.0 ms to 55.0 ms (+83.6%, budget +10%)
- `http_req_failed` rate went from 0.00% to 2.70% (budget +1pp)

| Metric                               | Stat  | Baseline | This PR | Change            |              |
|--------------------------------------|-------|---------:|--------:|------------------:|--------------|
| `http_req_duration`                  | p(95) |  30.0 ms | 55.0 ms | +25.1 ms (+83.6%) | 🔺 regressed |
| `http_req_duration{scenario:browse}` | p(95) |  30.0 ms | 54.9 ms | +24.9 ms (+83.1%) | 🔺 regressed |
| `http_req_failed`                    | rate  |   0.00%  |  2.70%  | +2.70pp           | 🔺 regressed |
```

- Works with both k6 JSON outputs: `--summary-export` and `handleSummary()`.
- Compares per scenario when your test has thresholds on tagged sub-metrics.
- Ignores noise: changes under 5 ms don't count, whatever the percentage.
- Handles real-life mess: empty runs, renamed scenarios, changed thresholds, missing p99, no baseline yet.
- Updates one comment per PR instead of adding a new one on every push.
- No servers, no accounts: the baseline lives in the GitHub Actions cache.

## Use it in GitHub Actions

```yaml
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  k6:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # ...start the service you want to test...
      - uses: grafana/setup-k6-action@v1
      - run: k6 run --summary-export=k6-summary.json tests/load.js
        continue-on-error: true # let the guard report even when a k6 threshold fails
      - uses: fatnisponxhaj/k6-pr-guard@v0
        with:
          summary: k6-summary.json
```

On pushes to `main`, a run that passes its thresholds is saved as the baseline. On pull requests, the run is compared with the baseline of the commit the PR is based on (or the newest one).

### Inputs

| Input | Default | Meaning |
|---|---|---|
| `summary` | `k6-summary.json` | Path to the k6 JSON summary |
| `mode` | `auto` | `auto`, `compare` or `save-baseline` |
| `p95-budget` | `10` | Max p(95) increase, % |
| `p99-budget` | `15` | Max p(99) increase, % |
| `min-delta-ms` | `5` | Ignore latency changes smaller than this |
| `error-rate-budget` | `1` | Max `http_req_failed` increase, percentage points |
| `checks-budget` | `1` | Max drop of the checks pass rate, percentage points |
| `ignore-thresholds` | `false` | Don't fail on k6's own failed thresholds |
| `fail-on-regression` | `true` | `false` = report only |
| `comment` | `true` | Post/update the PR comment |
| `cache-key-prefix` | `k6-pr-guard-baseline` | Change it when one repo runs several k6 tests |

Output: `verdict` (`pass` / `fail`).

### Tips

- p(99) is not in k6's default summary. Add it to your test options:
  `summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)']`
- For per-scenario numbers, add a threshold per scenario, e.g. `'http_req_duration{scenario:checkout}': ['p(95)<800']`. k6 only puts tagged sub-metrics in the summary when a threshold uses them.
- Shared CI runners are noisy. Keep budgets around 10–20% and run the test for at least 30 s.

## Use it as a CLI

```bash
node src/cli.js --current k6-summary.json --baseline last-good.json
```

Exit code 0 = pass, 1 = regression, 2 = bad input. Run `node src/cli.js --help` for all flags.

## Try it locally

```bash
npm test            # unit tests (no dependencies to install)
npm run demo        # report for a recorded regression
```

To record your own runs against the demo server:

```bash
DELAY_MS=20 node examples/demo-server.js &
k6 run -e SUMMARY_FILE=before.json examples/load-test.js
kill %1; DELAY_MS=60 node examples/demo-server.js &
k6 run -e SUMMARY_FILE=after.json examples/load-test.js
node src/cli.js --current after.json --baseline before.json
```

## License

MIT
