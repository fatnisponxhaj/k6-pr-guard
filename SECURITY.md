# Security policy

Please don't report security problems in public issues.

Use **Security → Report a vulnerability** on this repository instead. You'll get an answer within 7 days.

## What the action can access

- It reads the k6 summary file and the baseline from the GitHub Actions cache.
- With `comment: true` it uses the job's `GITHUB_TOKEN` to create or update one comment on the pull request. It needs `pull-requests: write` and nothing else.
- It has no dependencies and sends data only to the GitHub API of the repository it runs in.

To limit what any action can do, pin it to a full commit SHA instead of `@v0`.
