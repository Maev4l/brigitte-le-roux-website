// Sveltia OAuth shim — signs the editor in against Cognito and hands the
// id_token back to Sveltia over Sveltia's postMessage protocol.
//
// Bundled by scripts/build-cms-auth.mjs into public/cms/auth/auth.js and
// loaded same-origin by public/cms/auth/index.html. It is bundled rather
// than inlined because Amplify v6 ships no browser-global build: the v5
// `amazon-cognito-identity-js` script tag this replaced had one, but v5
// reaches end of support on 2027-03-01. Self-hosting also keeps a third
// party out of the page that reads the editor's password — the auto-built
// ESM bundles the public CDNs offer for v6 are generated per request and
// therefore can never carry an SRI hash.

import { Amplify } from 'aws-amplify';
import { fetchAuthSession, signIn, signOut } from 'aws-amplify/auth';

// ---- Configuration (public values; no secrets) -----------------------
const USER_POOL_ID = 'eu-central-1_d777fmVps';
const APP_CLIENT_ID = '5hk4h6m90mih8j055929bk1adc';

// signIn defaults to USER_SRP_AUTH, which is the only password flow the app
// client enables (see packages/infrastructure/cognito.tf). The password is
// never sent across the network.
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: USER_POOL_ID,
      userPoolClientId: APP_CLIENT_ID,
    },
  },
});

// ---- Read the OAuth params Sveltia opened us with --------------------
const params = new URLSearchParams(window.location.search);
const provider = params.get('provider') || 'github';

const form = document.getElementById('login-form');
const submit = document.getElementById('submit');
const errorBox = document.getElementById('error');

const postToOpener = (message) => {
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(message, '*');
  }
};

const postAuthorizationSuccess = (idToken) => {
  const payload = JSON.stringify({ provider, token: idToken });
  postToOpener('authorization:' + provider + ':success:' + payload);
};

const postAuthorizationError = (message, code) => {
  const payload = JSON.stringify({ provider, error: message, errorCode: code || 'AUTH_ERROR' });
  postToOpener('authorization:' + provider + ':error:' + payload);
};

// Sign-in steps this shim deliberately does not implement. MFA is off at the
// pool and account recovery is admin-only, so the reachable case in practice
// is the temporary password from an admin-created account — which the editor
// resolves once via the AWS console, exactly as the v5 shim instructed.
// User-facing strings are French (the editor is French and the CMS is
// configured in French); code and comments stay English.
const nextStepMessage = (nextStep) => {
  if (nextStep && nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
    return 'Changement de mot de passe initial requis — connectez-vous une fois ' +
      'via la console AWS, puis réessayez ici.';
  }
  return 'La connexion requiert une étape supplémentaire non prise en charge par cette page' +
    (nextStep && nextStep.signInStep ? ' (' + nextStep.signInStep + ')' : '') + '.';
};

const authenticate = async (email, password) => {
  // Amplify keeps its session in localStorage, so a previous sign-in in this
  // browser makes signIn throw UserAlreadyAuthenticatedException. The v5
  // shim had no such state. Clearing first makes every visit behave like the
  // first one; failure here is irrelevant because we are about to re-auth.
  await signOut().catch(() => {});

  const { isSignedIn, nextStep } = await signIn({ username: email, password });
  if (!isSignedIn) {
    throw new Error(nextStepMessage(nextStep));
  }

  const { tokens } = await fetchAuthSession();
  if (!tokens || !tokens.idToken) {
    throw new Error('Connexion réussie mais aucun jeton d’identité n’a été renvoyé');
  }
  return tokens.idToken.toString();
};

// After Cognito SRP succeeds we have an id_token in hand. Use it to fetch the
// dedicated S3-uploader IAM user's access key + secret from
// /api/media/s3-credentials, then stash the secret into Sveltia's
// preferences-storage key (sveltia-cms.prefs.apiKeys.aws_s3). Sveltia reads
// this synchronously when the editor opens an asset browser — by the time the
// shim's postMessage completes and the popup closes, Sveltia's auth state is
// ready AND its S3 secret is pre-populated. Editor never enters credentials.
//
// Failure is non-fatal: media uploads will surface the missing-secret error in
// Sveltia's UI on first attempt; auth still succeeds.
const fetchAndStashS3Credentials = async (idToken) => {
  try {
    const response = await fetch('/api/media/s3-credentials', {
      headers: { Authorization: 'Bearer ' + idToken },
    });
    if (!response.ok) {
      console.warn('media-manager /s3-credentials returned', response.status);
      return;
    }
    const creds = await response.json();
    if (!creds || typeof creds.secret_access_key !== 'string') {
      console.warn('media-manager response missing secret_access_key');
      return;
    }
    const rawPrefs = localStorage.getItem('sveltia-cms.prefs');
    let prefs = {};
    if (rawPrefs) {
      try {
        prefs = JSON.parse(rawPrefs);
      } catch {
        prefs = {};
      }
    }
    prefs.apiKeys = prefs.apiKeys || {};
    prefs.apiKeys.aws_s3 = creds.secret_access_key;
    localStorage.setItem('sveltia-cms.prefs', JSON.stringify(prefs));
  } catch (err) {
    console.warn('failed to stash S3 credentials', err && err.message);
  }
};

postToOpener('authorizing:' + provider);

let sveltiaReady = false;
window.addEventListener('message', (e) => {
  if (typeof e.data === 'string' && e.data === 'authorizing:' + provider) {
    sveltiaReady = true;
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Connexion…';

  try {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const idToken = await authenticate(email, password);

    const deadline = Date.now() + 2000;
    while (!sveltiaReady && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // Fetch + stash S3 creds so Sveltia's media library has the secret ready
    // once the popup closes.
    await fetchAndStashS3Credentials(idToken);

    postAuthorizationSuccess(idToken);

    try {
      localStorage.setItem('cms.cognito_id_token', idToken);
    } catch {
      /* ignore quota errors */
    }

    setTimeout(() => window.close(), 200);
  } catch (err) {
    // Cognito's own rejections (NotAuthorizedException etc.) arrive in English
    // from Amplify; only our own fallback and step messages are localised.
    const message = err && err.message ? err.message : 'Échec de la connexion';
    errorBox.textContent = message;
    // Amplify v6 exposes the Cognito exception on `name` (v5 used `code`).
    // prevent_user_existence_errors is ENABLED on the app client, so a wrong
    // email and a wrong password both arrive as NotAuthorizedException.
    postAuthorizationError(message, err && err.name ? err.name : 'AUTH_ERROR');
    submit.disabled = false;
    submit.textContent = 'Se connecter';
  }
});
