// CloudFront viewer-request function for the /api/* behavior on the CMS
// distribution. Sveltia's GitHub backend sends `Authorization: token <jwt>`
// (GitHub PAT format), but API Gateway's Cognito JWT authorizer requires
// `Authorization: Bearer <jwt>` and rejects anything else with 401.
//
// We rewrite the scheme at the edge: `token` -> `Bearer`. Other schemes
// (e.g. requests that already use `Bearer`) pass through unchanged.
function handler(event) {
  var request = event.request;
  var auth = request.headers.authorization;
  if (auth && auth.value) {
    var lower = auth.value.toLowerCase();
    if (lower.startsWith('token ')) {
      request.headers.authorization = { value: 'Bearer ' + auth.value.substring(6) };
    }
  }
  return request;
}
