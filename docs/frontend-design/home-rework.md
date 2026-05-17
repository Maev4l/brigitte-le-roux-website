# Home page rework — "Op-Ed Wrap"

**Date:** 2026-05-17
**Scope:** Home page only (`content/pages/home/{fr,en}.md` + a new home-hero
component). All other routes keep their current `[...slug].astro` rendering.

## Decision

Adopt the **Op-Ed Wrap** layout (Mockup C) for the home page. The reference
prototype is at `/tmp/blr-home-mockups/C-opedwrap.html` (parchment + vermillion
+ Fraunces / Bricolage Grotesque palette, unchanged from `src/styles/theme.css`).

## Rationale

The home page is the only page where the portrait appears and where a reader
forms an impression of the person, not just consumes a publication list. The
Op-Ed Wrap puts the portrait in dialogue with the bio: the portrait floats on
the right with its **top edge aligned to the top of the H1**, the headline
"Brigitte *Le Roux*" sets in Fraunces opsz 144, and a single drop-capped
paragraph opens the bio in the surrounding column. A three-tile strip at the
bottom (`Affiliations / Méthodes / Nouveau`) closes the page with hairline
dividers, replacing the existing flat markdown sections.

Editorial / "in-magazine article" feel rather than "front page" — invites
reading, fits an academic homepage where summary text matters more than
brand-shout.

## Visual specification

### Layout (large viewport ≥ 780 px)

```
┌─ masthead rule (existing) ────────────────────────────────────┐
│ Header (existing — name, nav, language picker, accent underline) │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ▬ ANALYSE GÉOMÉTRIQUE DES DONNÉES · RECHERCHE                   │
│    (vermillion 38px bar + tracked uppercase Bricolage kicker)    │
│                                                                  │
│  Brigitte                            ┌────────────────────────┐  │
│  Le Roux  (italic)                   │  cream mat (#ece4d3)   │  │
│                                      │  1px border  --border  │  │
│  (28 px gap)                         │  ┌──────────────────┐  │  │
│  Chercheuse en mathématiques.        │  │                  │  │  │
│  Analyse géométrique des données —   │  │   photoweb.jpg   │  │  │
│  MAP5,&nbsp;Université Paris Cité,   │  │   filter:        │  │  │
│  et CEVIPOF / CNRS.   (italic deck)  │  │     saturate(.9) │  │  │
│                                      │  │     contrast(1.02)│ │  │
│  ┃L┃es travaux de Brigitte Le Roux   │  │                  │  │  │
│  ┃ ┃portent sur l'analyse géométrique│  └──────────────────┘  │  │
│  des données (AGD) et ses…           └────────────────────────┘  │
│  ↑ vermillion Fraunces drop-cap (88px, opsz 144, line-height .82)│
│                                                                  │
│  Affiliée au laboratoire MAP5… (body wraps the portrait left)    │
│  Parmi les méthodes étudiées…                                    │
│                                                                  │
├─── 3px black rule ───────────────────────────────────────────────┤
│ AFFILIATIONS │      MÉTHODES        │       NOUVEAU              │
│ (vermillion  │ (vermillion uppercase│ (vermillion uppercase       │
│  uppercase)  │  Bricolage)          │  Bricolage)                 │
│              │                      │                             │
│ MAP5 — UPC   │ ACM — Analyse des…   │ Combinatorial Inference …   │
│ CEVIPOF/CNRS │ ACP — Analyse en…    │ (italic Fraunces, underlined│
│              │ Données structurées  │  border-bottom on hover →   │
│ 45 rue des…  │ Inférence combinat.  │  accent)                    │
│              │                      │ B. Le Roux & H. Rouanet —   │
│              │                      │ Chapman & Hall / CRC, 2019. │
└─── 1px hairline ────────────────────────────────────────────────┘
```

### Small viewport (< 780 px)

- Portrait un-floats (`float:none`), drops to a max-width 340 px block above the
  H1 (or below the kicker), no wrap.
- Three-tile strip collapses to a single column with hairline `border-bottom`
  between rows.
- Drop-cap scales down to 64 px.

## Typography & tokens — no new tokens introduced

All values reuse `src/styles/theme.css` variables. No new fonts, no new
colours. The aesthetic is achieved entirely through composition.

| Element            | Family / variation                | Size                   | Weight | Colour          |
|--------------------|-----------------------------------|------------------------|--------|-----------------|
| Top kicker         | Bricolage, tracking `.34em`, upper | 10 px                  | 700    | `--accent`      |
| Kicker bar         | —                                  | 38 × 2 px              | —      | `--accent`      |
| H1 (name)          | Fraunces, opsz 144, `-0.035em`     | `clamp(58px, 8vw, 108px)` | 300 | `--text`        |
| H1 italic span     | Fraunces italic, opsz 144          | inherit                | 300    | `--text`        |
| Deck (standfirst)  | Fraunces italic, opsz 36           | 22 px                  | 400    | `--text-muted`  |
| Body paragraph     | Fraunces, default opsz             | 17 px                  | 400    | `--text`        |
| Drop-cap           | Fraunces, opsz 144                 | 88 px                  | 400    | `--accent`      |
| Tile title (h2.h)  | Bricolage, tracking `.28em`, upper | 10 px                  | 700    | `--accent`      |
| Tile body          | Fraunces                           | 15 px                  | 400    | `--text`        |
| Tile italic note   | Fraunces italic                    | 14 px                  | 400    | `--text-muted`  |
| Method abbreviation| Bricolage                          | 10 px                  | 700    | `--accent`      |
| Method label       | Fraunces                           | 15 px                  | 400    | `--text`        |

## Behaviour & micro-rules

1. **Portrait top alignment** — the `<figure class="portrait">` appears in
   source between the kicker and the H1, with `margin-top: 0`. Because it
   floats right at that point in the flow, its mat's top edge sits on the same
   horizontal line as the top of "Brigitte *Le Roux*". Do not change source
   order — the alignment depends on it.

2. **H1 → deck vertical gap** — `h1.oped { margin: 0 0 28px }`. The two pieces
   need air between them; tighter than 24 px reads cramped, looser than 32 px
   breaks the pair.

3. **Widow control on the deck** — two layered defences:
   - `text-wrap: balance` on `.deck` re-distributes words across lines so the
     last line is never a single short word.
   - `MAP5, Université Paris Cité` and `CEVIPOF / CNRS` are each bound with
     non-breaking spaces, AND an explicit `<br>` separates the two affiliations
     so they always render as two distinct line-groups regardless of width.
   - Apply the same `text-wrap: balance` to the global `h1` selector in
     `theme.css` while we're there — it's a free win for all titles.

4. **Drop-cap** — `::first-letter` on the first body paragraph only (mark with
   `.first` so we don't repeat it on every `<p>`). 88 px, vermillion, opsz 144,
   non-italic, `line-height: 0.82`, `padding: 6px 12px 0 0`.

5. **Tile strip** — 3-column grid, top `3px solid var(--text)`, bottom
   `1px solid var(--border)`, internal `1px solid var(--border)` between tiles.
   Tile titles ("Affiliations", "Méthodes", "Nouveau") carry the vermillion
   that the numerals used to. **No 01/02/03 numbering** — explicitly removed.

6. **Méthodes list** — flex row per item: label left, abbreviation (`ACM`,
   `ACP`, `—`, `—`) right, separated by dotted hairline. The two methods
   without abbreviations show an em-dash placeholder.

7. **Nouveau tile** — links to `/livres/cigda` (FR) / `/en/livres/cigda` (EN);
   title is italic Fraunces with a hairline `border-bottom` that flips to
   `--accent` on hover (same hover rule as the existing site nav).

## Astro integration

### 1. Content (`content/pages/home/{fr,en}.md`)

Split the home content into **structured frontmatter + markdown body**, the
same shape every other page uses:

- **Frontmatter** carries the presentational / data fields: the kicker text,
  the deck (one-line italic standfirst), the portrait reference, and the
  tile-strip data.
- **Markdown body** carries the bio prose. Astro's content-collection
  pipeline (`render(entry)` → `<Content />`) renders it the same way it
  renders every other route. No new dependency.

```yaml
---
title: "Brigitte Le Roux"
locale: fr
slug: "home"
description: "Page d'accueil de Brigitte Le Roux, chercheuse spécialiste de l'analyse géométrique des données."
page_layout: home                                       # selects HomeLayout. NOT "layout":
                                                        # Astro reserves "layout" in markdown
                                                        # frontmatter as a component import path.
kicker: "Analyse géométrique des données · Recherche"
deck_html: "Chercheuse en mathématiques. Analyse géométrique des données — MAP5,&nbsp;Université&nbsp;Paris&nbsp;Cité,<br>et CEVIPOF&nbsp;/&nbsp;CNRS."
portrait:
  src: "/img/photoweb.jpg"
  alt: "Brigitte Le Roux"
tiles:
  affiliations:
    title: "Affiliations"
    body_html: "MAP5 — Université Paris Cité<br>CEVIPOF / CNRS"
    note: "45 rue des Saints-Pères · 75270 Paris · Bureau 731-E"
  methodes:
    title: "Méthodes"
    items:
      - { label: "Analyse des correspondances multiples", ab: "ACM" }
      - { label: "Analyse en composantes principales",    ab: "ACP" }
      - { label: "Données structurées",                   ab: "—" }
      - { label: "Inférence combinatoire",                ab: "—" }
  nouveau:
    title: "Nouveau"
    book_title: "Combinatorial Inference in Geometric Data Analysis"
    book_href: "/livres/cigda"
    book_meta: "B. Le Roux & H. Rouanet — Chapman & Hall / CRC, 2019."
---

Les travaux de Brigitte Le Roux portent sur l'*analyse géométrique des données* (AGD) et ses applications, une approche à la croisée de la statistique multivariée, de la sociologie quantitative et de la science politique.

Affiliée au laboratoire [MAP5](http://map5.mi.parisdescartes.fr/) à l'Université Paris Cité (45 rue des Saints-Pères, bureau 731-E) et chercheuse associée au [CEVIPOF&nbsp;/&nbsp;CNRS](https://www.sciencespo.fr/cevipof/), elle développe et applique des méthodes de l'AGD à des objets relevant des sciences sociales.

Parmi les méthodes étudiées : l'analyse des correspondances multiples (ACM), l'analyse en composantes principales (ACP), l'analyse des données structurées et l'inférence combinatoire — méthode développée avec Henry Rouanet et exposée dans l'ouvrage *Combinatorial Inference in Geometric Data Analysis*.
```

The English counterpart (`en.md`) mirrors the structure with translated
labels, translated bio paragraphs in the markdown body, and `book_href:
"/en/livres/cigda"`. Specifically:

- `kicker: "Geometric Data Analysis · Research"`
- `deck_html` — translated, same `&nbsp;` + `<br>` widow-control rules.
- Bio paragraphs in the EN body — translated, same paragraph count and
  order so the drop-cap lands on the same paragraph.
- `tiles.affiliations.title` → `"Affiliations"`, `tiles.methodes.title` →
  `"Methods"`, `tiles.nouveau.title` → `"New"`.

Bio paragraphs use markdown: `*emphasis*` → `<em>`, `[label](url)` → `<a>`.
`&nbsp;` works as a literal HTML entity inside markdown. No markdown-string
renderer dependency needed — Astro's existing content-collection pipeline
(the same one every other page uses) renders the body.

### 2. Routing

`src/pages/[...slug].astro` already calls `getEntry('pages', …)` and renders
through `PageLayout`. Add a branch: when `entry.data.page_layout === 'home'`,
render `HomeLayout` instead. Same change in `src/pages/en/[...slug].astro`.

The discriminator field is **`page_layout`**, not `layout`. Astro 5 treats
`layout` in markdown frontmatter as a reserved key — it tries to resolve the
value as a layout component import path, and Vite fails the build. Schema,
route checks, and the home markdown files all use `page_layout`.

### 3. New component

`src/layouts/HomeLayout.astro` — wraps `BaseLayout`, takes the entry's
structured frontmatter plus the rendered `<Content />` component (passed
from the catch-all route) as props, and emits the full hero + tile strip
described above. Bio paragraphs are rendered by `<Content />` inside a
`.bio` wrapper; the drop-cap is selected via `.bio > p:first-of-type::first-letter`
(no class on the paragraph needed — first-of-type matches the first `<p>`
emitted by the markdown renderer).

### 4. Styles

Append a `home-oped` block to `src/styles/theme.css`, OR keep the rules in a
scoped `<style>` inside `HomeLayout.astro` (preferred — these rules are
home-only and don't belong in the global cascade). Reference: copy from
`/tmp/blr-home-mockups/C-opedwrap.html`, drop the duplicated tokens (they're
already in `:root`), and keep only:

- `.topkicker` + `.topkicker .bar`
- `.portrait` + `.portrait .mat` + `.portrait img`
- `h1.oped` + `h1.oped .it`
- `.deck` (with `text-wrap: balance`)
- `.body p` + `.body p.first::first-letter`
- `.clear`
- `.tiles` + `.tile` + `.tile .h` + `.tile p` + `.tile p.italic`
- `.methods` + `.methods .ab`
- `.nouveau h3`
- Responsive `@media (max-width: 780px)` block

The existing global selectors (`body`, `header.site`, `footer.site`, `body::before`,
the nav rules) are already correct — do not duplicate.

### 5. Container widths

The home page uses `max-width: 1100px` on `main.oped`, wider than the
default `820px` used by other pages. Add `<main class="oped">` (instead of the
default `<main class="container">`) in `HomeLayout`. Header + footer keep
their own max-widths.

### 6. Global widow fix

While editing `theme.css`, add to the existing `h1` rule:

```css
h1 { …; text-wrap: balance; }
```

Single-line addition. Benefits every page.

## Acceptance criteria

- [ ] On viewport ≥ 1100 px, the top edge of the portrait frame is on the
      exact same Y as the cap-line of "Brigitte".
- [ ] On any viewport, "CNRS" is never alone on its line; "CEVIPOF / CNRS"
      always renders as a single unbreakable unit; "MAP5, Université Paris
      Cité" is always on a separate visual line from the CEVIPOF line.
- [ ] At < 780 px, the portrait sits above the headline (no wrap), the tiles
      collapse to one column with hairlines between them, and the drop-cap
      shrinks to 64 px.
- [ ] The vermillion appears only in: kicker bar, kicker text, drop-cap, tile
      titles, method abbreviations, "Nouveau" link hover, active nav
      underline. No other element is vermillion.
- [ ] No new fonts loaded. No new colour tokens introduced. Existing
      `theme.css` variables only.
- [ ] French and English home pages structurally identical. Per-locale
      differences are confined to: `description`, `kicker`, `deck_html`, `bio`
      paragraphs, every `tiles.*.title` / `.body` / `.note` string, the four
      `methodes.items[].label`s, and `tiles.nouveau.book_href` (`/livres/cigda`
      vs `/en/livres/cigda`).
- [ ] `yarn build` succeeds; the home route renders at both `/` and `/en/`.
- [ ] `hreflang` alternates emitted for FR↔EN home (existing `BaseLayout`
      logic, unchanged).
- [ ] Other pages (Recherches, Thèse, …) are visually unchanged — the only
      route touched is `home`.

## Out of scope

- Restyling any other page. The op-ed treatment is home-only — other routes
  remain on the existing centred `.container` column. Reuse the new tile
  pattern elsewhere only if a future spec asks for it.
- Adding animations or motion. The original theme is print-like and motionless;
  do not introduce hover transitions, scroll effects, or page-load animations.
- Changing the existing markdown frontmatter shape for non-home pages.

## Decisions resolved during brainstorming

- **FR kicker** → `Analyse géométrique des données · Recherche`. Replaces
  the original mockup placeholder (`Portrait · Recherche · Paris`); the new
  line is a stronger brand statement that puts the research domain at the
  top of the page, where the editorial "section label" sits in the magazine
  convention this layout draws from.
- **EN kicker** → `Geometric Data Analysis · Research`. Direct translation,
  preserves the parallel structure between locales.
- **Bio wording** → ship the current 3-paragraph version as-is, no separate
  sign-off step. Content can be revised later in a content-only PR if needed.
- **Tile-strip order** → `Affiliations / Méthodes / Nouveau`, as already
  shown in the visual specification.

## Open questions

_None._ All design questions resolved.

## Reference artefacts

- Prototype (single-file HTML): `/tmp/blr-home-mockups/C-opedwrap.html`
- Image: `/tmp/blr-home-mockups/photoweb.jpg` (copy of `public/img/photoweb.jpg`)
- Sibling mockups (not chosen, kept for context):
  `/tmp/blr-home-mockups/A-masthead.html`, `B-folio.html`,
  `/tmp/blr-home-mockups/index.html`.
