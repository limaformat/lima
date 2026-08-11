/**
 * Manual performance baseline for the parser. Not part of `bun test` and
 * not a CI gate — timings are environment-dependent and noisy by nature.
 * Run directly: `bun run bench` (from `js/`) or `bun bench/index.ts`.
 * Add `--json` to print a single machine-readable JSON array of results
 * instead of the human-readable table (for saving/diffing baselines).
 *
 * Purpose: catch gross regressions (accidental O(n²) behavior, a dropped
 * fast path) across a few representative shapes — typical documents,
 * documents near each Core/References resource limit, References
 * 2.0-specific shapes (direct references, an edge-limit chain, a shared
 * cache-relevant target, partial mapping-path traversal, a block-scalar
 * continuation), and two scaling sweeps (key count, reference count) to
 * check for non-linear growth.
 *
 * Each named benchmark takes several independent timing samples (not just
 * one) and reports the median and p95 per-op time — a single sample is
 * easily skewed by GC pauses or OS scheduling noise, which would make a
 * genuine regression indistinguishable from run-to-run jitter.
 */

import { parse, parseCore, parseReferences } from '../src/index'
import { createBench, log, JSON_OUTPUT, type BenchResult } from './helpers'

const results: BenchResult[] = []
const bench = createBench(results)

// ── Typical documents ────────────────────────────────────────────────────

const typical = `title: My Blog Post
slug: my-blog-post
date: 2024-03-01T09:00:00Z
draft: false
author: Alice
tags: [javascript, webdev, tutorial]
excerpt: A short excerpt about the post, nothing fancy.
readingTime: 4.5
category: Engineering
`
bench('typical document (9 keys, no refs) — parseCore', () => parseCore(typical), 20000)
const coreMode = { mode: 'core' as const }
bench('typical document (9 keys, no refs) — parse core mode', () => parse(typical, coreMode), 20000)
bench('typical document (9 keys, no refs) — parse References', () => parse(typical), 20000)
bench('typical document (9 keys, no refs) — deprecated alias', () => parseReferences(typical), 20000)

const withRefs = `siteName: My Site
title: Hello $(siteName)!
byline: Written by $(author)
author: Alice
tagline: $(:tagline)
`
bench('small document, 3 refs + 1 partial', () => parseReferences(withRefs, { partials: { tagline: 'Welcome' } }), 20000)

// ── Near each resource limit ─────────────────────────────────────────────

const nearSizeLimit =
	'value: ' + 'x'.repeat(16384) + '\n' +
	Array.from({ length: 3 }, (_, i) => `k${i}: ` + 'y'.repeat(16000)).join('\n') + '\n'
bench(`near document-size limit (${new TextEncoder().encode(nearSizeLimit).length}B)`, () => parseCore(nearSizeLimit), 2000)

const deepInput = 'a:\n' + Array.from({ length: 15 }, (_, i) => '  '.repeat(i + 1) + 'k:\n').join('') + '  '.repeat(16) + 'leaf: v\n'
bench('max nesting depth (16 levels)', () => parseCore(deepInput), 20000)

const manyKeys = Array.from({ length: 128 }, (_, i) => `k${i}: value${i}`).join('\n') + '\n'
bench('128 top-level keys (Core boundary)', () => parseCore(manyKeys), 5000)

const wideArray = 'items:\n' + Array.from({ length: 1000 }, (_, i) => `  - item${i}`).join('\n') + '\n'
bench('wide block array (1000 items)', () => parseCore(wideArray), 2000)

const interpHeavy =
	Array.from({ length: 20 }, (_, i) => `k${i}: v${i}`).join('\n') + '\nsummary: ' +
	Array.from({ length: 20 }, (_, i) => `$(k${i})`).join(' ') + '\n'
bench('one string interpolating 20 references', () => parseReferences(interpHeavy), 10000)

const bigPartial = Array.from({ length: 2000 }, (_, i) => i)
const partialHeavy = Array.from({ length: 16 }, (_, i) => `k${i}: $(:big)`).join('\n') + '\n'
bench('16 refs to a ~2000-node partial (~32K result nodes)', () => parseReferences(partialHeavy, { partials: { big: bigPartial } }), 200)

// ── References 2.0-specific shapes ───────────────────────────────────────
// Targeted scenarios the general-shape benchmarks above don't isolate:
// a single direct reference paired with a structurally equivalent no-ref
// document, a chain sitting exactly at the three-edge limit
// (References §4.2), repeated references to one non-trivial shared target
// (exercises resolveNode's per-(node, remainingEdges) cache — a repeated
// reference to a bare scalar never reaches the cacheable branch at all, so
// the reference-count sweep further below does not cover this path),
// dotted mapping-path traversal into a partial (References §3.1, new in
// 2.0), and a block scalar whose reference sits after a `^^` continuation
// line (Core §6.1.6), which is the one shape that pays for the
// StringSourceSpan bookkeeping in the annotated builder (js/src/scalars.ts,
// js/src/core.ts) — parseCore's native builder never computes spans.

const directRefBaseline = 'source: 42\ncopy: source\n'
const directRef = 'source: 42\ncopy: $(source)\n'
bench('two-key document without references (direct-ref baseline)', () => parse(directRefBaseline), 20000)
bench('single direct document reference', () => parse(directRef), 20000)

const threeEdgeChain = 'a: $(b)\nb: $(c)\nc: $(d)\nd: 42\n'
bench('reference chain at the three-edge limit (a->b->c->d)', () => parse(threeEdgeChain), 20000)

const sharedMappingTarget =
	'chainRoot:\n  a: 1\n  b: 2\n  c: 3\ntarget: $(chainRoot)\nrefs:\n' +
	Array.from({ length: 200 }, (_, i) => `  k${i}: $(target)`).join('\n') + '\n'
bench('200 references to the same one-hop mapping target (cache-relevant)', () => parse(sharedMappingTarget), 500)

const partialMappingPath = 'city: $(:person.address.city)\n'
const partialMappingPathValue = { person: { address: { city: 'London', zip: '10001' }, name: 'Ada' } }
bench('partial mapping-path traversal ($(:person.address.city))', () => parse(partialMappingPath, { partials: partialMappingPathValue }), 20000)

const blockScalarWithContinuation =
	'author: Alice\ndescription: |\n  Written by $(author) and\n  ^^edited by the team,\n  ^^published $(status).\nstatus: today\n'
bench('block scalar, refs after a ^^ continuation (source-span tracking)', () => parse(blockScalarWithContinuation), 20000)

const mostlyReferenceFree =
	'source: 42\nroot:\n' +
	Array.from({ length: 80 }, (_, group) =>
		`  group${group}:\n` + Array.from({ length: 10 }, (_, i) => `    inert${i}: value${group}_${i}`).join('\n')
	).join('\n') +
	'\n  active:\n    copy: $(source)\n'
bench('mostly reference-free tree, one nested reference — parseCore', () => parseCore(mostlyReferenceFree), 500)
bench('mostly reference-free tree, one nested reference — parse', () => parse(mostlyReferenceFree), 500)

// ── Scaling sweeps: growth should stay linear ────────────────────────────

log('\n--- key count (nested, short values to stay under the byte limit) ---')
for (const n of [100, 200, 400, 800, 1600]) {
	const doc = 'root:\n' + Array.from({ length: n }, (_, i) => `  k${i}: v${i}`).join('\n') + '\n'
	bench(`${n} nested keys`, () => parseCore(doc), Math.max(50, Math.floor(20000 / n)))
}

log('\n--- reference count (nested under one key, bypasses the 128 top-level-key limit) ---')
for (const n of [50, 100, 200, 400, 800, 1600, 3200]) {
	const doc = 'base: 42\nrefs:\n' + Array.from({ length: n }, (_, i) => `  k${i}: $(base)`).join('\n') + '\n'
	if (new TextEncoder().encode(doc).length > 65536) continue
	bench(`${n} backward references`, () => parseReferences(doc), Math.max(30, Math.floor(5000 / n)))
}

if (JSON_OUTPUT) console.log(JSON.stringify(results, null, 2))
