// Lambda handler: Cognito-authenticated proxy from Sveltia to api.github.com.
//
// Inbound event (API Gateway HTTP API v2 payload):
//   - event.rawPath:                              "/api/git/repos/owner/repo/contents/..."
//   - event.requestContext.http.method:           "PUT" | "POST" | "GET" | "DELETE" | "PATCH"
//   - event.requestContext.authorizer.jwt.claims: { email, sub, ... }  (Cognito-issued)
//   - event.body:                                 JSON string (when present)
//
// Flow: strip /api/git → repo allowlist → path allowlist → commit-author
// rewrite → Octokit forward → response back.

import {
  findForbiddenPath,
  extractPathsFromContentsApi,
  extractPathsFromTreeBody,
} from './lib/allowlist.mjs';
import { injectCommitAuthor } from './lib/commit-author.mjs';
import { getOctokit } from './lib/octokit.mjs';

const ALLOWED_REPO = process.env.ALLOWED_REPO; // e.g. "Maev4l/brigitte-le-roux-website"

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const stripApiPrefix = (rawPath) => rawPath.replace(/^\/api\/git/, '');

// Allowed shape: /repos/<owner>/<repo>/...
const isAllowedRepo = (githubPath) => {
  const match = githubPath.match(/^\/repos\/([^/]+\/[^/]+)\b/);
  if (!match) return false;
  return match[1] === ALLOWED_REPO;
};

// Decide whether a request creates or modifies content (requires
// allowlist check and, for the Contents API, commit-author injection).
const isContentMutatingRequest = (method, githubPath) => {
  if (method === 'GET' || method === 'HEAD') return false;
  if (/^\/repos\/[^/]+\/[^/]+\/contents\//.test(githubPath)) return true;
  if (/^\/repos\/[^/]+\/[^/]+\/git\/trees$/.test(githubPath) && method === 'POST') return true;
  return false;
};

export const handler = async (event) => {
  try {
    const claims = event.requestContext?.authorizer?.jwt?.claims;
    if (!claims?.email) {
      return json(401, { error: 'Missing email claim in JWT' });
    }

    const method = event.requestContext.http.method;
    const githubPath = stripApiPrefix(event.rawPath);

    if (!isAllowedRepo(githubPath)) {
      return json(403, { error: 'Repo not in allowlist', path: githubPath });
    }

    const requestBody = event.body ? JSON.parse(event.body) : null;

    if (isContentMutatingRequest(method, githubPath)) {
      let paths;
      if (/\/contents\//.test(githubPath)) {
        paths = extractPathsFromContentsApi(githubPath);
      } else if (/\/git\/trees$/.test(githubPath) && requestBody) {
        paths = extractPathsFromTreeBody(requestBody);
      } else {
        paths = [];
      }
      const forbidden = findForbiddenPath(paths);
      if (forbidden) {
        return json(403, { error: 'Path not in allowlist', path: forbidden });
      }
    }

    let finalBody = requestBody;
    if (/\/contents\//.test(githubPath) && (method === 'PUT' || method === 'DELETE') && requestBody) {
      finalBody = injectCommitAuthor(requestBody, claims.email);
    }

    const octokit = await getOctokit();
    const response = await octokit.request({
      method,
      url: githubPath,
      data: finalBody,
      headers: { accept: 'application/vnd.github+json' },
    });

    return {
      statusCode: response.status,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(response.data),
    };
  } catch (err) {
    if (err.status && err.response?.data) {
      return {
        statusCode: err.status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(err.response.data),
      };
    }
    console.error('github-gateway error', err);
    return json(502, { error: 'Upstream error', message: err.message });
  }
};
