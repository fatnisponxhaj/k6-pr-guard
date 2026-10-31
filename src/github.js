// Minimal GitHub REST calls, using the fetch built into Node 20 (no dependencies).

import { readFileSync } from 'node:fs';
import { MARKER } from './report.js';

/**
 * Reads the PR number from the Actions event payload, or null outside a pull_request event.
 * The path is always passed in (no process.env fallback), so callers control which environment is used.
 */
export function prNumberFromEvent(eventPath) {
  if (!eventPath) return null;
  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    return event.pull_request?.number ?? null;
  } catch {
    return null;
  }
}

/** Creates the PR comment, or updates the one we posted before. Returns its URL. */
export async function upsertPrComment({ token, repo, prNumber, body, marker = MARKER, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
    'user-agent': 'k6-pr-guard',
  };
  const call = async (method, url, payload) => {
    const res = await fetchImpl(url, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
    if (!res.ok) throw new Error(`GitHub API ${method} ${url} failed: ${res.status} ${await res.text()}`);
    return res.json();
  };

  let existing = null;
  for (let page = 1; !existing; page++) {
    const comments = await call('GET', `${apiUrl}/repos/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`);
    existing = comments.find((c) => typeof c.body === 'string' && c.body.includes(marker)) ?? null;
    if (comments.length < 100) break;
  }

  const comment = existing
    ? await call('PATCH', `${apiUrl}/repos/${repo}/issues/comments/${existing.id}`, { body })
    : await call('POST', `${apiUrl}/repos/${repo}/issues/${prNumber}/comments`, { body });
  return comment.html_url;
}
