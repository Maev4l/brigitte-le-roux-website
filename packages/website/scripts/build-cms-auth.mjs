#!/usr/bin/env node
// Bundles the CMS sign-in shim (src/cms-auth/main.js) into
// public/cms/auth/auth.js, where index.html loads it same-origin.
//
// Why a bundle step for one file: Amplify v6 ships no browser-global build,
// so there is no script tag that yields a usable global the way v5's
// amazon-cognito-identity-js did. The output lands in public/ rather than
// dist/ so that `astro dev` and `astro build` serve the identical artifact;
// it is gitignored (the one carve-out inside the tracked public/cms/ tree).
//
// The output path matters: cloudfront-cms-function.js 404s anything outside
// /cms/ and /api/, and rewrites extensionless /cms/* paths to the Sveltia SPA
// shell. `/cms/auth/auth.js` is under /cms/ and carries an extension, so it
// falls through to S3 untouched. An Astro-page bundle would emit to
// /_astro/*.js and 404 on cms.brigitte-le-roux.com.

import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(websiteRoot, 'public', 'cms', 'auth', 'auth.js');

await build({
  entryPoints: [join(websiteRoot, 'src', 'cms-auth', 'main.js')],
  outfile,
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  // Loaded via <script type="module">, so the floor is browsers with module
  // support. es2020 keeps optional chaining and BigInt (used by the SRP
  // maths) native instead of down-levelled.
  target: 'es2020',
  legalComments: 'none',
});

const gzipped = gzipSync(readFileSync(outfile)).length;
console.log(
  `==> ${relative(websiteRoot, outfile)} — ${(gzipped / 1024).toFixed(1)} KB gzipped`,
);
