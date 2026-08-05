import { describe, expect, it } from 'bun:test'
import { parse } from '../dist/index.js'

/**
 * Runs the exact quickstart example shown in the repository README,
 * js/README.md, and docs/guide.md against the *built* public entry point
 * (not src/), since that's what a real consumer actually imports. Catches
 * a documented example silently going stale after a behavior change, the
 * same way js/src/readme-links.test.ts catches a documented link going
 * stale.
 */
describe('published quickstart example (README.md / js/README.md / docs/guide.md)', () => {
	it('parses the shared quickstart document to the documented shape', () => {
		const result = parse(`
title: My First Post
tags:
  - javascript
  - webdev
published: 2024-03-01
draft: false
`)

		expect(result.title).toBe('My First Post')
		expect(result.tags).toEqual(['javascript', 'webdev'])
		expect(result.published).toBeInstanceOf(Date)
		expect((result.published as Date).toISOString()).toBe('2024-03-01T00:00:00.000Z')
		expect(result.draft).toBe(false)
	})

	it('splitFrontmatter recipe (docs/README.md "Parsing a whole Markdown file") round-trips a full file', () => {
		function splitFrontmatter(fileContent: string): { frontmatter: string; body: string } | null {
			const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/.exec(fileContent)
			if (!match) return null
			return { frontmatter: match[1], body: match[2] }
		}

		const file = '---\ntitle: My First Post\n---\n# My First Post\n\nBody content here.\n'
		const split = splitFrontmatter(file)
		expect(split).not.toBeNull()
		expect(split!.body).toBe('# My First Post\n\nBody content here.\n')
		expect(parse(split!.frontmatter)).toEqual({ title: 'My First Post' })
	})
})
