# Security policy

Please don't report security problems in public issues.

Use **Security → Report a vulnerability** on this repository instead. You'll get an answer within 7 days.

## What the action can access

- It reads the load test's JSON summary and the baseline from the GitHub Actions cache.
- With `comment: true` it uses the job's `GITHUB_TOKEN` to create or update one comment on the pull request. It needs `pull-requests: write` and nothing else.
- It has no dependencies. Without `api-key` it sends data only to the GitHub API of the repository it runs in.
- With `api-key` set, it also sends the run's numbers (metric names and values, repository, branch, commit, PR number, run link) to the p95 Guard Pro API over HTTPS. The key is masked in logs. Store it as a secret.

To limit what any action can do, pin it to a full commit SHA instead of `@v0`.
