# Decision: how should a Lima frontmatter block be recognised?

**Status: proposed, not decided.** This is a recommendation for the
maintainer to confirm or reject — nothing described here is implemented.
It does not change [Lima Core 1.0](../lima-core-1.0-spec.md) or [Lima
References 1.0](../lima-references-1.0-spec.md), both of which define
Lima's *content* grammar and have nothing to say about how a host document
signals which parser to use for a `---`-delimited block in the first
place. That signalling problem is what this document is about.

## The problem

Every SSG researched in [`docs/integrations.md`](../integrations.md)
already treats a bare `---...---` block as YAML (or, for Hugo, one of
YAML/TOML/JSON by delimiter). If a Lima document is dropped into an
existing project unchanged, one of two things happens: the host tool's
YAML parser either rejects genuinely-Lima-only syntax outright, or — the
more dangerous case — silently *accepts* it, because Lima is a subset of
YAML block syntax and most real Lima documents are also syntactically
valid, if differently-typed, YAML. A `01.03.2024` date, for instance,
parses as a plain string under YAML and as a `Date` under Lima (see
[`docs/migrating-from-yaml.md`](../migrating-from-yaml.md)) — no error,
just a silently different value. **Without an explicit signal, exactly the
deterministic behaviour Lima exists to provide gets lost the moment
content crosses into a tool that doesn't know Lima exists.**

## Options considered

### A. `---lima` tagged fence

```
---lima
title: My First Post
---
```

Not a new idea — `gray-matter` (Eleventy's underlying front-matter parser,
also used by Metalsmith, Gatsby, Astro-adjacent tooling, and others)
already implements exactly this convention for TOML, JSON, and custom
engines, selecting a parser by the word immediately following `---` on the
opening delimiter line, demonstrated with a TOML example in [Eleventy's
own docs](https://www.11ty.dev/docs/data-frontmatter-customize/).

- **Backward compatibility:** Full. Existing plain `---` YAML content is
  completely untouched; only newly-tagged blocks opt in.
- **Misinterpretation risk:** Low for gray-matter-based tools specifically
  — confirmed that gray-matter **throws a loud "engine is not registered"
  error** for an unrecognised tag rather than silently falling through to
  YAML parsing, so a `---lima` block on a project without a Lima engine
  installed fails the build immediately, not silently. Unverified for
  tools whose frontmatter detection isn't gray-matter-based (Hugo, Jekyll)
  — needs a concrete per-vendor check before relying on it there; a tool
  matching `---` with a loose "starts with dashes" regex could behave
  differently than one requiring an exact match. Flagged as a residual
  risk, not assumed safe universally.
- **Vendor effort:** Lowest of all four options for any tool that already
  has gray-matter's tagged-engine convention (Eleventy today; anything
  else built on gray-matter by extension). Tools without an equivalent
  hook (Hugo, Jekyll) get no benefit from this specific convention and
  need the same adapter/preprocessor work regardless of which convention
  is chosen for them.

### B. Project-wide configuration (override the default engine)

Instead of tagging individual files, tell the build tool "parse *all*
`---` blocks as Lima" once, at the project level — e.g. Eleventy's
`setFrontMatterParsingOptions({ engines: { yaml: limaEngine } })`,
replacing the default YAML engine rather than adding a new tagged one.

- **Backward compatibility:** Conditional. Safe only after confirming
  every existing document in the project is genuinely Lima-compatible —
  exactly the audit-first workflow already described in
  [`docs/migrating-from-yaml.md`](../migrating-from-yaml.md#migrating-step-by-step).
  Not safe for a project with a long tail of unaudited or intentionally
  YAML-only content.
- **Misinterpretation risk:** No per-file ambiguity (nothing to tag,
  nothing to misdetect), but the risk moves up a level: a future
  contributor unaware the project switched engines could add genuinely
  YAML-only syntax and get a silent Lima fallback (a string instead of an
  error) rather than a loud failure, unless strict mode plus a CI check is
  also in place.
- **Vendor effort:** Depends entirely on whether the tool exposes a
  "replace the default engine" hook at all — confirmed available for
  Eleventy; no equivalent surface found for Hugo or Jekyll.

Not a competing primary recommendation — a reasonable *complementary*
option for projects that have already fully audited and migrated, on
tools that support an engine-override hook.

### C. Dedicated file extension (e.g. `.lima.md`)

- **Backward compatibility:** Full for existing `.md` files, but adopting
  it means renaming every file that opts in — more disruptive than either
  fence-based option, and risks breaking permalinks/routes in tools that
  derive URLs from filenames unless the tool has explicit support for
  custom extension-to-route mapping.
- **Misinterpretation risk:** Lowest of the four in one specific sense —
  a tool that doesn't recognise the extension typically won't process the
  file at all (most SSGs glob specific extensions), so the failure mode is
  "ignored," not "misparsed." No silent wrong-type-coercion risk.
- **Vendor effort:** Requires the tool to support custom extension
  registration, which varies significantly (Eleventy and Astro have some
  support for this; Hugo's content-type handling is more rigid). Higher
  ceremony for adopters than a fence tag either way, and doesn't help
  Hugo/Jekyll any more than option A does.

### D. Automatic content-based detection

Guess whether a `---` block is YAML or Lima by sniffing its content, with
no explicit marker at all.

- **Rejected outright**, not seriously weighed against the other three.
  Lima's own design explicitly avoids exactly this kind of implicit,
  schema-guessing behaviour — "no schema selection required for
  consistent behaviour... Lima has exactly one behaviour, always" is one
  of Lima's stated advantages over YAML (root README, "What a smaller
  grammar buys"). Because Lima is a deliberate *subset* of YAML block
  syntax, the two grammars overlap too heavily for content sniffing to
  reliably disambiguate — a large fraction of real Lima documents are also
  syntactically valid YAML, just with different resulting types, which is
  precisely the silent-divergence problem this whole document exists to
  prevent. Adopting auto-detection would reintroduce the exact class of
  non-determinism Lima was built to remove.

## Recommendation

**Primary: the `---lima` tagged fence (option A).** It's backward
compatible, requires no file renames, fails loud rather than silent on at
least one already-verified real target (Eleventy/gray-matter), and needs
no upstream vendor change for any tool already on gray-matter's
convention. Project-wide configuration (option B) is a reasonable
secondary convention for individual projects that have completed a full
audit and are on a tool that supports an engine-override hook — not a
replacement for the tagged-fence default. Dedicated extensions (option C)
remain a fallback worth considering specifically for tools that support
custom extension routing better than engine tagging. Automatic detection
(option D) is not recommended under any circumstance.

Before this becomes the actual convention: verify option A's fail-loud
behaviour (or find its actual failure mode) on Hugo and Jekyll
specifically, not just Eleventy/gray-matter — both currently have no
adapter path at all (per
[`docs/integrations.md`](../integrations.md#hugo)), so the convention
question is moot for them until a preprocessor or upstream integration
exists regardless, but it's still worth knowing in advance rather than
discovering it mid-implementation.

**Not implemented pending maintainer confirmation.** No code in this
repository currently recognises or emits `---lima`.
