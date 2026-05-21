// Octokit client factory. All GitHub App credentials (app_id,
// installation_id, private_key) come from a single SSM SecureString
// parameter containing JSON. Loaded at module load (Lambda cold start),
// cached for the container lifetime. Octokit's auth-app strategy handles
// JWT minting + 1h installation-token refresh transparently.

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

const ssm = new SSMClient({});

let cachedOctokit = null;

const loadAppSecrets = async () => {
  const result = await ssm.send(
    new GetParameterCommand({
      Name: process.env.GITHUB_APP_SECRETS_PARAM,
      WithDecryption: true,
    }),
  );
  return JSON.parse(result.Parameter.Value);
};

export const getOctokit = async () => {
  if (cachedOctokit) return cachedOctokit;
  const { app_id, installation_id, private_key } = await loadAppSecrets();
  cachedOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: app_id,
      privateKey: private_key,
      installationId: installation_id,
    },
  });
  return cachedOctokit;
};
