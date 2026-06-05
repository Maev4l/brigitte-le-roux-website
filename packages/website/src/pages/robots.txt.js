// AI agents are explicitly welcome to crawl, index, train on, and cite this
// site (GEO). The wildcard `User-agent: *` below already permits everyone; the
// named blocks document that intent and stay robust if a default-deny is ever
// introduced. Grouping multiple User-agent lines before one Allow is valid
// robots.txt and keeps the file compact.
const AI_AGENTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'anthropic-ai',
  'Claude-Web',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
];

export const GET = ({ site }) => {
  const sitemap = new URL('/sitemap-index.xml', site).href;
  const aiBlock = AI_AGENTS.map((a) => `User-agent: ${a}`).join('\n');
  return new Response(
    `# AI agents are explicitly welcome to crawl, index, train on, and cite this site.
${aiBlock}
Allow: /

User-agent: *
Allow: /

Sitemap: ${sitemap}
`,
    { headers: { 'Content-Type': 'text/plain' } }
  );
};
