import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://brigitte-le-roux.com',
  i18n: {
    defaultLocale: 'fr',
    locales: ['fr', 'en'],
    routing: { prefixDefaultLocale: false }
  },
  server: { port: 4321 },
  build: { format: 'directory' }
});
