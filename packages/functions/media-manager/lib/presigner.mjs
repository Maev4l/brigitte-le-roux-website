// Builds a 5-minute presigned S3 PUT URL bound to the exact ContentType
// + ContentLength the caller declared. S3 rejects PUTs whose headers do
// not match the signed values, so a client cannot upload a different
// type or more bytes than they claimed.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const URL_TTL_SECONDS = 300;

const s3 = new S3Client({});

export const signUploadUrl = async ({ bucket, key, contentType, contentLength }) => {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(s3, command, { expiresIn: URL_TTL_SECONDS });
};
