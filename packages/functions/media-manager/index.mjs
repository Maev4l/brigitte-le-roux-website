// Hono server bridging API Gateway events (via AWS Lambda Web Adapter)
// to a standard HTTP handler on :8080. Cold start reads the IAM user's
// access key + secret from SSM SecureString, caches them in module
// scope, and serves them via GET /api/media/s3-credentials. The route
// is gated by API Gateway's JWT authorizer (Cognito) before requests
// reach this server — any authenticated CMS user can fetch the creds.

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

let cachedCreds = null;

const loadCreds = async () => {
  if (cachedCreds) return cachedCreds;
  const result = await ssm.send(
    new GetParameterCommand({
      Name: process.env.MEDIA_MANAGER_CREDENTIALS_PARAM,
      WithDecryption: true,
    }),
  );
  cachedCreds = JSON.parse(result.Parameter.Value);
  return cachedCreds;
};

const app = new Hono();

app.get('/api/media/s3-credentials', async (c) => {
  try {
    const creds = await loadCreds();
    console.log(JSON.stringify({ event: 's3-credentials-issued' }));
    return c.json(creds);
  } catch (err) {
    console.error('media-manager error', { message: err.message });
    return c.json({ error: 'Failed to load credentials' }, 502);
  }
});

const port = Number.parseInt(process.env.PORT || '8080', 10);
serve({ fetch: app.fetch, port });
console.log(`media-manager listening on :${port}`);
