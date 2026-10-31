# Contributing

Thanks for helping. Issues with a real-world example (your workflow and the JSON summary, with private data removed) are the most useful thing you can send.

## Setup

Node 20 or newer. There are no dependencies to install.

```bash
npm test       # all tests
npm run demo   # report for a recorded regression
```

## Layout

| Path | What it does |
|---|---|
| `src/parse.js` | Reads both JSON summary formats into one shape |
| `src/compare.js` | Budgets, regressions, notes, verdict |
| `src/report.js` | The Markdown PR comment |
| `src/github.js` | Creates or updates the PR comment |
| `src/cli.js` | Command line, files and GitHub Actions outputs |
| `action.yml` | The composite action: picks the mode, restores or saves the baseline, runs the CLI |
| `test/fixtures/` | Real summaries recorded against `examples/demo-server.js` |

## Recording new fixtures

1. Start the demo server: `DELAY_MS=20 node examples/demo-server.js &`
2. Run `examples/load-test.js` against it with `SUMMARY_FILE=test/fixtures/NAME.handle-summary.json` and `--summary-export=test/fixtures/NAME.summary-export.json`, so the same run is saved in both formats. CI shows the exact command.
3. Stop the server: `kill %1`

`DELAY_MS`, `JITTER_MS` and `ERROR_RATE` control the demo server.

## Pull requests

- Keep the action dependency-free.
- Add a test for every behaviour change, and update the README and CHANGELOG when inputs or output change.
- CI runs the unit tests on Node 20, 22 and 24, the action end to end, and a regression check with a real load test.

## Releasing (maintainers)

1. Set the version in `package.json` and move the CHANGELOG entry from "unreleased" to today's date.
2. Merge to `main` and wait for CI to pass.
3. Draft a release on GitHub with a new tag `vX.Y.Z` on `main`, tick "Publish this release to the GitHub Marketplace", and publish.
4. The Release workflow moves the major tag (`v0`) to the new release. It fails if the tag and `package.json` disagree.
