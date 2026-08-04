/**
 * Manual performance baseline for the parser. Not part of `bun test` and
 * not a CI gate — timings are environment-dependent and noisy by nature.
 * Run directly: `bun run bench` (from `js/`) or `bun bench/index.ts`.
 * Add `--json` to print a single machine-readable JSON array of results
 * instead of the human-readable table (for saving/diffing baselines).
 *
 * Purpose: catch gross regressions (accidental O(n²) behavior, a dropped
 * fast path) across a few representative shapes — typical documents,
 * documents near each Core/References resource limit, and two scaling
 * sweeps (key count, reference count) to check for non-linear growth.
 *
 * Each named benchmark takes several independent timing samples (not just
 * one) and reports the median and p95 per-op time — a single sample is
 * easily skewed by GC pauses or OS scheduling noise, which would make a
 * genuine regression indistinguishable from run-to-run jitter.
 */

import { parseCore, parseReferences } from '../src/index'

const JSON_OUTPUT = Bun.argv.includes('--json')
const SAMPLES = 7

interface BenchResult {
	name: string
	iterations: number
	samples: number
	medianUs: number
	p95Us: number
	minUs: number
	maxUs: number
	opsPerSec: number
}

const results: BenchResult[] = []

/** No-ops under `--json` so the only stdout output is the final JSON array. */
function log(line: string): void {
	if (!JSON_OUTPUT) console.log(line)
}

function bench(name: string, fn: () => void, iterations: number): void {
	for (let i = 0; i < Math.min(iterations, 50); i++) fn() // warmup

	const perOpUs: number[] = []
	for (let s = 0; s < SAMPLES; s++) {
		const start = performance.now()
		for (let i = 0; i < iterations; i++) fn()
		perOpUs.push(((performance.now() - start) / iterations) * 1000)
	}
	perOpUs.sort((a, b) => a - b)

	const median = perOpUs[Math.floor(perOpUs.length / 2)]
	const p95 = perOpUs[Math.min(perOpUs.length - 1, Math.ceil(perOpUs.length * 0.95) - 1)]
	const min = perOpUs[0]
	const max = perOpUs[perOpUs.length - 1]
	const opsPerSec = 1_000_000 / median // median is in microseconds/op

	results.push({ name, iterations, samples: SAMPLES, medianUs: median, p95Us: p95, minUs: min, maxUs: max, opsPerSec })
	log(
		`${name.padEnd(60)} median ${median.toFixed(2).padStart(9)} us/op  ` +
			`p95 ${p95.toFixed(2).padStart(9)} us/op  ${opsPerSec.toFixed(0).padStart(9)} ops/sec`
	)
}

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
bench('typical document (9 keys, no refs) — parseReferences', () => parseReferences(typical), 20000)

const withRefs = `siteName: My Site
title: Hello ($siteName)!
byline: Written by ($author)
author: Alice
tagline: (%tagline)
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
	Array.from({ length: 20 }, (_, i) => `($k${i})`).join(' ') + '\n'
bench('one string interpolating 20 references', () => parseReferences(interpHeavy), 10000)

const bigPartial = Array.from({ length: 2000 }, (_, i) => i)
const partialHeavy = Array.from({ length: 16 }, (_, i) => `k${i}: (%big)`).join('\n') + '\n'
bench('16 refs to a ~2000-node partial (~32K result nodes)', () => parseReferences(partialHeavy, { partials: { big: bigPartial } }), 200)

// ── Scaling sweeps: growth should stay linear ────────────────────────────

log('\n--- key count (nested, short values to stay under the byte limit) ---')
for (const n of [100, 200, 400, 800, 1600]) {
	const doc = 'root:\n' + Array.from({ length: n }, (_, i) => `  k${i}: v${i}`).join('\n') + '\n'
	bench(`${n} nested keys`, () => parseCore(doc), Math.max(50, Math.floor(20000 / n)))
}

log('\n--- reference count (nested under one key, bypasses the 128 top-level-key limit) ---')
for (const n of [50, 100, 200, 400, 800, 1600, 3200]) {
	const doc = 'base: 42\nrefs:\n' + Array.from({ length: n }, (_, i) => `  k${i}: ($base)`).join('\n') + '\n'
	if (new TextEncoder().encode(doc).length > 65536) continue
	bench(`${n} backward references`, () => parseReferences(doc), Math.max(30, Math.floor(5000 / n)))
}

if (JSON_OUTPUT) console.log(JSON.stringify(results, null, 2))
