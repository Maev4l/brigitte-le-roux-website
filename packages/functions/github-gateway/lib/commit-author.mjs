// Inject the Cognito-authenticated user's email into commit metadata so
// `git log` attributes commits to the actual editor, not the GitHub App.

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Reasonable sanity-check before stamping a value on a commit.
export const validateEmail = (email) => {
  if (typeof email !== 'string') return false;
  if (email.length > 254) return false;
  if (!EMAIL_PATTERN.test(email)) return false;
  return true;
};

// Returns a new body with author + committer set from the JWT email claim.
// GitHub's Contents API accepts these fields on PUT (create/update) and
// DELETE; the name is derived as the local-part of the email.
export const injectCommitAuthor = (body, email) => {
  if (!validateEmail(email)) {
    throw new Error('Invalid email claim from JWT');
  }
  const name = email.split('@')[0];
  return {
    ...body,
    author: { name, email },
    committer: { name, email },
  };
};
