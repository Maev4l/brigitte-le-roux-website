// Synthesizes a GitHub-shaped /user response from the JWT email claim.
// Sveltia probes <api_root>/user right after OAuth completes to identify
// the editor; its UI displays the returned name + avatar. We don't have a
// real GitHub identity for the editor (the editor authenticates via
// Cognito, not GitHub), so we return a stable synthetic user built from
// what the JWT tells us.
//
// Fields chosen to match the minimum shape Sveltia consumes — login,
// name, email, avatar_url, id, type. id = 1 is arbitrary but stable.

export const buildSyntheticUser = (email) => {
  if (typeof email !== 'string' || email.length === 0) {
    return null;
  }
  const localPart = email.split('@')[0];
  return {
    login: email,
    name: localPart,
    email,
    avatar_url: null,
    id: 1,
    type: 'User',
    site_admin: false,
  };
};

// True iff this is the request Sveltia uses to identify the authenticated
// editor immediately after OAuth completes. We match only GET /user and
// nothing nested (e.g. /user/repos still goes through Octokit upstream).
export const isUserIdentityRequest = (method, githubPath) => {
  return method === 'GET' && githubPath === '/user';
};

// True iff this is Sveltia's repo-access probe:
//   GET /repos/{owner}/{repo}/collaborators/{username}
// GitHub's real endpoint returns 204 when the user IS a collaborator and
// 404 otherwise. Our synthetic /user response's `login` is the JWT email
// (not a real GitHub username), so GitHub always 404s and Sveltia tells
// the editor they don't have access. We intercept and return 204 because
// the JWT itself is our authorization layer — anyone holding a valid
// Cognito JWT for this pool is implicitly a collaborator.
const COLLABORATOR_PATH_PATTERN = /^\/repos\/[^/]+\/[^/]+\/collaborators\/[^/]+$/;

export const isCollaboratorCheckRequest = (method, githubPath) => {
  return method === 'GET' && COLLABORATOR_PATH_PATTERN.test(githubPath);
};
