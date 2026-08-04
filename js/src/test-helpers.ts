import { describe } from 'bun:test'
import { parse as parseIndex, type ParseOptions } from './index.js'

/**
 * Strips common leading whitespace from template literals so tests can be
 * indented naturally without confusing the LIMA parser (which requires keys
 * to start at column 0).
 */
export const dedent = (str: string): string => {
	const lines = str.split('\n')
	while (lines.length && !lines[0].trim()) lines.shift()
	while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
	const minIndent = lines
		.filter((l) => l.trim().length > 0)
		.reduce((min, l) => Math.min(min, l.match(/^(\s*)/)?.[1].length ?? 0), Infinity)
	return lines.map((l) => l.slice(minIndent)).join('\n')
}

type Parse = (str: string, options?: ParseOptions) => Record<string, unknown>

const PARSERS: { name: string; impl: (input: string, options?: ParseOptions) => Record<string, unknown> }[] = [
	{ name: 'index', impl: parseIndex },
]

/**
 * Runs `body` once per registered parser implementation — currently just
 * `index`, but this is the extension point for testing a future additional
 * port (e.g. a Rust implementation, via WASM) against the exact same suite
 * without duplicating a single test. `body` receives `parse` (bound to that
 * implementation, pre-wired through `dedent`, for multi-line template-
 * literal inputs) and `limaParser` (the raw, un-dedented implementation,
 * for single-line inputs that don't need it), inside a `describe` block
 * named after the implementation.
 */
export const forEachParser = (body: (parse: Parse, limaParser: Parse) => void): void => {
	for (const { name, impl } of PARSERS) {
		const parse: Parse = (str, options) => impl(dedent(str), options)
		describe(name, () => body(parse, impl))
	}
}
