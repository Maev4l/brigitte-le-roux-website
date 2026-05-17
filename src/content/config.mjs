import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Reusable item schemas for the inlined listing arrays carried by the
// books-listing and publications-listing pages. Defining them once keeps the
// pages schema readable.

const reviewItem = z.object({
  reviewer: z.string(),
  venue: z.string(),
  year: z.number(),
  url: z.string()
});

const bookItem = z.object({
  slug: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number(),
  publisher: z.string(),
  isbn: z.string().nullable().optional(),
  cover: z.string().nullable().optional(),
  // page_slug points at a detail page under content/pages/<page_slug>/
  // when the book warrants one (e.g. "livres/cigda"). Omitted = listing only.
  page_slug: z.string().nullable().optional(),
  external: z.string().nullable().optional(),
  // Reviews of this book — currently only `gda` has any.
  reviews: z.array(reviewItem).optional()
});

const publicationItem = z.object({
  slug: z.string(),
  year: z.number(),
  // Locale-specific title — the FR page carries the French title, the EN page
  // carries the English title. Each is whatever the page's locale shows.
  title: z.string(),
  authors: z.array(z.string()),
  venue: z.string(),
  type: z.enum(['article', 'book', 'chapter', 'slides']),
  pdf: z.string().nullable().optional(),
  external: z.string().nullable().optional()
});

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
    // Optional discriminator. When set, the catch-all route renders the
    // matching `books` / `publications` array (also in this frontmatter)
    // as a year-desc listing below the markdown body.
    listing: z.enum(['books', 'publications']).optional(),
    // Inlined listing arrays carried by the listing pages themselves
    // (content/pages/livres/{fr,en}.md and content/pages/publications/{fr,en}.md).
    // One source of truth per locale: edit the page, the listing updates.
    books: z.array(bookItem).optional(),
    publications: z.array(publicationItem).optional(),
    // Home-only structured fields. Present when `page_layout: home` is set
    // in frontmatter; HomeLayout.astro reads them. They are .optional() at
    // the schema level so other pages keep validating.
    // NOTE: "layout" is a reserved Astro frontmatter key that Vite resolves
    // as a component import path — using "page_layout" avoids that.
    page_layout: z.enum(['home']).optional(),
    kicker: z.string().optional(),
    deck_html: z.string().optional(),
    portrait: z.object({
      src: z.string(),
      alt: z.string()
    }).optional(),
    // Note: bio paragraphs are NOT a frontmatter field — they live in the
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
