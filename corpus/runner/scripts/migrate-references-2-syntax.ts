/** One-way migration from the briefly published References 2.0 token syntax. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const corpusDir = join(import.meta.dir, '..', '..', 'references-2.0')

// One callback pass is essential: two replacement passes would reinterpret
// newly produced $(partial) tokens as document references. The prefix-only
// alternatives also migrate deliberately incomplete scanner fixtures.
const migrateString = (value: string): string => value.replace(
	/\$\(:([a-zA-Z0-9_][a-zA-Z0-9_:/-]*(?:\.[a-zA-Z0-9_][a-zA-Z0-9_:-]*)*)\)|\$\(([a-zA-Z0-9_][a-zA-Z0-9_:-]*(?:\.[a-zA-Z0-9_][a-zA-Z0-9_:-]*)*)\)|\$\(:|\$\(/g,
	(match, partialPath: string | undefined, documentPath: string | undefined) => {
		if (partialPath !== undefined) return `$(${partialPath})`
		if (documentPath !== undefined) return `\${${documentPath}}`
		return match === '$(:' ? '$(' : '${'
	},
)

let written = 0
for (const filename of readdirSync(corpusDir).filter((name) => name.endsWith('.json')).sort()) {
	const path = join(corpusDir, filename)
	const source = readFileSync(path, 'utf8')
	const migrated = migrateString(source)
	JSON.parse(migrated) // Refuse to write if the serialized corpus would become invalid.
	await Bun.write(path, migrated)
	written++
}

console.log(`migrated ${written} References 2.0 cases`)
