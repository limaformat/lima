/**
 * Performance comparison against js-yaml, Core only (no References/
 * partials — js-yaml has no equivalent concept, so comparing those would
 * not be an apples-to-apples comparison). Not part of `bun test` and not a
 * CI gate — see bench/helpers.ts. Run: `bun run bench:vs-yaml` (from
 * `js/`) or `bun bench/vs-yaml.ts`. Add `--json` for machine-readable
 * output.
 *
 * Purpose: js-yaml is a natural comparison point since Lima positions
 * itself as a simpler frontmatter alternative to YAML (see the project
 * README's "Why not YAML?" section) — this quantifies the parsing-speed
 * side of that tradeoff on realistic frontmatter-shaped documents. This is
 * NOT a compatibility or conformance check: Lima is deliberately not
 * YAML-compatible (no anchors/aliases, no `>` folded block scalar, its own
 * scalar-coercion and date rules), so differing *output* between the two
 * parsers on the same input is expected and irrelevant here — only
 * relative parse time is being compared.
 */

import { parseCore } from '../src/index'
import { load } from 'js-yaml'
import { log, JSON_OUTPUT, type BenchResult } from './helpers'

const results: BenchResult[] = []
const SAMPLES = 25

function time(fn: () => void, iterations: number): number {
	const start = performance.now()
	for (let i = 0; i < iterations; i++) fn()
	return ((performance.now() - start) / iterations) * 1000
}

function result(name: string, samples: number[], iterations: number): BenchResult {
	samples.sort((a, b) => a - b)
	const medianUs = samples[Math.floor(samples.length / 2)]
	const p95Us = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]
	return {
		name, iterations, samples: samples.length, medianUs, p95Us,
		minUs: samples[0], maxUs: samples[samples.length - 1], opsPerSec: 1_000_000 / medianUs,
	}
}

function print(r: BenchResult): void {
	log(
		`${r.name.padEnd(60)} median ${r.medianUs.toFixed(2).padStart(9)} us/op  ` +
		`p95 ${r.p95Us.toFixed(2).padStart(9)} us/op  ${r.opsPerSec.toFixed(0).padStart(9)} ops/sec`
	)
}

function compare(name: string, doc: string, iterations: number): void {
	const parseLima = (): void => { parseCore(doc) }
	const parseYaml = (): void => { load(doc) }
	for (let i = 0; i < Math.min(iterations, 1000); i++) { parseLima(); parseYaml() }
	const limaSamples: number[] = []
	const yamlSamples: number[] = []
	const speedups: number[] = []
	for (let sample = 0; sample < SAMPLES; sample++) {
		// Alternating which parser runs first prevents systematic order bias
		// from JIT state, CPU frequency changes, and background load.
		let limaUs: number, yamlUs: number
		if (sample % 2 === 0) {
			limaUs = time(parseLima, iterations)
			yamlUs = time(parseYaml, iterations)
		} else {
			yamlUs = time(parseYaml, iterations)
			limaUs = time(parseLima, iterations)
		}
		limaSamples.push(limaUs)
		yamlSamples.push(yamlUs)
		speedups.push(yamlUs / limaUs)
	}
	const lima = result(`${name} — Lima (parseCore)`, limaSamples, iterations)
	const yaml = result(`${name} — js-yaml (load)`, yamlSamples, iterations)
	results.push(lima, yaml)
	print(lima)
	print(yaml)
	speedups.sort((a, b) => a - b)
	log(`  → paired speedup min ${speedups[0].toFixed(2)}x, median ${speedups[Math.floor(speedups.length / 2)].toFixed(2)}x, max ${speedups[speedups.length - 1].toFixed(2)}x\n`)
}

// ── Representative frontmatter-shaped documents (Core-only) ─────────────

compare(
	'typical blog post (9 keys, flat)',
	`title: My Blog Post
slug: my-blog-post
date: 2024-03-01T09:00:00Z
draft: false
author: Alice
tags: [javascript, webdev, tutorial]
excerpt: A short excerpt about the post, nothing fancy.
readingTime: 4.5
category: Engineering
`,
	20000
)

compare(
	'nested author + block array of tags',
	`title: My Blog Post
date: 2024-03-01
draft: false
author:
  name: Alice
  email: alice@example.com
tags:
  - javascript
  - webdev
  - tutorial
`,
	20000
)

compare(
	'SEO-heavy frontmatter (nested mapping, many string fields)',
	`title: My Blog Post
description: A longer description used for SEO meta tags and social previews.
seo:
  title: My Blog Post | My Site
  description: A longer description used for SEO meta tags and social previews.
  image: /images/my-blog-post/cover.png
  canonical: https://example.com/blog/my-blog-post
social:
  twitter: "@example"
  ogType: article
`,
	20000
)

compare(
	'wide block array (50 tags)',
	'tags:\n' + Array.from({ length: 50 }, (_, i) => `  - tag${i}`).join('\n') + '\n',
	10000
)

compare(
	'list of author objects (block sequence of mappings)',
	'authors:\n' +
		Array.from({ length: 10 }, (_, i) => `  - name: Author ${i}\n    email: author${i}@example.com`).join('\n') +
		'\n',
	10000
)

compare(
	'many scalar keys, mixed types (50 keys)',
	Array.from({ length: 50 }, (_, i) =>
		i % 4 === 0 ? `key${i}: ${i}` : i % 4 === 1 ? `key${i}: value ${i}` : i % 4 === 2 ? `key${i}: ${i % 2 === 0}` : `key${i}: 2024-0${(i % 9) + 1}-01`
	).join('\n') + '\n',
	10000
)

if (JSON_OUTPUT) console.log(JSON.stringify(results, null, 2))
