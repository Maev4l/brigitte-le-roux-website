import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  personId,
  personSchema,
  websiteSchema,
  bookSchema,
  publicationSchema,
  breadcrumbList,
} from './schema.mjs';

const fixtureIdentity = {
  name: 'Brigitte Le Roux',
  givenName: 'Brigitte',
  familyName: 'Le Roux',
  jobTitle: { fr: 'Chercheuse', en: 'Researcher' },
  affiliation: [{ name: 'MAP5', url: 'https://map5.example/' }],
  sameAs: ['https://orcid.org/0000-0000-0000-0000'],
};
const site = 'https://brigitte-le-roux.com';

test('personSchema emits @type Person with given/family name and sameAs', () => {
  const s = personSchema(fixtureIdentity, site, 'fr');
  assert.equal(s['@type'], 'Person');
  assert.equal(s.name, 'Brigitte Le Roux');
  assert.equal(s.givenName, 'Brigitte');
  assert.equal(s.familyName, 'Le Roux');
  assert.equal(s.jobTitle, 'Chercheuse');
  assert.deepEqual(s.sameAs, ['https://orcid.org/0000-0000-0000-0000']);
  assert.equal(s.affiliation[0]['@type'], 'Organization');
});

test('personSchema omits sameAs when empty', () => {
  const s = personSchema({ ...fixtureIdentity, sameAs: [] }, site, 'fr');
  assert.ok(!('sameAs' in s));
});

test('websiteSchema emits SearchAction template', () => {
  const s = websiteSchema(site, 'fr');
  assert.equal(s['@type'], 'WebSite');
  assert.equal(s.url, site);
  assert.equal(s.potentialAction['@type'], 'SearchAction');
});

test('bookSchema maps frontmatter book entry', () => {
  const s = bookSchema({
    slug: 'cigda',
    title: 'Combinatorial Inference in Geometric Data Analysis',
    authors: ['Le Roux, B.', 'Bienaise, S.'],
    year: 2019,
    publisher: 'Chapman & Hall/CRC',
    isbn: '9781498781619',
  });
  assert.equal(s['@type'], 'Book');
  assert.equal(s.name, 'Combinatorial Inference in Geometric Data Analysis');
  assert.deepEqual(s.author, [
    { '@type': 'Person', name: 'Le Roux, B.' },
    { '@type': 'Person', name: 'Bienaise, S.' },
  ]);
  assert.equal(s.isbn, '9781498781619');
  assert.equal(s.publisher['@type'], 'Organization');
  assert.equal(s.publisher.name, 'Chapman & Hall/CRC');
  assert.equal(s.datePublished, '2019');
});

test('publicationSchema dispatches on type', () => {
  const article = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['A'], venue: 'V', type: 'article',
  });
  assert.equal(article['@type'], 'ScholarlyArticle');

  const book = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['A'], venue: 'V', type: 'book',
  });
  assert.equal(book['@type'], 'Book');

  const chapter = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['A'], venue: 'V', type: 'chapter',
  });
  assert.equal(chapter['@type'], 'Chapter');

  const slides = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['A'], venue: 'V', type: 'slides',
  });
  assert.equal(slides['@type'], 'PresentationDigitalDocument');
});

test('publicationSchema isPartOf type follows publication type', () => {
  const article = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['A'], venue: 'V', type: 'article',
  });
  assert.equal(article.isPartOf['@type'], 'Periodical');

  const chapter = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['A'], venue: 'V', type: 'chapter',
  });
  assert.equal(chapter.isPartOf['@type'], 'Book');

  const book = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['A'], venue: 'V', type: 'book',
  });
  assert.equal(book.isPartOf['@type'], 'Book');

  const slides = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['A'], venue: 'V', type: 'slides',
  });
  assert.equal(slides.isPartOf['@type'], 'CreativeWork');
});

test('publicationSchema includes pdf url when present', () => {
  const s = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['A'], venue: 'V', type: 'article',
    pdf: '/data/foo.pdf',
  });
  assert.equal(s.url, '/data/foo.pdf');
});

test('breadcrumbList builds ordered list', () => {
  const s = breadcrumbList([
    { name: 'Home', url: 'https://example.com/' },
    { name: 'Books', url: 'https://example.com/livres/' },
    { name: 'CIGDA', url: 'https://example.com/livres/cigda/' },
  ]);
  assert.equal(s['@type'], 'BreadcrumbList');
  assert.equal(s.itemListElement.length, 3);
  assert.equal(s.itemListElement[0].position, 1);
  assert.equal(s.itemListElement[2].name, 'CIGDA');
});

test('personId derives a #person anchor from site', () => {
  assert.equal(personId(site), 'https://brigitte-le-roux.com#person');
});

test('personSchema includes a stable @id derived from site', () => {
  const s = personSchema(fixtureIdentity, site, 'fr');
  assert.equal(s['@id'], 'https://brigitte-le-roux.com#person');
});

test('personSchema includes locale description and knowsAbout when present', () => {
  const id = {
    ...fixtureIdentity,
    description: { fr: 'desc-fr', en: 'desc-en' },
    knowsAbout: { fr: ['A', 'B'], en: ['X', 'Y'] },
  };
  const fr = personSchema(id, site, 'fr');
  assert.equal(fr.description, 'desc-fr');
  assert.deepEqual(fr.knowsAbout, ['A', 'B']);
  const en = personSchema(id, site, 'en');
  assert.equal(en.description, 'desc-en');
  assert.deepEqual(en.knowsAbout, ['X', 'Y']);
});

test('personSchema omits description and knowsAbout when absent', () => {
  const s = personSchema(fixtureIdentity, site, 'fr');
  assert.ok(!('description' in s));
  assert.ok(!('knowsAbout' in s));
});

test('bookSchema links a Le Roux author to the Person @id when personId given', () => {
  const s = bookSchema({
    slug: 'cigda', title: 'T', authors: ['Le Roux, B.', 'Bienaise, S.'],
    year: 2019, publisher: 'P',
  }, personId(site));
  assert.deepEqual(s.author[0], { '@id': 'https://brigitte-le-roux.com#person' });
  assert.deepEqual(s.author[1], { '@type': 'Person', name: 'Bienaise, S.' });
});

test('bookSchema keeps anonymous authors when no personId passed', () => {
  const s = bookSchema({
    slug: 'x', title: 'T', authors: ['Le Roux, B.'], year: 2019, publisher: 'P',
  });
  assert.deepEqual(s.author[0], { '@type': 'Person', name: 'Le Roux, B.' });
});

test('publicationSchema links a Le Roux author to the Person @id', () => {
  const s = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['Lebaron, F.', 'Le Roux, B.'],
    venue: 'V', type: 'article',
  }, personId(site));
  assert.deepEqual(s.author[0], { '@type': 'Person', name: 'Lebaron, F.' });
  assert.deepEqual(s.author[1], { '@id': 'https://brigitte-le-roux.com#person' });
});

test('websiteSchema references the Person @id as author and about', () => {
  const s = websiteSchema(site, 'fr');
  assert.deepEqual(s.author, { '@id': 'https://brigitte-le-roux.com#person' });
  assert.deepEqual(s.about, { '@id': 'https://brigitte-le-roux.com#person' });
});
