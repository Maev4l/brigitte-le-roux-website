export const GET = ({ site }) => {
  const sitemap = new URL('/sitemap-index.xml', site).href;
  return new Response(
    `User-agent: *
Allow: /

Sitemap: ${sitemap}
`,
    { headers: { 'Content-Type': 'text/plain' } }
  );
};
