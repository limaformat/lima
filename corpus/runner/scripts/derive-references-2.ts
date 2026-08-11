/**
 * One-way bootstrap for References 2.0 corpus cases whose normative assertion
 * is unchanged from 1.0. Version-specific phase, one-hop, and flat-partial
 * cases are deliberately excluded and replaced by hand-authored 2.0 cases.
 */
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const corpusRoot = join(import.meta.dir, '..', '..')
const sourceDir = join(corpusRoot, 'references')
const targetDir = join(corpusRoot, 'references-2.0')

const excluded = new Set([
	'one-hop-chain.json',
	'one-hop-order-independent.json',
	'partials-no-traversal.json',
	'phase1-dotted-path-defining-key.json',
	'phase1-earlier-target-by-position.json',
	'phase1-partials-always-available.json',
	'phase2-recursive-into-document-values.json',
	'syntax-dotted-partial-syntax-invalid.json',
])

const sectionMap: Record<string, string> = {
	'1': '1',
	'2.1': '2.1',
	'2.2': '2.2',
	'2.3': '2.4',
	'2.4': '2.5',
	'2.5': '2.5',
	'3.1': '3.2',
	'3.2': '3.4',
	'3.3': '3.1',
	'3.4': '3.1',
	'3.5': '3.4',
	'3.5.1': '3.5',
	'3.6': '3.6',
	'3.8': '3.3',
	'4.2': '4.1',
	'4.3': '4.3',
	'5': '5',
	'6.1': '6.1',
	'6.2': '6.2',
	'7': '7',
	'8': '8',
}

const migrateString = (value: string): string => value
	.replace(/\(\$([a-zA-Z0-9_][a-zA-Z0-9_:\-.]*)\)/g, '$($1)')
	.replace(/\(%([a-zA-Z0-9_][a-zA-Z0-9_:\-/]*)\)/g, '$(:$1)')
	.replaceAll('References 1.0', 'References 2.0')
	.replaceAll('references.', 'references-2.')
	.replaceAll('after the second resolution phase', 'after reference resolution')
	.replaceAll('after phase 2', 'after reference resolution')

const migrate = (value: unknown): unknown => {
	if (typeof value === 'string') return migrateString(value)
	if (Array.isArray(value)) return value.map(migrate)
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, child]) => [migrateString(key), migrate(child)]))
	}
	return value
}

mkdirSync(targetDir, { recursive: true })
let written = 0
for (const filename of readdirSync(sourceDir).filter((name) => name.endsWith('.json')).sort()) {
	if (excluded.has(filename)) continue
	const source = JSON.parse(readFileSync(join(sourceDir, filename), 'utf8')) as Record<string, unknown>
	const result = migrate(source) as Record<string, unknown>
	result.id = String(result.id).replace(/^references\./, 'references-2.')
	result.specVersion = '2.0'
	result.section = sectionMap[String(source.section)] ?? source.section
	if (filename === 'forward-reference.json') {
		result.id = 'references-2.resolution.forward-reference.direct'
		result.description = 'A direct document reference resolves regardless of whether its target appears later in source order.'
		result.tags = ['positive', 'forward-reference', 'determinism']
	}
	if (filename === 'cycles-self-reference-nonstrict.json') {
		result.description = 'A self-reference is cyclic and remains its complete token string in non-strict mode.'
	}
	if (filename === 'cycles-two-key-cycle-nonstrict.json') {
		result.description = 'Every token in a two-key dependency cycle remains unresolved in non-strict mode.'
	}
	if (filename === 'pure-number.json') result.tags = ['positive', 'pure-reference', 'direct-reference']
	await Bun.write(join(targetDir, filename), `${JSON.stringify(result, null, 2)}\n`)
	written++
}

console.log(`derived ${written} References 2.0 cases`)
