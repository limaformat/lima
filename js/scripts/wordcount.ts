#!/usr/bin/env bun
/**
 * Reproduces the "Numbers instead of adjectives" implementation word counts
 * (README.md, and the homepage comparison table at limaformat.dev).
 *
 * Methodology (see scripts/wordcount.md for the full write-up):
 *   - Word count, not lines (`wc -w`-equivalent whitespace tokenization).
 *   - Code and comments counted separately, split via the TypeScript AST
 *     (never regex) — a comment is whatever `ts.getLeadingCommentRanges`
 *     attaches to a token; everything else is code.
 *   - Hand-authored source only, never a bundled/minified/generated build.
 *   - Core vs. References is "actual imports, not file boundaries": a
 *     shared file contributes only the top-level declarations a given
 *     entry point actually reaches, not the whole file.
 *
 * A bucket entry is either:
 *   - a whole file (no `include`/`exclude`), or
 *   - `exclude: [names]` — the whole file minus these top-level statements
 *     (plus each one's own leading comment); the module's leading doc
 *     comment is kept by default, or
 *   - `include: [names]` — ONLY these top-level statements (plus each one's
 *     own leading comment); the module's leading doc comment is dropped by
 *     default.
 *   `names` matches declarations (`export const X`, `function X`, `type X`,
 *   ...) AND import/re-export bindings — an entire `import {...} from '...'`
 *   or `export {...} from '...'` line moves as one unit by naming any one of
 *   the bindings it lists (e.g. scalars.ts's Core bucket excludes its
 *   `value.js` import — needed only by the References-only `toPlainValue`
 *   — by naming `LNull`, one of that import's bindings).
 *   `excludeModuleComment: true` / `false` overrides the mode's default for
 *   the module comment specifically. `stripComments: [names]` keeps a
 *   statement's code but drops its own leading comment — for a kept
 *   function whose doc comment describes more than this bucket's scope
 *   (see wordcount.md's note on core.ts's `parseCoreGeneric`).
 *
 * Usage:
 *   bun run scripts/wordcount.ts --manifest scripts/wordcount.manifest.json --bucket lima-core-1.0
 *   bun run scripts/wordcount.ts --manifest scripts/wordcount.manifest.json --bucket js-yaml-load --root /path/to/js-yaml-5.2.3/src
 *
 * Requires the classic TypeScript Compiler API (`ts.createSourceFile`,
 * `ts.forEachChild`, `ts.getLeadingCommentRanges`) — the `typescript`
 * devDependency pinned in package.json (^7.0.2) is the new native compiler
 * and does not expose this API, so this script resolves the separate
 * `typescript-classic` (npm alias for classic `typescript@^5.9.3`)
 * devDependency instead.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
// @ts-ignore — typescript-classic has no bundled type declarations under this alias
import * as ts from 'typescript-classic'

type BucketEntry = {
	file: string
	include?: string[]
	exclude?: string[]
	excludeModuleComment?: boolean
	/** Keep this statement's code but drop its own leading comment — for a kept
	 * function whose doc comment describes more than this bucket's scope (see
	 * wordcount.md's note on core.ts's parseCoreGeneric). */
	stripComments?: string[]
}
type Manifest = { buckets: Record<string, { description: string; entries: BucketEntry[] }> }

const countWords = (text: string): number => {
	const trimmed = text.trim()
	return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

/**
 * Every name a top-level statement binds — what `include`/`exclude` match
 * against. Import statements are named by their imported bindings too (not
 * just declarations), so a whole `import {...} from '...'` line can be
 * moved between buckets the same way a declaration can — e.g. scalars.ts's
 * `value.js` import is only needed by the References-only `toPlainValue`,
 * so it's excluded from Core by naming one of its imported bindings.
 */
const statementNames = (node: any): string[] => {
	if (ts.isVariableStatement(node)) {
		return node.declarationList.declarations
			.map((d: any) => (ts.isIdentifier(d.name) ? d.name.text : undefined))
			.filter((n: string | undefined): n is string => n !== undefined)
	}
	if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
		ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
		return node.name ? [node.name.text] : []
	}
	// `export { a, type b } from './x.js'` / `export type { a } from './x.js'` — a
	// re-export's own names, not the module it re-exports from.
	if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
		return node.exportClause.elements.map((e: any) => e.name.text)
	}
	if (ts.isImportDeclaration(node) && node.importClause?.namedBindings &&
		ts.isNamedImports(node.importClause.namedBindings)) {
		return node.importClause.namedBindings.elements.map((e: any) => e.name.text)
	}
	return []
}

/** Whole-file, unfiltered text (no manifest entry, or a bucket with no include/exclude). */
const wholeFileText = (sourceText: string): string => sourceText

const manifestFilteredText = (sourceFile: any, sourceText: string, entry: BucketEntry): string => {
	const wantInclude = entry.include !== undefined
	const names = new Set(entry.include ?? entry.exclude ?? [])
	const parts: string[] = []

	// The module doc comment is leading trivia of statement 1 in the AST —
	// `getFullStart()` of that statement already starts at position 0, so it
	// can never be told apart from "no comment" by position alone. Handle it
	// as its own, separate item instead: always extract it explicitly here,
	// then start every statement's own slice AFTER it, so it's never
	// silently dropped (when statement 1 is excluded) nor double-counted
	// (when statement 1 is kept).
	const moduleComments = ts.getLeadingCommentRanges(sourceText, 0) ?? []
	const afterModuleComment = moduleComments.length > 0 ? moduleComments[moduleComments.length - 1].end : 0
	// The module comment defaults on for exclude mode (keep everything not
	// named — the comment isn't "named" so it would otherwise always
	// survive) and off for include mode (keep only what's named — the
	// comment wasn't asked for), matching how a plain declaration behaves
	// in each mode. `excludeModuleComment`/naming it explicitly overrides.
	if (entry.excludeModuleComment !== undefined ? !entry.excludeModuleComment : !wantInclude) {
		for (const r of moduleComments) parts.push(sourceText.slice(r.pos, r.end) + '\n')
	}

	const stripComments = new Set(entry.stripComments ?? [])
	for (const stmt of sourceFile.statements) {
		const declared = statementNames(stmt)
		const matches = declared.some((n) => names.has(n))
		const keep = wantInclude ? matches : !matches
		if (!keep) continue
		const start = declared.some((n) => stripComments.has(n)) ? stmt.getStart(sourceFile) : Math.max(stmt.getFullStart(), afterModuleComment)
		parts.push(sourceText.slice(start, stmt.getEnd()))
	}

	return parts.join('\n')
}

const analyze = (filePath: string, entry?: BucketEntry) => {
	const sourceText = fs.readFileSync(filePath, 'utf8')
	const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
	const text = entry && (entry.include || entry.exclude)
		? manifestFilteredText(sourceFile, sourceText, entry)
		: wholeFileText(sourceText)

	// Re-parse the (possibly reduced) text so comment/code splitting runs
	// over exactly what's being counted, identical to whole-file mode.
	const reducedFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
	const commentRanges: { pos: number; end: number }[] = []
	const seen = new Set<string>()
	const collect = (node: any) => {
		const fullStart = node.getFullStart ? node.getFullStart() : node.pos
		for (const r of ts.getLeadingCommentRanges(text, fullStart) ?? []) {
			const key = `${r.pos}-${r.end}`
			if (!seen.has(key)) { seen.add(key); commentRanges.push(r) }
		}
		ts.forEachChild(node, collect)
	}
	collect(reducedFile)
	if (reducedFile.endOfFileToken) {
		for (const r of ts.getLeadingCommentRanges(text, reducedFile.endOfFileToken.getFullStart()) ?? []) {
			const key = `${r.pos}-${r.end}`
			if (!seen.has(key)) { seen.add(key); commentRanges.push(r) }
		}
	}
	commentRanges.sort((a, b) => a.pos - b.pos)

	let codeText = '', commentText = '', cursor = 0
	for (const r of commentRanges) {
		codeText += text.slice(cursor, r.pos)
		commentText += text.slice(r.pos, r.end) + '\n'
		cursor = r.end
	}
	codeText += text.slice(cursor)

	return { codeWords: countWords(codeText), commentWords: countWords(commentText) }
}

const main = () => {
	const args = process.argv.slice(2)
	const flag = (name: string): string | undefined => {
		const i = args.indexOf(name)
		return i === -1 ? undefined : args[i + 1]
	}

	const manifestPath = flag('--manifest')
	const bucketName = flag('--bucket')
	if (!manifestPath || !bucketName) {
		console.error('Usage: wordcount.ts --manifest <file> --bucket <name> [--root <dir>]')
		process.exit(1)
	}

	const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
	const bucket = manifest.buckets[bucketName]
	if (!bucket) {
		console.error(`Unknown bucket "${bucketName}". Known: ${Object.keys(manifest.buckets).join(', ')}`)
		process.exit(1)
	}

	const root = flag('--root') ?? path.resolve(path.dirname(manifestPath), '../..')
	let totalCode = 0, totalComment = 0
	for (const entry of bucket.entries) {
		const filePath = path.resolve(root, entry.file)
		const { codeWords, commentWords } = analyze(filePath, entry)
		console.log(`${entry.file}\tcode=${codeWords}\tcomment=${commentWords}`)
		totalCode += codeWords
		totalComment += commentWords
	}
	console.log(`TOTAL\tcode=${totalCode}\tcomment=${totalComment}\tsum=${totalCode + totalComment}`)
}

main()
