// Proactively invalidates the CloudFront cache for the path that's about
// to be uploaded. Runs BEFORE the actual PUT — when the upload completes
// a few seconds later, the next viewer request misses cache and fetches
// the fresh object from S3.
//
// Invalidating a path that doesn't exist yet is a no-op; cost stays
// negligible (~$0.005 per invalidation, 1000/month free tier).

import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';

const cf = new CloudFrontClient({});

export const invalidatePath = async ({ distributionId, path }) => {
  await cf.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        // Unique CallerReference so retries don't collide.
        CallerReference: `media-manager-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        Paths: { Quantity: 1, Items: [path] },
      },
    }),
  );
};
