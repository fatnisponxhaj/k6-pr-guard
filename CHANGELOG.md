# Changelog

All notable changes are listed here. The project follows [semantic versioning](https://semver.org): `@v0` always points to the newest `v0.x.y` release.

## [0.2.0] - unreleased

### Added
- `name` input: run several k6 tests in one repo. Each name gets its own baseline and its own PR comment.
- `metrics` input: compare custom trend metrics, not only `http_req_duration`.
- `baseline` input: compare with a baseline file you keep yourself, instead of the cached last good run.
- Outputs `regressions`, `baseline-found`, `report` (path to the Markdown report) and `mode`.
- The comment says which baseline was used, e.g. "the last good run on `main` (4c74ff0)".
- On the default branch, the job summary says whether the run became the new baseline.
- CLI flags `--name`, `--baseline-label` and `--saving-baseline`.

### Changed
- "Why it failed" lists one line per metric (p95 and p99 together), so the comment stays short.
- `mode` and `name` are validated; invalid values fail with a clear error.

### Fixed
- `npm test` on Node 22 and newer.

Upgrading from 0.1: nothing to change. Unnamed tests keep the same baseline and PR comment.

## [0.1.0] - 2026-10-31

First release: PR comment with p95/p99, error rate, checks and k6 thresholds, baseline in the Actions cache, CLI.

[0.2.0]: https://github.com/fatnisponxhaj/k6-pr-guard/compare/v0.1.0...main
[0.1.0]: https://github.com/fatnisponxhaj/k6-pr-guard/releases/tag/v0.1.0
