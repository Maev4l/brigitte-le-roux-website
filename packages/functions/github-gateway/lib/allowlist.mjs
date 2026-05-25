// Path allowlist enforcement. Commits that touch any path outside these
// prefixes are rejected at this gateway, even if the GitHub App's
// permissions would technically allow them. Defense in depth: limits the
// blast radius of a compromised Cognito session.
//
// Coverage matrix:
//   - Contents API   (single-file PUT/DELETE) → extractPathsFromContentsApi
//   - Git Trees API  (multi-file commit via tree+commit objects) → extractPathsFromTreeBody
//   - GraphQL        (createCommitOnBranch multi-file commits — what Sveltia
//                     actually uses) → extractPathsFromGraphqlBody
// All three feed findForbiddenPath; any path outside the prefixes below
// causes the gateway to return 403 before the request reaches GitHub.

const ALLOWED_PATH_PREFIXES = [
  'packages/website/content/',
  // Sveltia bundles uploaded binaries into the same createCommitOnBranch
  // mutation as the markdown edit. The S3 PUT is the canonical write
  // (the public site serves from S3), so the git copy is redundant but
  // unavoidable without modifying Sveltia. The GHA deploy --excludes
  // data/* from its S3 sync, so these binaries-in-git never get
  // re-uploaded — they just accumulate harmlessly. Periodic `git rm` of
  // public/data/* artefacts cleans them up.
  'packages/website/public/data/',
];

// Returns null if every supplied path begins with an allowlisted prefix;
// returns the first offending path otherwise.
export const findForbiddenPath = (paths) => {
  for (const path of paths) {
    if (!ALLOWED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return path;
    }
  }
  return null;
};

// Contents API path embeds the file path directly:
//   /repos/{owner}/{repo}/contents/{path}
// Returns the file path as a single-element array, or empty if the
// URL doesn't match (caller treats empty as "no paths to check").
export const extractPathsFromContentsApi = (urlPath) => {
  const match = urlPath.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
  return match ? [match[1]] : [];
};

// Tree API body shape (from Sveltia's multi-file commit flow):
//   POST /repos/{owner}/{repo}/git/trees
//   { tree: [{ path, mode, type, sha }, ...], base_tree: "..." }
export const extractPathsFromTreeBody = (body) => {
  if (!body || !Array.isArray(body.tree)) return [];
  return body.tree.map((entry) => entry.path).filter(Boolean);
};

// GraphQL createCommitOnBranch mutation body shape (what Sveltia uses):
//   { query: "mutation(...) { createCommitOnBranch(input: $input) { ... } }",
//     variables: { input: { branch: {...}, message: {...}, fileChanges: {
//       additions: [{ path: "...", contents: "<base64>" }, ...],
//       deletions: [{ path: "..." }, ...]
//     } } } }
// We only inspect mutations that mention createCommitOnBranch — other
// queries/mutations (auth probes, file reads) don't touch paths and pass
// through unchecked. Returns [] for non-commit operations so the caller
// can skip the allowlist check entirely.
export const extractPathsFromGraphqlBody = (body) => {
  if (!body || typeof body.query !== 'string') return [];
  if (!body.query.includes('createCommitOnBranch')) return [];
  const fileChanges = body.variables?.input?.fileChanges;
  if (!fileChanges) return [];
  const paths = [];
  if (Array.isArray(fileChanges.additions)) {
    for (const a of fileChanges.additions) {
      if (a && typeof a.path === 'string') paths.push(a.path);
    }
  }
  if (Array.isArray(fileChanges.deletions)) {
    for (const d of fileChanges.deletions) {
      if (d && typeof d.path === 'string') paths.push(d.path);
    }
  }
  return paths;
};
