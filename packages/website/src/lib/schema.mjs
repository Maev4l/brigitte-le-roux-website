// Pure JSON-LD builders. Each function returns a plain object (or array)
// suitable for embedding in <script type="application/ld+json">. Fields
// without data are omitted so partial frontmatter never produces invalid
// schema.

const CONTEXT = 'https://schema.org';

// Strips undefined / null / empty-string / empty-array properties. Schema.org
// consumers tolerate missing fields but choke on empty values.
const compact = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.length === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
};

const personFromName = (name) => ({ '@type': 'Person', name });

// Link an author to the Person entity when it is Brigitte. Author strings on
// this site are formatted "Le Roux, B." (not the full identity name), so we use
// the same startsWith('Le Roux') rule the listing layouts already apply. Other
// authors stay anonymous Person objects — we have no stable IDs for co-authors.
const authorNode = (name, pid) =>
  pid && name.startsWith('Le Roux') ? { '@id': pid } : personFromName(name);

// Stable canonical identifier for the Person entity. Every authored work and
// the WebSite node reference this @id so consumers merge them into one entity
// graph — even across separate <script type="application/ld+json"> tags.
export const personId = (site) => `${site}#person`;

export const personSchema = (identity, site, locale) => compact({
  '@context': CONTEXT,
  '@type': 'Person',
  '@id': personId(site),
  name: identity.name,
  givenName: identity.givenName,
  familyName: identity.familyName,
  jobTitle: identity.jobTitle[locale] || identity.jobTitle.fr,
  // Optional GEO fields — compact() drops them when identity omits them.
  description: identity.description?.[locale] || identity.description?.fr,
  knowsAbout: identity.knowsAbout?.[locale] || identity.knowsAbout?.fr,
  url: site,
  affiliation: identity.affiliation.map(a => ({
    '@type': 'Organization',
    name: a.name,
    url: a.url,
  })),
  sameAs: identity.sameAs,
});

export const websiteSchema = (site, locale) => ({
  '@context': CONTEXT,
  '@type': 'WebSite',
  url: site,
  inLanguage: locale === 'en' ? 'en' : 'fr',
  // Declare the site's subject and owner as the Person entity.
  author: { '@id': personId(site) },
  about: { '@id': personId(site) },
  // SearchAction is a hint to Google for the sitelinks search box. The
  // template URL points at a hypothetical /search?q= endpoint; if/when
  // an on-site search is added the URL becomes real, until then Google
  // still uses the schema for entity disambiguation.
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${site}/search?q={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
});

export const bookSchema = (book, pid) => compact({
  '@context': CONTEXT,
  '@type': 'Book',
  name: book.title,
  author: book.authors.map((name) => authorNode(name, pid)),
  datePublished: String(book.year),
  publisher: book.publisher ? { '@type': 'Organization', name: book.publisher } : undefined,
  isbn: book.isbn || undefined,
  url: book.external || undefined,
});

const PUBLICATION_TYPE_MAP = {
  article: 'ScholarlyArticle',
  book: 'Book',
  chapter: 'Chapter',
  slides: 'PresentationDigitalDocument',
};

// The container that hosts a publication varies by publication type: a journal
// article lives in a Periodical, a chapter or translated book lives in a Book,
// and conference slides live in a generic CreativeWork (no canonical Schema.org
// type for a slide-deck venue). Hard-coding `Periodical` produced JSON-LD that
// Google's Rich Results validator flagged as semantically wrong for chapters.
const VENUE_TYPE_MAP = {
  article: 'Periodical',
  book: 'Book',
  chapter: 'Book',
  slides: 'CreativeWork',
};

export const publicationSchema = (pub, pid) => compact({
  '@context': CONTEXT,
  '@type': PUBLICATION_TYPE_MAP[pub.type] || 'CreativeWork',
  name: pub.title,
  author: pub.authors.map((name) => authorNode(name, pid)),
  datePublished: String(pub.year),
  isPartOf: pub.venue ? { '@type': VENUE_TYPE_MAP[pub.type] || 'CreativeWork', name: pub.venue } : undefined,
  pagination: pub.pages || undefined,
  // Prefer the local PDF over the external link — PDFs are concrete artifacts
  // Google can index; external links may be paywalled.
  url: pub.pdf || pub.external || undefined,
});

export const breadcrumbList = (items) => ({
  '@context': CONTEXT,
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: item.name,
    item: item.url,
  })),
});
