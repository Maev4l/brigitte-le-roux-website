import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const pages = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './content/pages',
    // Generate IDs as "folder/locale" (e.g. "home/fr", "publications/en")
    // so we can look them up by locale. Without this, the loader would use
    // the frontmatter `slug` field, causing duplicate IDs for fr/en pairs.
    generateId: ({ entry }) => entry.replace(/\.md$/, '')
  }),
  schema: z.object({
    title: z.string(),
    locale: z.enum(['fr', 'en']),
    slug: z.string(),
    description: z.string().optional(),
    // optional field to trigger data-driven listing below the markdown body
    listing: z.enum(['books', 'publications']).optional()
  })
});

export const collections = { pages };
