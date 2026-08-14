# Word-count methodology

Reproduces the "Numbers instead of adjectives" comparison in `README.md` and
on the limaformat.dev homepage: specification word counts, and
implementation code/comment word counts for Lima vs. js-yaml.

No script for this existed before this one — the original 2026 numbers were
reconstructed from a documented methodology (README's "How much smaller,
actually" section) and calibrated exactly against them (see below) before
being trusted for a References-2.0-era recount. Losing the tool again would
mean repeating that reconstruction.

## Rules

- **Word count**, not lines — `wc -w`-equivalent whitespace tokenization.
- **Code and comments counted separately** — comment density is an authoring-
  style choice, not a grammar-complexity signal; conflating the two would let
  whichever project comments less look artificially smaller.
- **AST-based comment/code split, never regex** — a comment is whatever
  `ts.getLeadingCommentRanges` attaches to a token.
- **Hand-authored source only** — never a bundled/minified/generated build.
  Lima: `js/src/`. js-yaml: its own `src/`, never `dist/`.
- **Core vs. References: actual imports, not file boundaries.** A shared
  file (`value.ts`, `core.ts`, `scalars.ts`) contributes only the top-level
  declarations a given entry point actually reaches — not the whole file.
- **js-yaml scope: `load()`'s transitive imports only** — parser,
  constructor, schema, tag resolvers under the default `CORE_SCHEMA`. Not
  `dump()`/serialization (Lima has no equivalent), not the `dist/` bundle
  (bundler boilerplate and stripped comments would bias the comparison), not
  the `legacy_map.ts`/`real_map.ts` tag variants `CORE_SCHEMA` doesn't use.
- **Spec word counts**: `wc -w` on the raw specification Markdown.

## Running it

```bash
# from js/
bun run wordcount -- --manifest scripts/wordcount.manifest.json --bucket lima-core-1.0
bun run wordcount -- --manifest scripts/wordcount.manifest.json --bucket lima-references-2.0-additions

# js-yaml: not vendored in this repo — clone the exact pinned tag first
git clone --depth 1 --branch 5.2.3 https://github.com/nodeca/js-yaml.git /tmp/js-yaml-5.2.3
bun run wordcount -- --manifest scripts/wordcount.manifest.json --bucket js-yaml-load --root /tmp/js-yaml-5.2.3/src

# spec word counts
wc -w ../docs/lima-core-1.0-spec.md ../docs/lima-references-2.0-spec.md
```

`lima-core-1.0` and `lima-references-2.0-additions` are additive: the
"Lima Core + References 2.0" column is their sum, not `lima-core-1.0`
counted twice. `lima-references-2.0-additions` deliberately excludes the
References-1.0-only internals of `references.ts` (`resolveTree`,
`isReferenceFreeP`, its own `parseReferences`, etc.) — those ship internally
for the frozen 1.0 conformance suite but are not reachable from the current
public API (`references2.ts`'s `parse`/`parseReferences`), so they aren't
part of "the current public implementation" this table measures.

## Current reproduced values

| Measurement | Words |
|---|---:|
| Lima Core 1.0 specification | 7,602 |
| Lima References 2.0 specification | 2,968 |
| Lima Core implementation code | 6,954 |
| Lima Core implementation comments | 2,940 |
| Lima References 2.0 additions code | 3,489 |
| Lima References 2.0 additions comments | 1,127 |

## Calibration

No word-count script was ever committed before this one (verified via
`git log --all --diff-filter=A --name-only`), so this one was built from
scratch and validated against the historical, documented numbers before
being trusted:

| | Documented (pre-References-2.0) | This tool |
|---|---:|---:|
| Lima Core, code (at commit `a297814`) | 5,292 | 5,292 |
| Lima Core, comments (at commit `a297814`) | 2,398 | 2,398 |
| js-yaml 5.2.3, code | 11,787 | 11,787 |
| js-yaml 5.2.3, comments | 2,144 | 2,144 |
| YAML 1.2.2 spec (words) | 21,961 | 21,961 |
| JSON/RFC 8259 spec (words) | 3,998 | 3,998 |
| TOML spec (words) | 4,254 | 4,254 |

All exact matches. The js-yaml/YAML/JSON/TOML rows are pinned, external
sources independent of Lima's own history, so they're reproducible today
exactly as run with the commands above. The two Lima Core rows needed
`js/src/` as it existed at commit `a297814` (the last commit to touch these
numbers) — reconstructed as a `lima-core-1.0`-shaped bucket by hand, not
re-run automatically, since that historical file layout no longer exists on
disk to point `--root` at.

## Judgment calls without a historical precedent

The current codebase has a dual-builder split (`nativeBuilder` in
`core.ts`, used by `parseCore()`, vs. `positionedBuilder` in `scalars.ts`,
used only by `parseCoreWithPositions()`, which only the References layer
calls) that didn't exist at the calibration commit — there was a single
unified builder there, so `parseCore()` itself used to build via the same
`LimaValue` constructors (`LNull`/`LBool`/...) that are now References-only.
Applying the documented "actual imports, not file boundaries" rule to this
newer architecture is a first-time application, not a re-derivation of an
already-calibrated case:

- `depthOfPositioned`, `parseCoreWithPositions`, `toNativeFromPositioned`,
  `positionedBuilder`, `hasActiveReferences2` moved from Core to the
  References-2.0-additions bucket — none are reachable from `parseCore()`.
- `toNative` (in `core.ts`) is excluded from **both** buckets — it's dead
  code (no caller anywhere, including tests), the same treatment the
  original methodology gave `isScalar`/`deepCopy`/`computeDepth` when they
  were discovered unused (commit `a297814`). Not fixed in `core.ts` itself
  here — flagged as a separate finding for whoever next touches that file.
- `core.ts`'s and `index.ts`'s module doc comments describe more than one
  entry point at once (Core and References together) and aren't cleanly
  attributable to one bucket — excluded from both, the same way `index.ts`'s
  doc comment turned out to be excluded in the calibration (only its bare
  `export { parseCore, ... }` line counted towards Core, not the file's
  explanatory comment above it). `core.ts`'s `parseCoreGeneric` has the same
  problem one level down — its own doc comment, not the module one —
  handled via `stripComments` in the manifest.

These are reasoned, but not independently calibrated. Revisit if the
dual-builder split changes shape again.

## Package size

Not scripted — run `bun run build`, then `bun pm pack --destination <dir>`
for Lima. The resulting 0.3.1 tarball is 42,874 bytes (42.9 KB), and `js/dist`
must still match the committed output. The published js-yaml 5.2.3 tarball is
338 KB; registry tarballs for a released version are immutable.
