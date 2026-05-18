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
  // A single external "book review" link (one URL to a reviewing article on
  // a third-party site). Used by CIGDA today. Distinct from `reviews:` which
  // is a curated list of locally-archived PDF reviews — see GDA.
  book_review_url: z.string().nullable().optional(),
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
  // Volume / issue / page range info (e.g. "Vol. 29 (2-3), 331-348" or "42, 1049-1071").
  // Free-form because the legacy bibliographic format varies; rendered after the
  // venue if present.
  pages: z.string().nullable().optional(),
  pdf: z.string().nullable().optional(),
  external: z.string().nullable().optional(),
  // Optional "see X" cross-reference to a books-page entry. Used for the
  // type:book entries in §1 (legacy "voir MCA" / "voir LIVRES" pattern).
  // slug is locale-neutral (the route prepends the EN/FR base prefix);
  // label is the displayed text inside the link (e.g. "MCA", "LIVRES" /
  // "Books"), per-locale because it varies.
  see_book_slug: z.string().nullable().optional(),
  see_book_label: z.string().nullable().optional()
});

const freeProseItem = z.object({
  year: z.number(),
  text_html: z.string()
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
    // Inlined listing arrays carried by the listing pages themselves
    // (content/pages/livres/{fr,en}.md and content/pages/publications/{fr,en}.md).
    // One source of truth per locale: edit the page, the listing updates.
    books: z.array(bookItem).optional(),
    publications: z.array(publicationItem).optional(),
    // Side sections rendered below the main books list on /livres,
    // mirroring the legacy site's "Livres traduits" and "Chapitres dans
    // des ouvrages collectifs" blocks. Each entry's text_html is the
    // pre-rendered HTML for the bibliographic line — keeps the data model
    // simple for free-prose academic citations that don't split cleanly
    // into authors/title/venue fields.
    translated_books_title: z.string().optional(),
    translated_books: z.array(z.object({
      year: z.number(),
      text_html: z.string()
    })).optional(),
    book_chapters_title: z.string().optional(),
    book_chapters: z.array(z.object({
      slug: z.string(),
      year: z.number(),
      text_html: z.string()
    })).optional(),
    // Optional cross-reference link rendered at the bottom of the listing
    // page (e.g. "Fichiers de données : <a ...>cliquer ici</a>").
    data_sets_link_html: z.string().optional(),
    // Top-of-listing cross-reference (e.g. on /publications, a link back to
    // /livres). Rendered above the listing if present.
    intro_link_html: z.string().optional(),
    // Publications-page sub-sections mirroring the legacy site's §2 Rapports
    // techniques and §3 Communications / Conferences (with Internationales /
    // Nationales sub-divisions). Each entry is free-prose HTML, year-desc sort.
    technical_reports_title: z.string().optional(),
    technical_reports: z.array(freeProseItem).optional(),
    communications_title: z.string().optional(),
    communications_international_title: z.string().optional(),
    communications_international: z.array(freeProseItem).optional(),
    communications_national_title: z.string().optional(),
    communications_national: z.array(freeProseItem).optional(),
    // Home-only structured fields. Present when `page_layout: home` is set
    // in frontmatter; HomeLayout.astro reads them. They are .optional() at
    // the schema level so other pages keep validating.
    // NOTE: "layout" is a reserved Astro frontmatter key that Vite resolves
    // as a component import path — using "page_layout" avoids that.
    page_layout: z.enum(['home', 'books', 'publications']).optional(),
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
