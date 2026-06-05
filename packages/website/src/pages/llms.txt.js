import { getCollection } from 'astro:content';
import { identity } from '../lib/identity.mjs';

// Strip the ".fr"/".en" suffix from a content-collection entry id to get the
// URL path stem ("home", "cv", "livres/cigda").
const pathOf = (id) => id.replace(/\.(fr|en)$/, '');

// Recognised external-profile hosts → human label for the "External profiles"
// section. Unknown hosts fall back to the bare URL.
const profileLabel = (url) => {
  if (url.includes('orcid.org')) return 'ORCID';
  if (url.includes('scholar.google')) return 'Google Scholar';
  if (url.includes('researchgate.net')) return 'ResearchGate';
  if (url.includes('sciencespo.fr')) return 'CEVIPOF directory';
  if (url.includes('map5')) return 'MAP5';
  return url;
};

export const GET = async ({ site }) => {
  const origin = site.href.replace(/\/$/, '');
  const pages = await getCollection('pages');

  const urlOf = (entry) => {
    const path = pathOf(entry.id);
    const en = entry.data.locale === 'en';
    if (path === 'home') return `${origin}${en ? '/en/' : '/'}`;
    return `${origin}${en ? '/en' : ''}/${path}/`;
  };

  // Curated index: top-level pages only (no "/" in the path stem). Detail pages
  // under livres/* and publications/* are reachable from their listing pages.
  const topLevel = pages.filter((p) => !pathOf(p.id).includes('/'));
  // home first (empty sort key), then alphabetical by path stem — resilient if
  // new pages are added later.
  const orderKey = (p) => (pathOf(p.id) === 'home' ? '' : pathOf(p.id));
  const byLocale = (loc) =>
    topLevel
      .filter((p) => p.data.locale === loc)
      .sort((a, b) => orderKey(a).localeCompare(orderKey(b)));

  const bullet = (entry) => {
    const desc = entry.data.description ? `: ${entry.data.description}` : '';
    return `- [${entry.data.title}](${urlOf(entry)})${desc}`;
  };

  // Books come from the FR livres page's inlined array, newest first.
  const livres = pages.find((p) => p.id === 'livres.fr');
  const books = (livres?.data.books ?? []).slice().sort((a, b) => b.year - a.year);
  const bookBullet = (b) => {
    const href = b.external || (b.page_slug ? `${origin}/${b.page_slug}/` : null);
    const link = href ? `[${b.title}](${href})` : b.title;
    return `- ${link} (${b.year}, ${b.publisher})`;
  };

  const summary =
    identity.description?.fr ||
    `${identity.name} — ${identity.jobTitle.fr}, ${identity.affiliation
      .map((a) => a.name)
      .join(' ; ')}.`;

  const body = `# ${identity.name}

> ${identity.jobTitle.fr} / ${identity.jobTitle.en}. ${identity.affiliation
    .map((a) => a.name)
    .join(' · ')}.

${summary}

Ce site est bilingue : pages françaises à la racine, pages anglaises sous \`/en/\`.
This site is bilingual: French pages at the root, English pages under \`/en/\`.

## Pages (français)
${byLocale('fr').map(bullet).join('\n')}

## Pages (English)
${byLocale('en').map(bullet).join('\n')}

## Books
${books.map(bookBullet).join('\n')}

## External profiles
${identity.sameAs.map((url) => `- ${profileLabel(url)}: ${url}`).join('\n')}
`;

  return new Response(body, { headers: { 'Content-Type': 'text/plain' } });
};
