// Path allowlist enforcement. Commits that touch any path outside these
// prefixes are rejected at this gateway, even if the GitHub App's
// permissions would technically allow them. Defense in depth: limits the
// blast radius of a compromised Cognito session.

const ALLOWED_PATH_PREFIXES = ['packages/website/content/'];

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
