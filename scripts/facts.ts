#!/usr/bin/env bun
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// The existing word-count tool uses this same classic compiler API.
// @ts-ignore — typescript-classic has no bundled declarations under this alias
import * as ts from '../js/node_modules/typescript-classic/lib/typescript.js'
import { loadCorpus, DEFAULT_SUITES, SUITE_DIRECTORIES, type SuiteName } from '../corpus/runner/src/loader'
import { parseCore } from '../js/src/core'
import { formatFacts, reachFixedPoint, replaceFactMarkers, type FactTree } from './facts-lib'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')
const factsPath = join(repoRoot, 'docs/facts.lima')
const markerFiles = [
	'README.md',
	'js/README.md',
	'rust/README.md',
	'go/README.md',
	'editors/lsp/README.md',
	'editors/jetbrains/README.md',
	'editors/tree-sitter-lima/README.md',
	'editors/vscode/README.md',
	'editors/zed/README.md',
	'js/scripts/wordcount.md',
	'docs/corpus-design/README.md',
	'docs/corpus-design/coverage/core.md',
	'docs/corpus-design/coverage/references-2.0.md',
]

const checkOnlyFiles = [
	'docs/guide.md',
	'docs/migrating-from-yaml.md',
	'docs/lima-core-1.0-spec.md',
	'docs/lima-references-1.0-spec.md',
	'docs/lima-references-2.0-spec.md',
] as const

const EDITORIAL_LANGUAGE_DESIGN_SPLIT = {
	yamlComplexityOrSecurityExclusions: 7,
	localeOrFormatAmbiguityExclusions: 5,
	limaTypeOrBoundaryExclusions: 7,
} as const

const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8')

const packageVersion = (): string => {
	const javascript = (JSON.parse(read('js/package.json')) as { version: string }).version
	const rust = /^version\s*=\s*"([^"]+)"/m.exec(read('rust/Cargo.toml'))?.[1]
	const go = /^## \[(\d+\.\d+\.\d+)\]/m.exec(read('go/CHANGELOG.md'))?.[1]
	if (!rust || !go) throw new Error('could not read all package versions')
	const versions = { javascript, rust, go }
	if (new Set(Object.values(versions)).size !== 1) {
		throw new Error(`package versions disagree: ${Object.entries(versions).map(([k, v]) => `${k}=${v}`).join(', ')}`)
	}
	return javascript
}

const specVersion = (path: string, name: string): string => {
	const match = new RegExp(`^# Lima ${name} ([0-9]+\\.[0-9]+)`, 'm').exec(read(path))
	if (!match) throw new Error(`could not read ${name} version from ${path}`)
	return match[1]
}

const command = async (args: string[], cwd: string, extraEnv: Record<string, string> = {}): Promise<string> => {
	const proc = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...extraEnv } })
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	])
	if (code !== 0) throw new Error(`${args.join(' ')} failed (${code}):\n${stderr || stdout}`)
	return stdout
}

const wordCountBucket = async (bucket: string): Promise<{ code: number; comments: number }> => {
	const output = await command([
		'bun', 'run', 'scripts/wordcount.ts', '--manifest', 'scripts/wordcount.manifest.json', '--bucket', bucket,
	], join(repoRoot, 'js'))
	const match = /^TOTAL\s+code=(\d+)\s+comment=(\d+)\s+sum=\d+$/m.exec(output)
	if (!match) throw new Error(`wordcount output for ${bucket} had no TOTAL line`)
	return { code: Number(match[1]), comments: Number(match[2]) }
}

const countWords = (text: string): number => text.trim() === '' ? 0 : text.trim().split(/\s+/).length

const languageDesignFacts = () => {
	const spec = read('docs/lima-core-1.0-spec.md')
	const tableStart = spec.indexOf('| Construct | Reason |', spec.indexOf('## 12. Appendix A'))
	if (tableStart === -1) throw new Error('could not find the Core Appendix A exclusions table')
	const tableLines = spec.slice(tableStart).split('\n')
	let appendixExcludedConstructs = 0
	for (const line of tableLines.slice(2)) {
		if (!line.startsWith('|')) break
		appendixExcludedConstructs++
	}
	const editorialTotal = Object.values(EDITORIAL_LANGUAGE_DESIGN_SPLIT).reduce((sum, value) => sum + value, 0)
	if (editorialTotal !== appendixExcludedConstructs) {
		throw new Error(`editorial language-design split totals ${editorialTotal}, but Appendix A has ${appendixExcludedConstructs} rows`)
	}

	let regexLookaroundOrBackreferenceConstructs = 0
	for (const name of readdirSync(join(repoRoot, 'js/src')).filter((item) => item.endsWith('.ts') && !item.endsWith('.test.ts'))) {
		const sourceText = read(`js/src/${name}`)
		const sourceFile = ts.createSourceFile(name, sourceText, ts.ScriptTarget.Latest, true)
		const visit = (node: any) => {
			if (ts.isRegularExpressionLiteral(node)) {
				const literal = node.getText(sourceFile)
				regexLookaroundOrBackreferenceConstructs += literal.match(/\(\?(?:=|!|<=|<!)/g)?.length ?? 0
				regexLookaroundOrBackreferenceConstructs += literal.match(/\\(?:[1-9][0-9]*|k<[^>]+>)/g)?.length ?? 0
			}
			ts.forEachChild(node, visit)
		}
		visit(sourceFile)
	}

	return { appendixExcludedConstructs, regexLookaroundOrBackreferenceConstructs }
}

const packInfo = async (target: string): Promise<{ size: number; version: string }> => {
	const output = await command(['npm', 'pack', '--ignore-scripts', '--dry-run', '--json', target], join(repoRoot, 'js'))
	const result = JSON.parse(output) as { size: number; version: string }[]
	if (!Array.isArray(result) || typeof result[0]?.size !== 'number' || typeof result[0]?.version !== 'string') {
		throw new Error(`unexpected npm pack result for ${target}`)
	}
	return { size: result[0].size, version: result[0].version }
}

const corpusFacts = () => {
	const corpusRoot = join(repoRoot, 'corpus')
	const core10Manifest = JSON.parse(read('corpus/manifests/core-1.0.json')) as { baselineCaseCount: number; specVersion: string }
	const core11Manifest = JSON.parse(read('corpus/manifests/core-1.1.json')) as { supersedes: string[] }
	const standalone = Object.fromEntries(DEFAULT_SUITES.map((suite) => {
		const loaded = loadCorpus(corpusRoot, [suite])
		if (loaded.failures.length) throw new Error(`${suite}: ${loaded.failures.length} corpus load failure(s)`)
		return [suite, loaded.cases.length]
	})) as Record<SuiteName, number>
	const legacyReferences = loadCorpus(corpusRoot, ['references-1.0'])
	if (legacyReferences.failures.length) throw new Error('references-1.0 corpus has load failures')
	const loaded = loadCorpus(corpusRoot)
	if (loaded.failures.length) throw new Error(`default corpus has ${loaded.failures.length} load failure(s)`)
	const defaultBySuite = Object.fromEntries(DEFAULT_SUITES.map((suite) => [suite, 0])) as Record<SuiteName, number>
	for (const testCase of loaded.cases) {
		const suite = DEFAULT_SUITES.find((candidate) =>
			testCase.sourceFile.includes(`/corpus/${SUITE_DIRECTORIES[candidate]}/`))
		if (!suite) throw new Error(`default corpus case is outside its suites: ${testCase.sourceFile}`)
		defaultBySuite[suite]++
	}
	const coreCases = loaded.cases.filter((item) => item.spec === 'core').length
	const referencesCases = loaded.cases.length - coreCases
	return {
		standalone,
		defaultBySuite,
		legacyReferences: legacyReferences.cases.length,
		core10Baseline: core10Manifest.baselineCaseCount,
		core10ErrataVersion: core10Manifest.specVersion,
		core11Supersedes: core11Manifest.supersedes.length,
		total: loaded.cases.length,
		coreCases,
		referencesCases,
	}
}

const differentialFacts = () => {
	const ci = read('.github/workflows/ci.yml')
	const match = /--seeds\s+([0-9,]+)\s+--docs\s+(\d+)/.exec(ci)
	if (!match) throw new Error('could not find differential --seeds/--docs in .github/workflows/ci.yml')
	const seeds = match[1].split(',').length
	const documentsPerSeed = Number(match[2])
	const modes = 2
	return { seeds, documentsPerSeed, documents: seeds * documentsPerSeed, modes, parsesPerImplementation: seeds * documentsPerSeed * modes }
}

const compatibilityFacts = async () => {
	const output = await command(
		['bun', 'compat/src/run.ts', '--json'],
		repoRoot,
		{ NODE_PATH: join(repoRoot, 'js/node_modules') },
	)
	const reports = JSON.parse(output) as { classification: string }[]
	const matching = reports.filter((report) => report.classification === 'MATCH').length
	return { samples: reports.length, matching, diverging: reports.length - matching }
}

const editorFacts = () => {
	const jetbrainsBuild = read('editors/jetbrains/build.gradle.kts')
	const value = (pattern: RegExp, name: string): string => {
		const match = pattern.exec(jetbrainsBuild)?.[1]
		if (!match) throw new Error(`could not read ${name} from editors/jetbrains/build.gradle.kts`)
		return match
	}
	const lspPackage = JSON.parse(read('editors/lsp/package.json')) as { engines: { node: string } }
	return {
		jetbrainsPluginVersion: value(/^version = "([^"]+)"/m, 'JetBrains plugin version'),
		jetbrainsSinceBuild: value(/sinceBuild = "([^"]+)"/, 'JetBrains since-build'),
		jetbrainsMinimumIdeVersion: value(/intellijIdeaCommunity\("([^"]+)"\)/, 'JetBrains IDE version'),
		lsp4ijMinimumVersion: value(/lsp4ij:([^"]+)"/, 'LSP4IJ version'),
		nodeMinimumVersion: lspPackage.engines.node.replace(/^>=/, ''),
	}
}

interface Measurements {
	version: string
	coreVersion: string
	referencesVersion: string
	unicodeVersion: string
	corpus: ReturnType<typeof corpusFacts>
	coreWords: number
	referencesWords: number
	coreImplementation: { code: number; comments: number }
	referencesImplementation: { code: number; comments: number }
	tarballBytes: number
	jsYamlTarballBytes: number
	jsYamlVersion: string
	differential: ReturnType<typeof differentialFacts>
	compatibility: Awaited<ReturnType<typeof compatibilityFacts>>
	editors: ReturnType<typeof editorFacts>
	languageDesign: ReturnType<typeof languageDesignFacts>
}

const measure = async (): Promise<Measurements> => {
	const [coreImplementation, referencesImplementation, limaPack, jsYamlPack, compatibility] = await Promise.all([
		wordCountBucket('lima-core-1.1'),
		wordCountBucket('lima-references-2.0-additions'),
		packInfo('.'),
		packInfo('./node_modules/js-yaml'),
		compatibilityFacts(),
	])
	return {
		version: packageVersion(),
		coreVersion: specVersion('docs/lima-core-1.0-spec.md', 'Core'),
		referencesVersion: specVersion('docs/lima-references-2.0-spec.md', 'References'),
		unicodeVersion: /Unicode (\d+\.\d+)/.exec(read('docs/lima-core-1.0-spec.md'))?.[1] ?? (() => { throw new Error('could not read Unicode version from Core spec') })(),
		corpus: corpusFacts(),
		coreWords: countWords(read('docs/lima-core-1.0-spec.md')),
		referencesWords: countWords(read('docs/lima-references-2.0-spec.md')),
		coreImplementation,
		referencesImplementation,
		tarballBytes: limaPack.size,
		jsYamlTarballBytes: jsYamlPack.size,
		jsYamlVersion: jsYamlPack.version,
		differential: differentialFacts(),
		compatibility,
		editors: editorFacts(),
		languageDesign: languageDesignFacts(),
	}
}

const round = (value: number, digits = 1): number => Number(value.toFixed(digits))

const toFacts = (m: Measurements): FactTree => ({
	packages: { version: m.version },
	editors: {
		jetbrains_plugin_version: m.editors.jetbrainsPluginVersion,
		jetbrains_minimum_ide_build: m.editors.jetbrainsSinceBuild,
		jetbrains_minimum_ide_version: m.editors.jetbrainsMinimumIdeVersion,
		lsp4ij_minimum_version: m.editors.lsp4ijMinimumVersion,
		node_minimum_version: m.editors.nodeMinimumVersion,
	},
	language: { core_version: m.coreVersion, references_version: m.referencesVersion, unicode_version: m.unicodeVersion },
	language_design: {
		appendix_excluded_constructs: m.languageDesign.appendixExcludedConstructs,
		yaml_complexity_or_security_exclusions: EDITORIAL_LANGUAGE_DESIGN_SPLIT.yamlComplexityOrSecurityExclusions,
		locale_or_format_ambiguity_exclusions: EDITORIAL_LANGUAGE_DESIGN_SPLIT.localeOrFormatAmbiguityExclusions,
		lima_type_or_boundary_exclusions: EDITORIAL_LANGUAGE_DESIGN_SPLIT.limaTypeOrBoundaryExclusions,
		regex_lookaround_or_backreference_constructs: m.languageDesign.regexLookaroundOrBackreferenceConstructs,
	},
	corpus: {
		suites: {
			core_1_0: {
				cases: m.corpus.standalone['core-1.0'],
				cases_in_default: m.corpus.defaultBySuite['core-1.0'],
				baseline_cases: m.corpus.core10Baseline,
				latest_errata_version: m.corpus.core10ErrataVersion,
			},
			core_1_1: {
				cases: m.corpus.standalone['core-1.1'],
				cases_in_default: m.corpus.defaultBySuite['core-1.1'],
				superseded_core_1_0_cases: m.corpus.core11Supersedes,
			},
			core_1_2: { cases: m.corpus.standalone['core-1.2'], cases_in_default: m.corpus.defaultBySuite['core-1.2'] },
			references_1_0: { cases: m.corpus.legacyReferences },
			references_2_0: { cases: m.corpus.standalone['references-2.0'], cases_in_default: m.corpus.defaultBySuite['references-2.0'] },
			references_2_1: { cases: m.corpus.standalone['references-2.1'], cases_in_default: m.corpus.defaultBySuite['references-2.1'] },
		},
		default: { cases: m.corpus.total, core_cases: m.corpus.coreCases, references_cases: m.corpus.referencesCases },
	},
	word_counts: {
		specifications: {
			lima_core: m.coreWords,
			lima_references: m.referencesWords,
			json_rfc_8259: 3998,
			toml: 4254,
			yaml_1_2_2: 21961,
			lima_core_ratio_to_json: round(m.coreWords / 3998),
			lima_core_ratio_to_toml: round(m.coreWords / 4254),
			yaml_ratio_to_lima_core: round(21961 / m.coreWords),
		},
		implementations: {
			lima_core_code: m.coreImplementation.code,
			lima_core_comments: m.coreImplementation.comments,
			lima_core_comment_percentage: round(100 * m.coreImplementation.comments / (m.coreImplementation.code + m.coreImplementation.comments)),
			lima_references_code: m.referencesImplementation.code,
			lima_references_comments: m.referencesImplementation.comments,
			js_yaml_code: 11787,
			js_yaml_comments: 2144,
			js_yaml_version: m.jsYamlVersion,
			js_yaml_tag_implementations: 21,
			js_yaml_exposed_schemas: 4,
		},
	},
	package_sizes: {
		lima_npm_tarball_bytes: m.tarballBytes,
		lima_npm_tarball_kilobytes_decimal: round(m.tarballBytes / 1000),
		js_yaml_npm_tarball_bytes: m.jsYamlTarballBytes,
		js_yaml_npm_tarball_kilobytes_decimal: Math.round(m.jsYamlTarballBytes / 1000),
		js_yaml_ratio_to_lima: round(m.jsYamlTarballBytes / m.tarballBytes),
	},
	differential_test: {
		seeds: m.differential.seeds,
		documents_per_seed: m.differential.documentsPerSeed,
		documents: m.differential.documents,
		modes: m.differential.modes,
		parses_per_implementation: m.differential.parsesPerImplementation,
	},
	compatibility_samples: {
		total: m.compatibility.samples,
		matching: m.compatibility.matching,
		diverging: m.compatibility.diverging,
	},
})

const validateFacts = (text: string, expected: FactTree) => {
	const parsed = parseCore(text, { strict: true })
	if (JSON.stringify(parsed) !== JSON.stringify(expected)) throw new Error('docs/facts.lima did not parse back to its source data')
}

const render = (measurements: Measurements) => {
	const facts = toFacts(measurements)
	const factsText = formatFacts(facts)
	validateFacts(factsText, facts)
	const files = new Map<string, { text: string; differences: string[] }>()
	for (const path of markerFiles) {
		const result = replaceFactMarkers(read(path), facts)
		files.set(path, { text: result.text, differences: result.differences.map((d) => `${d.key}: ${JSON.stringify(d.actual)} -> ${JSON.stringify(d.expected)}`) })
	}
	return { factsText, files }
}

const checkOnlyDifferences = (measurements: Measurements): string[] => {
	const expected: { path: typeof checkOnlyFiles[number]; text: string }[] = [
		{ path: 'docs/guide.md', text: `[Lima Core ${measurements.coreVersion}](lima-core-1.0-spec.md) and\n[Lima References ${measurements.referencesVersion}](lima-references-2.0-spec.md)` },
		{ path: 'docs/guide.md', text: `Unicode ${measurements.unicodeVersion}` },
		{ path: 'docs/guide.md', text: `Everything in this section is **Lima References ${measurements.referencesVersion}**` },
		{ path: 'docs/guide.md', text: `References ${measurements.referencesVersion} adds (Core §10.1 + References §7)` },
		{ path: 'docs/guide.md', text: `References ${measurements.referencesVersion} parser. \`parseReferences\` is a deprecated exact alias` },
		{ path: 'docs/guide.md', text: `- [Lima Core ${measurements.coreVersion}](lima-core-1.0-spec.md) and\n  [Lima References ${measurements.referencesVersion}](lima-references-2.0-spec.md)` },
		{ path: 'docs/migrating-from-yaml.md', text: `— ${measurements.compatibility.samples} hand-authored samples` },
		{ path: 'docs/migrating-from-yaml.md', text: `**${measurements.compatibility.matching} of those ${measurements.compatibility.samples} samples parse\nidentically under Lima and js-yaml; ${measurements.compatibility.diverging} diverge**` },
		{ path: 'docs/migrating-from-yaml.md', text: `statement about these ${measurements.compatibility.samples}\nsamples, not a general compatibility percentage — ${measurements.compatibility.samples} hand-picked documents` },
		{ path: 'docs/lima-core-1.0-spec.md', text: `# Lima Core ${measurements.coreVersion} — Normative Specification` },
		{ path: 'docs/lima-core-1.0-spec.md', text: `**Version:** ${measurements.coreVersion}.0` },
		{ path: 'docs/lima-core-1.0-spec.md', text: `This document is the normative specification for Lima Core ${measurements.coreVersion}.` },
		{ path: 'docs/lima-references-1.0-spec.md', text: '# Lima References 1.0 — Normative Specification' },
		{ path: 'docs/lima-references-1.0-spec.md', text: '**Status:** Final · **Version:** 1.0.0' },
		{ path: 'docs/lima-references-2.0-spec.md', text: `# Lima References ${measurements.referencesVersion} — Normative Specification` },
		{ path: 'docs/lima-references-2.0-spec.md', text: `**Version:** ${measurements.referencesVersion}.0` },
		{ path: 'docs/lima-references-2.0-spec.md', text: `addition to Lima Core ${measurements.coreVersion} and must be read together with that specification` },
	]
	const differences: string[] = []
	for (const path of checkOnlyFiles) {
		if (read(path).includes('<!-- facts:')) differences.push(`${path}: facts markers are not allowed in this Markanto-rendered file`)
	}
	for (const item of expected) {
		if (!read(item.path).includes(item.text)) differences.push(`${item.path}: expected text ${JSON.stringify(item.text)}`)
	}
	return differences
}

const checkOnce = async () => {
	const measurements = await measure()
	const generated = render(measurements)
	const differences: string[] = checkOnlyDifferences(measurements)
	let existingFacts = ''
	try { existingFacts = read('docs/facts.lima') } catch { /* reported below */ }
	if (existingFacts !== generated.factsText) differences.push('docs/facts.lima differs from fresh measurements')
	for (const [path, file] of generated.files) {
		for (const difference of file.differences) differences.push(`${path}: ${difference}`)
	}
	if (differences.length) {
		for (const difference of differences) console.error(difference)
		process.exitCode = 1
	} else console.log('facts are current')
}

const writeOnce = async (measurements: Measurements): Promise<boolean> => {
	const generated = render(measurements)
	let changed = false
	let oldFacts = ''
	try { oldFacts = read('docs/facts.lima') } catch { /* new file */ }
	if (oldFacts !== generated.factsText) {
		writeFileSync(factsPath, generated.factsText)
		changed = true
	}
	for (const [path, file] of generated.files) {
		if (read(path) !== file.text) {
			writeFileSync(join(repoRoot, path), file.text)
			changed = true
		}
	}
	return changed
}

if (check) await checkOnce()
else {
	const result = await reachFixedPoint(measure, writeOnce, 5)
	console.log(`facts updated; fixed point reached in ${result.rounds} round(s)`)
}
