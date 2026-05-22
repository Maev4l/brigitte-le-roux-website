// Lambda handler: validates the upload request, signs an S3 PUT URL,
// triggers a CloudFront invalidation, returns { uploadUrl, publicPath }.

import {
  validateFolder,
  validateContentType,
  validateFilename,
  validateSize,
} from './lib/validation.mjs';
import { signUploadUrl } from './lib/presigner.mjs';
import { invalidatePath } from './lib/invalidator.mjs';

const BUCKET_NAME = process.env.BUCKET_NAME;
const CLOUDFRONT_DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  try {
    const claims = event.requestContext?.authorizer?.jwt?.claims;
    if (!claims?.email) {
      return json(401, { error: 'Missing email claim in JWT' });
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const { folder, contentType, filename, size } = body;

    const folderResult = validateFolder(folder);
    if (!folderResult.ok) return json(400, { error: folderResult.error });

    const ctResult = validateContentType(contentType);
    if (!ctResult.ok) return json(400, { error: ctResult.error });

    const fnResult = validateFilename(filename);
    if (!fnResult.ok) return json(400, { error: fnResult.error });

    const sizeResult = validateSize(size, ctResult.value);
    if (!sizeResult.ok) return json(400, { error: sizeResult.error });

    const key = `${folderResult.value}/${fnResult.value}`;
    const publicPath = `/${key}`;

    const uploadUrl = await signUploadUrl({
      bucket: BUCKET_NAME,
      key,
      contentType: ctResult.value,
      contentLength: sizeResult.value,
    });

    await invalidatePath({
      distributionId: CLOUDFRONT_DISTRIBUTION_ID,
      path: publicPath,
    });

    // Structured log line — observable in CloudWatch, no file bytes.
    console.log(JSON.stringify({
      event: 'media-upload-signed',
      user: claims.email,
      key,
      contentType: ctResult.value,
      size: sizeResult.value,
    }));

    return json(200, { uploadUrl, publicPath });
  } catch (err) {
    console.error('media-manager error', err);
    return json(502, { error: 'Upstream error', message: err.message });
  }
};
