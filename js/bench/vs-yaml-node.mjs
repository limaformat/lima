/**
 * Node.js counterpart to `vs-yaml.ts`. Same scenarios, same alternating-
 * order sampling methodology — see that file's header for rationale. Not
 * part of `bun test`/CI, not run per performance round by default; a
 * deliberately lighter tool for occasional Bun-vs-Node sanity checks (see
 * the 2026-08 performance round discussion).
 *
 * Runs against the built `dist/` output, not `src/`, because Node has no
 * built-in equivalent of Bun's direct TypeScript resolution for
 * extensionless relative imports. Run `bun run build` first if `src/` has
 * changed since the last build. Usage (from `js/`): `node
 * bench/vs-yaml-node.mjs`, or `--json` for machine-readable output (same
 * shape as `vs-yaml.ts --json`).
 */

import { parseCore } from '../dist/index.js'
import { load } from 'js-yaml'

const JSON_OUTPUT = process.argv.includes('--json')
const SAMPLES = 9
const results = []

const log = (line) => { if (!JSON_OUTPUT) console.log(line) }

function time(fn, iterations) {
	const start = performance.now()
	for (let i = 0; i < iterations; i++) fn()
	return ((performance.now() - start) / iterations) * 1000
}

function result(name, samples, iterations) {
	samples.sort((a, b) => a - b)
	const medianUs = samples[Math.floor(samples.length / 2)]
	const p95Us = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]
	return {
		name, iterations, samples: samples.length, medianUs, p95Us,
		minUs: samples[0], maxUs: samples[samples.length - 1], opsPerSec: 1_000_000 / medianUs,
	}
}

function print(r) {
	log(
		`${r.name.padEnd(60)} median ${r.medianUs.toFixed(2).padStart(9)} us/op  ` +
		`p95 ${r.p95Us.toFixed(2).padStart(9)} us/op  ${r.opsPerSec.toFixed(0).padStart(9)} ops/sec`
	)
}

function compare(name, doc, iterations) {
	const parseLima = () => { parseCore(doc) }
	const parseYaml = () => { load(doc) }
	for (let i = 0; i < Math.min(iterations, 1000); i++) { parseLima(); parseYaml() }
	const limaSamples = []
	const yamlSamples = []
	for (let sample = 0; sample < SAMPLES; sample++) {
		if (sample % 2 === 0) {
			limaSamples.push(time(parseLima, iterations))
			yamlSamples.push(time(parseYaml, iterations))
		} else {
			yamlSamples.push(time(parseYaml, iterations))
			limaSamples.push(time(parseLima, iterations))
		}
	}
	const lima = result(`${name} — Lima (parseCore)`, limaSamples, iterations)
	const yaml = result(`${name} — js-yaml (load)`, yamlSamples, iterations)
	results.push(lima, yaml)
	print(lima)
	print(yaml)
	log(`  → Lima is ${(yaml.medianUs / lima.medianUs).toFixed(2)}x the speed of js-yaml (median)\n`)
}

// ── Representative frontmatter-shaped documents (Core-only) ─────────────
// Kept identical to vs-yaml.ts's scenarios so results are comparable across
// runtimes.

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
