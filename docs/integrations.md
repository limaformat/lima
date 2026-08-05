# Static site generator integration status

An honest account of what's actually possible, and what actually exists,
for using Lima frontmatter with common static site generators — as of this
writing, **no SSG adapter ships from this repository**. Everything below
is either "directly buildable using an official extension point" or
"needs upstream/deeper work"; nothing here is a claim that Lima frontmatter
already works out of the box in any of these tools.

## Terminology used below

- **Native** — the tool's own core parses Lima directly. None of the four
  below are native today.
- **Official adapter** — a plugin/package maintained by (or formally
  endorsed in the docs of) the SSG project itself.
- **Community adapter** — a third-party plugin, not maintained or endorsed
  by the SSG project.
- **Preprocessor** — a build step that runs before the SSG, converting
  Lima frontmatter to a format the SSG already understands (YAML/JSON),
  independent of the SSG's own extension points.
- **Planned** — designed here, not yet built anywhere.

No adapter in any of these categories exists yet for any of the four tools
below — every row is currently "planned," differing only in how direct the
path to something better is.

## Support matrix

| SSG | Today | Nearest realistic path | Longer term |
|---|---|---|---|
| [Eleventy](#eleventy) | None | Custom parsing engine via an official, documented extension point | — (the official path already reaches full integration) |
| [Astro](#astro) | None | Custom Content Loader for a *new* collection type | Deeper adapter needed for ordinary `.md` files — see below |
| [Hugo](#hugo) | None | Preprocessor (convert Lima → YAML before Hugo runs) | Go port of a Lima parser, then upstream support in Hugo itself |
| [Jekyll](#jekyll) | None | Preprocessor (same idea) — but see the GitHub Pages caveat | Ruby port, then a Jekyll-core or plugin-based integration |

## Eleventy

**Directly feasible via an official extension point** — Eleventy exposes
`eleventyConfig.setFrontMatterParsingOptions({ engines: { ... } })`, and
its underlying front-matter library (`gray-matter`) already supports
selecting an engine by a language tag on the opening fence (`---toml`
instead of plain `---`), demonstrated in Eleventy's own docs with a TOML
example. A `lima` engine could plug into exactly the same mechanism.

Official documentation: [Eleventy — Customize Front Matter
Parsing](https://www.11ty.dev/docs/data-frontmatter-customize/).

This repository does not yet ship such an adapter. [Block
8](#eleventy-prototype-status) below is a design-only prototype for one —
not implemented, pending confirmation of the exact fence convention (see
[`docs/decisions/`](decisions/)).

## Astro

**Partially feasible, with a real gap for ordinary Markdown files.** Astro
publishes an official [Content Loader
API](https://docs.astro.build/en/reference/content-loader-reference/) for
building custom collection loaders, including a `file()` loader that
accepts a custom `parser()` function for non-standard file formats — a
real, official extension point.

The gap: for regular `.md` files processed through Astro's built-in
content pipeline, frontmatter is parsed by Astro's own YAML/TOML handling
*before* a loader or renderer ever sees the raw file — the documented
Content Loader API doesn't expose a hook to intercept or replace that
step. A working Lima integration for ordinary Markdown content would need
either a custom loader that reads and parses files itself end-to-end
(bypassing Astro's own frontmatter step entirely, including its Markdown
rendering), or upstream support in Astro for a pluggable frontmatter
parser — a materially deeper adapter than Eleventy's.

Official documentation: [Astro — Content Loader
API](https://docs.astro.build/en/reference/content-loader-reference/),
[Astro — Content
Collections](https://docs.astro.build/en/guides/content-collections/).

## Hugo

**No plugin mechanism exists.** Hugo's own documentation is explicit:
front matter is "JSON, TOML, or YAML," identified by fixed delimiters
(`---`, `+++`, or a bare `{`/`}` JSON object) — there is no documented
extension point, Go plugin interface, or custom-parser registration for
front matter formats. Hugo ships as a single compiled Go binary; this
isn't a documentation gap, it's a consequence of the architecture.

Official documentation: [Hugo — Front
matter](https://gohugo.io/content-management/front-matter/).

Realistic near-term path: a preprocessor that converts Lima frontmatter to
YAML before Hugo builds — external to Hugo, no Hugo-side change needed,
works today in principle (not built here). Long-term: a Go implementation
of the Lima grammar, then a case made to the Hugo project for a pluggable
front matter format — a multi-stage, upstream-dependent effort, not
something this repository can deliver alone.

## Jekyll

**YAML-only, no custom-parser extension point documented**, and a
deployment-specific complication worth calling out explicitly: Jekyll's
own docs state front matter "must take the form of valid YAML." Jekyll
does have a general plugin system, but nothing in its documentation
describes a hook for registering an alternative front matter format.

Official documentation: [Jekyll — Front
Matter](https://jekyllrb.com/docs/front-matter/), [Jekyll —
Plugins](https://jekyllrb.com/docs/plugins/).

**GitHub Pages caveat**: even if a Jekyll plugin existed, GitHub Pages
builds run Jekyll with `--safe`, which disables all plugins except a
small, fixed, version-locked whitelist bundled in the `github-pages` gem —
a custom Lima plugin would not run on GitHub Pages' own build
infrastructure regardless of how it's built. A site on GitHub Pages wanting
Lima frontmatter would need to build locally (or via GitHub Actions) and
publish the generated static output, not rely on GitHub's native Jekyll
build.

Realistic near-term path: same preprocessor idea as Hugo. Long-term: a
Ruby port, then either a Jekyll-core proposal or a plugin distributed
outside the GitHub Pages default whitelist (usable for self-hosted or
Actions-based Jekyll builds, not GitHub's native build).

## Eleventy prototype status

A minimal adapter design (not an implementation) exists as a proposal in
the documentation-overhaul final report, verified against gray-matter's
actual source (`lib/parse.js`, `lib/engine.js`) and Eleventy's current
stable documentation, not just its prose README — including the exact
input/output contract the engine function must satisfy. No Eleventy
version is installed in this repository to test against directly; the
design should be re-verified against whatever Eleventy version a real
integration actually targets before any code is written, and is withheld
pending confirmation of the fence convention in
[`docs/decisions/`](decisions/).

## Related

- [`docs/decisions/`](decisions/) — the fence-recognition convention
  (`---lima` or otherwise) that every one of these adapters needs settled
  first; see the rationale for why that decision comes before any single
  vendor's adapter work.
- [`docs/migrating-from-yaml.md`](migrating-from-yaml.md) — for projects
  already on one of these SSGs, deciding whether migrating existing
  frontmatter is worthwhile independent of adapter availability.
