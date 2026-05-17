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
    keywords: z.string().optional(),
    // optional field to trigger data-driven listing below the markdown body
    listing: z.enum(['books', 'publications']).optional(),
    // Home-only structured fields. Present when `page_layout: home` is set in
    // frontmatter; HomeLayout.astro reads them. They are .optional() at the
    // schema level so the rest of the page collection keeps validating.
    // NOTE: "layout" is a reserved Astro frontmatter key that Vite resolves as
    // a component import path — using "page_layout" avoids that collision.
    page_layout: z.enum(['home']).optional(),
    kicker: z.string().optional(),
    deck_html: z.string().optional(),
    portrait: z.object({
      src: z.string(),
      alt: z.string()
    }).optional(),
    // Note: the bio paragraphs are NOT a frontmatter field — they live in the
    // markdown body of home/{fr,en}.md and are rendered by HomeLayout via
    // Astro's <Content /> component, the same pipeline every other page uses.
    tiles: z.object({
      affiliations: z.object({
        title: z.string(),
        body_html: z.string(),
        note: z.string().optional()
      }),
      methodes: z.object({
        title: z.string(),
        items: z.array(z.object({
          label: z.string(),
          ab: z.string()
        }))
      }),
      nouveau: z.object({
        title: z.string(),
        book_title: z.string(),
        book_href: z.string(),
        book_meta: z.string()
      })
    }).optional()
  })
});

export const collections = { pages };
