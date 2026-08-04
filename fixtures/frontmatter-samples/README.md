# Frontmatter samples

Hand-authored, not scraped — each file is written to match a real
static-site-generator/CMS convention (Jekyll, Hugo, Astro, Next.js/MDX,
Docusaurus, Eleventy, Gatsby-style headless CMS, generic docs sites) as it
is actually used in the wild, not a synthetic worst case. Plain YAML text
(no `---` delimiters, no surrounding Markdown body) — each file is exactly
what would sit between the frontmatter fences.

Two current consumers:

- `js/bench/vs-yaml.ts` — performance comparison, Lima `parseCore` vs
  `js-yaml`'s `load`, Core-only (no References/partials — js-yaml has no
  equivalent concept).
- A planned YAML/Lima divergence report (see project planning) — same
  files, but comparing *output*, not speed: where do the two parsers
  produce the same result on realistic input, and where — and why — do
  they genuinely differ?

Deliberately included, not avoided: constructs where Lima and YAML are
known or suspected to diverge — finding real divergences on realistic
input is the point of file 2 above. Verified so far (spot-checked, not
exhaustive — the planned divergence report covers all 16 systematically):
`14-special-characters-quoted`'s YAML `''` doubled-single-quote escape is
a genuine divergence (js-yaml unescapes it to `'`, Lima's single-quote
handling only recognises `\'` and keeps `''` literal — Core §6.1.3).
`01-jekyll-minimal`'s space-separated datetime is NOT a divergence as it
turns out — js-yaml's default schema leaves it as a string too, same as
Lima; kept in the corpus anyway as a realistic Jekyll-style shape. None of
the 16 files make Lima's `parseCore` throw. See each file for what it's
chosen to exercise:

| File | Convention | Notable construct |
|---|---|---|
| `01-jekyll-minimal` | Jekyll | space-separated date + UTC offset |
| `02-hugo-post` | Hugo | block sequences, `draft` flag |
| `03-astro-content-collection` | Astro content collections | plain ISO dates |
| `04-nextjs-mdx-post` | Next.js/MDX | nested `author`/`ogImage` mappings |
| `05-docusaurus-doc` | Docusaurus docs | flow sequence of keywords |
| `06-eleventy-post` | Eleventy | permalink path with slashes |
| `07-gatsby-contentful-style` | Headless CMS | nested `seo` mapping, ISO datetimes |
| `08-multi-author-collaborative` | — | block sequence of mappings + flow sequence |
| `09-docs-page-non-blog` | Generic docs | non-blog shape (`order`, `deprecated`) |
| `10-recipe-structured-content` | — | numeric-heavy nested mapping |
| `11-minimal-title-only` | — | smallest possible realistic case |
| `12-seo-social-heavy` | — | deeply nested `openGraph`/`twitter` |
| `13-boolean-flags-heavy` | Hugo/Docusaurus-style config | many boolean scalars |
| `14-special-characters-quoted` | — | `\"` escape, YAML `''` vs Lima `\'` |
| `15-flow-style-compact` | — | flow mappings/sequences, URL value |
| `16-long-description-block-scalar` | — | `\|` block scalar body |
