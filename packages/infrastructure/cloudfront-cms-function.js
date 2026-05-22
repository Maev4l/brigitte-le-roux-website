// CloudFront viewer-request function for the CMS distribution.
// - Root path redirects to /cms/ (Sveltia's home).
// - /cms/ and /cms/<dir-like-path> rewrite to /cms/index.html so the
//   Sveltia SPA can take over client-side routing on refresh.
// - /cms/<file.ext> falls through unchanged so S3 serves the asset.
// - Anything outside /cms/ and /api/ returns 404. (/api/* is handled by
//   a separate behavior whose origin is the API Gateway; this function
//   never runs for those requests.)
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri === '/') {
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: { location: { value: '/cms/' } },
    };
  }

  if (uri !== '/cms' && !uri.startsWith('/cms/')) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }

  if (uri === '/cms' || uri === '/cms/') {
    request.uri = '/cms/index.html';
    return request;
  }

  // /cms/<anything>. If the last path segment lacks an extension we treat
  // it as an SPA route and serve the shell so client-side routing takes
  // over. Files like /cms/assets/main.abc.js still resolve to S3 directly.
  var lastSegment = uri.split('/').pop();
  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/cms/index.html';
  }

  return request;
}
