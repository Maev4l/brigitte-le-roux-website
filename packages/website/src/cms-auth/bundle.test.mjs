// Guards the CMS sign-in shim's two load-bearing properties: it must be
// self-hosted (no third-party script on the page that handles the editor's
// password) and it must authenticate with SRP.
//
// Amplify v6 ships no browser-global build, so the shim's JS is bundled by
// scripts/build-cms-auth.mjs into public/cms/auth/auth.js. Run that build
// before these assertions — `yarn test:cms-auth` does both.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundlePath = join(websiteRoot, 'public', 'cms', 'auth', 'auth.js');
const htmlPath = join(websiteRoot, 'public', 'cms', 'auth', 'index.html');
const sourcePath = join(websiteRoot, 'src', 'cms-auth', 'main.js');
const loaderPath = join(websiteRoot, 'public', 'cms', 'index.html');

// Hosts that would put a third party in the password path. jsDelivr served
// the v5 shim; esm.sh and jsDelivr's `+esm` builder can generate an Amplify
// v6 ESM graph on demand, but those files are dynamically built and so can
// never carry an SRI hash — which is why this page self-hosts instead.
const FORBIDDEN_HOSTS = ['jsdelivr.net', 'unpkg.com', 'esm.sh', 'cdnjs.cloudflare.com'];

// The v5 shim was ~150 KB gzipped from CDN. A bundle materially larger than
// that on a login page means a dependency bump pulled in something unexpected
// and deserves a look, not a silent ship.
const MAX_GZIPPED_BYTES = 200 * 1024;

test('the bundle exists and is non-empty', () => {
  assert.ok(statSync(bundlePath).size > 0, `${bundlePath} is missing or empty`);
});

test('the bundle pulls no script from a third-party CDN', () => {
  const bundle = readFileSync(bundlePath, 'utf8');
  for (const host of FORBIDDEN_HOSTS) {
    assert.ok(!bundle.includes(host), `bundle references ${host}`);
  }
});

test('the page loads only its own same-origin bundle', () => {
  const html = readFileSync(htmlPath, 'utf8');
  assert.match(html, /<script\s+type="module"\s+src="\.\/auth\.js"><\/script>/);
  for (const host of FORBIDDEN_HOSTS) {
    assert.ok(!html.includes(host), `index.html references ${host}`);
  }
  // The v5 global is gone; nothing should still be reaching for it.
  assert.ok(!html.includes('AmazonCognitoIdentity'), 'index.html still uses the v5 global');
});

// Note on what is NOT asserted here: the bundle unavoidably contains the string
// USER_PASSWORD_AUTH, because Amplify's signIn switches over every flow name
// (@aws-amplify/auth signIn.mjs). Its `default` branch is signInWithSRP, so
// omitting `authFlowType` yields SRP — which is why the assertion below is on
// this shim's own source, where the choice actually lives. Cognito is the
// backstop: the app client enables only ALLOW_USER_SRP_AUTH.
test('this shim does not opt into a plaintext-password flow', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.ok(
    !source.includes('USER_PASSWORD_AUTH'),
    'main.js names USER_PASSWORD_AUTH — the password would cross the network in clear',
  );
  const explicitFlow = source.match(/authFlowType:\s*['"]([A-Z_]+)['"]/);
  if (explicitFlow) {
    assert.equal(
      explicitFlow[1],
      'USER_SRP_AUTH',
      'main.js selects a non-SRP auth flow',
    );
  }
});

test('the bundled Amplify build retains the SRP path', () => {
  const bundle = readFileSync(bundlePath, 'utf8');
  assert.ok(
    bundle.includes('USER_SRP_AUTH'),
    'bundle has no USER_SRP_AUTH — tree-shaking may have dropped the SRP implementation',
  );
});

// The Sveltia loader at /cms/ is a different page with a different constraint:
// the CMS bundle is genuinely third-party and cannot be self-hosted, so the
// requirement is weaker but still enforced — every external script must be
// pinned by exact version AND by SRI, so a swapped bundle fails to execute
// instead of running with access to the editor's session.
test('the Sveltia loader pins every third-party script by version and SRI', () => {
  const html = readFileSync(loaderPath, 'utf8');
  const externalScripts = html.match(/<script\b[^>]*\bsrc="https?:\/\/[^>]*>/g) ?? [];
  assert.ok(externalScripts.length > 0, 'expected the loader to load the CMS bundle externally');
  for (const tag of externalScripts) {
    assert.match(tag, /integrity="sha(256|384|512)-/, `external script lacks SRI: ${tag}`);
    assert.match(tag, /crossorigin=/, `SRI needs crossorigin on a cross-origin script: ${tag}`);
    assert.match(tag, /@\d+\.\d+\.\d+\//, `external script is not pinned to an exact version: ${tag}`);
  }
});

test('the bundle stays within the login-page size budget', () => {
  const gzipped = gzipSync(readFileSync(bundlePath)).length;
  assert.ok(
    gzipped <= MAX_GZIPPED_BYTES,
    `bundle is ${(gzipped / 1024).toFixed(1)} KB gzipped, budget is ${MAX_GZIPPED_BYTES / 1024} KB`,
  );
});
