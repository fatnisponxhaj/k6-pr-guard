# Changelog

All notable changes are listed here. The project follows [semantic versioning](https://semver.org): `@v0` always points to the newest `v0.x.y` release.

## [0.4.0] - unreleased

### Added
- `api-key` input: send each run to [p95 Guard Pro](https://p95guard.dev) for trend history, on pull requests and on the default branch. The key is masked in logs. Upload problems are warnings and never fail the job.
- `api-url` input (for testing) and `uploaded` output.
- CLI flags `--upload` (key from `P95GUARD_API_KEY`) and `--api-url`.
- For pull requests, uploads use the PR's head commit and branch, not GitHub's temporary merge commit.

## [0.3.1] - unreleased

### Changed
- Documentation, messages and the PR comment describe load tests in general and no longer name a specific tool.
- The default `summary` path is now `summary.json`. If your workflow relied on the old default file name, set `summary:` explicitly.

## [0.3.0] - 2026-10-31

### Changed
- **New name: p95 Guard** (repository `fatnisponxhaj/p95guard`, CLI `p95guard`). Use `fatnisponxhaj/p95guard@v0` in your workflows.
- The PR comment marker, cache key prefix (`p95guard-baseline`) and cache path (`.p95guard/`) use the new name. The first pull request after upgrading compares against nothing until the default branch has run once.

## [0.2.0] - 2026-10-31

### Added
- `name` input: run several load tests in one repo. Each name gets its own baseline and its own PR comment.
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

First release: PR comment with p95/p99, error rate, checks and the test's own thresholds, baseline in the Actions cache, CLI.

[0.4.0]: https://github.com/fatnisponxhaj/p95guard/compare/v0.3.1...main
[0.3.1]: https://github.com/fatnisponxhaj/p95guard/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/fatnisponxhaj/p95guard/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/fatnisponxhaj/p95guard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/fatnisponxhaj/p95guard/releases/tag/v0.1.0
