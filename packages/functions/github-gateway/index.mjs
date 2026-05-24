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
import {
  buildSyntheticUser,
  isCollaboratorCheckRequest,
  isUserIdentityRequest,
} from './lib/user-interceptor.mjs';

const ALLOWED_REPO = process.env.ALLOWED_REPO; // e.g. "Maev4l/brigitte-le-roux-website"

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// Sveltia treats any non-api.github.com URL as GitHub Enterprise and
// prepends `/api/v3` to REST calls (and `/api/graphql` to GraphQL ones).
// Our api_root is `https://cms.brigitte-le-roux.com/api/git`, so a Sveltia
// /user call lands here with rawPath `/api/git/api/v3/user`. Strip both
// prefixes — first our public proxy path, then the Enterprise-style
// version segment — to leave the canonical GitHub-API path the rest of
// this handler reasons about.
const stripApiPrefix = (rawPath) =>
  rawPath.replace(/^\/api\/git/, '').replace(/^\/api\/v3/, '');

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

// Sveltia's normalizeGraphQLBaseURL appends /api/graphql to the api_root
// for Enterprise-style backends. After stripApiPrefix the path lands as
// `/api/graphql`. Also accept the bare `/graphql` form for forward
// compatibility.
const isGraphQLRequest = (method, githubPath) =>
  method === 'POST' && (githubPath === '/api/graphql' || githubPath === '/graphql');

export const handler = async (event) => {
  try {
    const claims = event.requestContext?.authorizer?.jwt?.claims;
    if (!claims?.email) {
      return json(401, { error: 'Missing email claim in JWT' });
    }

    const method = event.requestContext.http.method;
    const githubPath = stripApiPrefix(event.rawPath);

    // Sveltia probes /user immediately after OAuth to identify the editor.
    // The Bearer is a Cognito JWT (not a GitHub PAT), so api.github.com
    // would 401. Return a synthetic user built from the JWT email claim.
    if (isUserIdentityRequest(method, githubPath)) {
      const syntheticUser = buildSyntheticUser(claims.email);
      if (!syntheticUser) {
        return json(401, { error: 'Cannot synthesize user — invalid email claim' });
      }
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(syntheticUser),
      };
    }

    // Sveltia issues GraphQL queries against /api/graphql. Forward them to
    // GitHub's GraphQL endpoint via Octokit (authenticated with the
    // installation token; the GitHub App's permissions limit blast radius
    // because it can only see our single repo). Skip isAllowedRepo for
    // this path — repo scoping is enforced at the App-installation layer.
    if (isGraphQLRequest(method, githubPath)) {
      let parsed;
      try {
        parsed = event.body ? JSON.parse(event.body) : null;
      } catch {
        return json(400, { error: 'Invalid JSON body for GraphQL request' });
      }
      if (!parsed || typeof parsed.query !== 'string') {
        return json(400, { error: 'GraphQL request missing query' });
      }
      const octokit = await getOctokit();
      try {
        const data = await octokit.graphql(parsed.query, parsed.variables || {});
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data }),
        };
      } catch (err) {
        // GraphqlResponseError exposes `.errors` and `.data` (partial result).
        if (err.errors) {
          return {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data: err.data ?? null, errors: err.errors }),
          };
        }
        throw err;
      }
    }

    if (!isAllowedRepo(githubPath)) {
      return json(403, { error: 'Repo not in allowlist', path: githubPath });
    }

    // Sveltia verifies repo write access via GET /repos/{o}/{r}/collaborators/{login}
    // where {login} is the synthetic user.login (the JWT email) — not a real
    // GitHub username. GitHub would 404. Return 204 (the "yes, is a
    // collaborator" status) because the JWT authorizer upstream is our
    // authorization layer; reaching this point already means authorized.
    if (isCollaboratorCheckRequest(method, githubPath)) {
      return {
        statusCode: 204,
        headers: { 'content-type': 'application/json' },
        body: '',
      };
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

    // API Gateway HTTP API v2 splits the request URL into rawPath +
    // rawQueryString — Octokit needs both. Without re-appending the
    // query string, calls like /git/trees/<sha>?recursive=1 lose the
    // recursion flag and GitHub returns only the root tree → Sveltia
    // sees no files in nested folders and silently renders "0 entries".
    const finalUrl = event.rawQueryString
      ? `${githubPath}?${event.rawQueryString}`
      : githubPath;

    const octokit = await getOctokit();
    const response = await octokit.request({
      method,
      url: finalUrl,
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
