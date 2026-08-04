import { describe, it, expect } from 'bun:test'
import { forEachParser } from './test-helpers.js'

forEachParser((parse) => {

describe('references', () => {
	it('resolves ($key) to a preceding property', () => {
		const result = parse(`
			firstName: Alice
			fullName: ($firstName)
		`)
		expect(result.fullName).toBe('Alice')
	})

	it('resolves (%key) to a provided partial', () => {
		const result = parse('author: (%defaultAuthor)', {
			partials: { defaultAuthor: 'Alice' },
		})
		expect(result.author).toBe('Alice')
	})

	it('resolves a document reference with a dotted path through nested mappings', () => {
		const result = parse(`
			site:
			  default:
			    claim: Great blog
			result: ($site.default.claim)
		`)
		expect(result.result).toBe('Great blog')
	})

	it('resolves a partial reference with a literal slash in the key (namespacing, not traversal)', () => {
		const result = parse('a: (%persons/alice)', {
			partials: { 'persons/alice': 'Alice' },
		})
		expect(result.a).toBe('Alice')
	})

	it('does not treat a dotted partial path as valid — partials are flat, not traversable (References Appendix)', () => {
		const result = parse('a: (%foo.bar)', {
			partials: { 'foo.bar': 'nope', foo: { bar: 'nested' } },
		})
		expect(result.a).toBe('(%foo.bar)')
	})

	it('does not resolve a bare %key without parentheses — the shorthand was removed (References Appendix)', () => {
		const person = { name: 'Alice', url: 'https://alice.example' }
		const result = parse('author: %persons/alice', {
			partials: { 'persons/alice': person },
		})
		expect(result.author).toBe('%persons/alice')
	})

	it('does not treat %key with spaces as a partial reference', () => {
		const result = parse('note: 100% done', { partials: { done: 'nope' } })
		expect(result.note).toBe('100% done')
	})

	it('a bare %key with no matching partial is unaffected either way, since bare %key is never a reference', () => {
		const result = parse('author: %unknown', { partials: {} })
		expect(result.author).toBe('%unknown')
	})

	it('resolves a partial reference even when the partial value itself contains reference-like text (References §3.8)', () => {
		// A partial's string content is always literal — the resolution
		// phases must not scan into it looking for active tokens. Before this
		// was fixed, isReferenceFree() recursively inspected the partial's
		// nested string for a "($...)" substring and wrongly treated the
		// whole partial as "not yet resolvable", so `person` never resolved
		// at all.
		const result = parse('person: (%author)', {
			partials: { author: { name: '($defaultName)' } },
		})
		expect(result.person).toEqual({ name: '($defaultName)' })
	})

	it('does not resolve or throw on reference-like text embedded in an interpolated partial string', () => {
		const result = parse('label: Hi (%name)!', { partials: { name: '($weird)' } })
		expect(result.label).toBe('Hi ($weird)!')
	})

	it('joins a partial array containing reference-like string elements literally in interpolation', () => {
		const result = parse('label: Items: (%arr)', { partials: { arr: ['($a)', 'b', '($c)'] } })
		expect(result.label).toBe('Items: ($a), b, ($c)')
	})

	it('throws in both modes when an array-valued reference is inserted as a sequence item — array spreading was removed (References Appendix)', () => {
		const doc = `
			keywords:
			  - (%baseTags)
			  - extra
		`
		const opts = { partials: { baseTags: ['javascript', 'webdev'] } }
		expect(() => parse(doc, opts)).toThrow('LIMA')
		expect(() => parse(doc, { ...opts, strict: true })).toThrow('LIMA')
	})

	it('interpolates references embedded in a string', () => {
		const result = parse(`
			name: Alice
			greeting: Hello ($name)!
		`)
		expect(result.greeting).toBe('Hello Alice!')
	})

	it('interpolates a UTC Instant as an RFC 3339 string with seconds and Z, not the local Date.toString() form (References §3.5)', () => {
		const result = parse('d: 2024-03-01T09:00:00+02:00\nlabel: Value: ($d)\n')
		expect(result.label).toBe('Value: 2024-03-01T07:00:00Z')
	})

	it('interpolates a reference to null as an empty string, not "null" or unresolved fallback (Core §3.5)', () => {
		const result = parse('n: null\nlabel: before ($n) after\n')
		expect(result.label).toBe('before  after')
	})

	it('joins array elements in interpolation, rendering a null element as an empty string', () => {
		const result = parse('a: [1, null, 3]\nlabel: Items: ($a)\n')
		expect(result.label).toBe('Items: 1, , 3')
	})

	it('interpolates multiple references in one string', () => {
		const result = parse(`
			first: John
			last: Doe
			full: ($first) ($last)
		`)
		expect(result.full).toBe('John Doe')
	})

	it('interpolates a ($key) and a (%key) in the same string', () => {
		const result = parse(
			`
			tag: JS
			label: ($tag) by (%author)
		`,
			{ partials: { author: 'Alice' } },
		)
		expect(result.label).toBe('JS by Alice')
	})

	it('leaves unresolvable references unchanged in interpolated strings', () => {
		const result = parse(`
			greeting: Hello ($unknown)!
		`)
		expect(result.greeting).toBe('Hello ($unknown)!')
	})

	it('self-reference stays unchanged — key not yet defined when value is resolved', () => {
		expect(parse('a: ($a)')).toEqual({ a: '($a)' })
	})

	it('forward reference is resolved — referenced key appears later in the document', () => {
		const result = parse(`
			b: ($a)
			a: hello
		`)
		expect(result.b).toBe('hello')
		expect(result.a).toBe('hello')
	})

	it('forward reference preserves original type (number)', () => {
		const result = parse(`
			doubled: ($count)
			count: 42
		`)
		expect(result.doubled).toBe(42)
		expect(typeof result.doubled).toBe('number')
	})

	it('forward reference inside an array is resolved', () => {
		const result = parse(`
			tags:
			  - ($base)
			  - extra
			base: javascript
		`)
		expect(result.tags).toEqual(['javascript', 'extra'])
	})

	it('resolves chained references ($a)($b) via string interpolation', () => {
		const result = parse(`
			a: foo
			b: bar
			combined: ($a)($b)
		`)
		expect(result.combined).toBe('foobar')
	})

	it('resolves many references to the same target independently and correctly (reference-freedom cache)', () => {
		// Every ref* key points at the SAME `shared` subtree — a regression
		// guard for isReferenceFreeP's WeakMap cache: each copy must reflect
		// the shared target's actual content, not a stale or cross-
		// contaminated cached answer from a different reference site.
		const result = parse(`
			shared:
			  name: Alice
			  tags:
			    - a
			    - b
			ref1: ($shared)
			ref2: ($shared)
			ref3: ($shared)
			ref4: ($shared)
			label: Hi, ($shared.name)!
		`)
		expect(result.ref1).toEqual({ name: 'Alice', tags: ['a', 'b'] })
		expect(result.ref2).toEqual({ name: 'Alice', tags: ['a', 'b'] })
		expect(result.ref3).toEqual({ name: 'Alice', tags: ['a', 'b'] })
		expect(result.ref4).toEqual({ name: 'Alice', tags: ['a', 'b'] })
		expect(result.label).toBe('Hi, Alice!')
		// Copies must be independent objects, not the same reference reused.
		expect(result.ref1).not.toBe(result.ref2)
	})
})

describe('dotted-path references', () => {
	it('resolves ($a.b) as a pure reference preserving original type', () => {
		const result = parse(`
			site:
			  default:
			    count: 42
			total: ($site.default.count)
		`)
		expect(result.total).toBe(42)
		expect(typeof result.total).toBe('number')
	})

	it('interpolates ($a.b.c) embedded in a string', () => {
		const result = parse(`
			site:
			  default:
			    claim: Software, Tools, AI
			tagline: Ein Blog über ($site.default.claim).
		`)
		expect(result.tagline).toBe('Ein Blog über Software, Tools, AI.')
	})

	it('resolves forward dotted-path reference — key appears later in document', () => {
		const result = parse(`
			tagline: Ein Blog über ($site.default.claim).
			site:
			  default:
			    claim: Software, Tools, AI
		`)
		expect(result.tagline).toBe('Ein Blog über Software, Tools, AI.')
	})

	it('leaves unresolvable dotted path unchanged in interpolated string', () => {
		const result = parse(`
			tagline: Ein Blog über ($site.missing.claim).
		`)
		expect(result.tagline).toBe('Ein Blog über ($site.missing.claim).')
	})

	it('resolves two-level dotted path', () => {
		const result = parse(`
			a:
			  b: hello
			ref: ($a.b)
		`)
		expect(result.ref).toBe('hello')
	})

	it('leaves a dotted path unresolved when an intermediate segment is null', () => {
		const result = parse('site:\n  default: null\na: ($site.default.claim)\n')
		expect(result.a).toBe('($site.default.claim)')
	})

	it('leaves a dotted path unresolved when an intermediate segment is not a mapping', () => {
		const result = parse('site:\n  default: hello\na: ($site.default.claim)\n')
		expect(result.a).toBe('($site.default.claim)')
	})

	it('throws in strict mode when a dotted-path intermediate segment is not a mapping', () => {
		expect(() => parse('site:\n  default: hello\na: ($site.default.claim)\n', { strict: true })).toThrow('LIMA')
	})

	it('a pure array/mapping reference is a structural deep copy, never aliasing the original (References §3.1)', () => {
		const result = parse('tags: [a, b]\ncopy: ($tags)\n')
		expect(result.copy).toEqual(result.tags)
		expect(result.copy).not.toBe(result.tags)
		;(result.copy as unknown[]).push('mutated')
		expect(result.tags).toEqual(['a', 'b'])
	})

	it('two pure references to the same partial never share a nested Date instance (References §3.1)', () => {
		const result = parse('a: (%p)\nb: (%p)\n', {
			partials: { p: { d: new Date('2024-01-01T00:00:00Z') } },
		})
		const a = result.a as { d: Date }
		const b = result.b as { d: Date }
		expect(a).not.toBe(b)
		expect(a.d).not.toBe(b.d)
		expect(a.d.toISOString()).toBe(b.d.toISOString())
		a.d.setUTCFullYear(2030)
		expect(b.d.toISOString()).toBe('2024-01-01T00:00:00.000Z')
	})

	it('preserves numeric kind through a multi-hop deep-copy chain until final serialization', () => {
		// A float that looks like an integer (1000.0) must still serialize as
		// "1000" (canonical float rule), even after being deep-copied twice.
		const result = parse('a:\n  x: 1000.0\ncopy1: ($a)\ncopy2: ($copy1)\nlabel: Value is ($copy2.x).\n')
		expect(result.label).toBe('Value is 1000.')
	})
})

describe('partial value model — host-type validation', () => {
	it('rejects a cyclic partial value', () => {
		const cyclic: Record<string, unknown> = {}
		cyclic.self = cyclic
		expect(() => parse('a: (%c)', { partials: { c: cyclic } })).toThrow('cyclic reference')
	})

	it('rejects a class instance as a partial value, even though it has only own data properties', () => {
		class Foo {
			x = 1
		}
		expect(() => parse('a: (%c)', { partials: { c: new Foo() } })).toThrow('unsupported value type')
	})

	it('rejects a function as a partial value', () => {
		expect(() => parse('a: (%f)', { partials: { f: () => {} } })).toThrow('unsupported value type')
	})

	it('rejects a symbol as a partial value', () => {
		expect(() => parse('a: (%s)', { partials: { s: Symbol('x') } })).toThrow('unsupported value type')
	})

	it('rejects an accessor (getter) property inside a partial mapping', () => {
		const withAccessor: Record<string, unknown> = {}
		Object.defineProperty(withAccessor, 'x', { get: () => 1, enumerable: true })
		expect(() => parse('a: (%o)', { partials: { o: withAccessor } })).toThrow('accessor properties are not supported')
	})

	it('truncates a partial UTC Instant\'s milliseconds to zero, without rounding', () => {
		const result = parse('a: (%d)', { partials: { d: new Date('2024-03-01T09:00:00.999Z') } })
		expect((result.a as Date).getUTCMilliseconds()).toBe(0)
		expect((result.a as Date).toISOString()).toBe('2024-03-01T09:00:00.000Z')
	})
})

describe('one-hop limit order independence', () => {
	const expected = { a: '($b)', b: 42, c: 42 }

	it('resolves correctly with the normative a, b, c ordering', () => {
		const result = parse('a: ($b)\nb: ($c)\nc: 42\n')
		expect(result).toEqual(expected)
	})

	it('resolves identically when c is written first (b\'s hop now falls in phase 1)', () => {
		const result = parse('c: 42\na: ($b)\nb: ($c)\n')
		expect(result).toEqual(expected)
	})

	it('resolves identically with b, c, a ordering', () => {
		const result = parse('b: ($c)\nc: 42\na: ($b)\n')
		expect(result).toEqual(expected)
	})

	it('stays order-independent with unrelated keys interspersed', () => {
		const result = parse('x: u1\na: ($b)\ny: u2\nb: ($c)\nz: u3\nc: 42\n')
		expect(result).toMatchObject(expected)
		const reordered = parse('z: u3\ny: u2\nx: u1\na: ($b)\nb: ($c)\nc: 42\n')
		expect(reordered).toMatchObject(expected)
	})

	it('throws for a in strict mode regardless of ordering', () => {
		expect(() => parse('a: ($b)\nb: ($c)\nc: 42\n', { strict: true })).toThrow('($b)')
		expect(() => parse('c: 42\na: ($b)\nb: ($c)\n', { strict: true })).toThrow('($b)')
	})
})

describe('error ordering by source position', () => {
	it('reports the earlier unresolved reference over a later mapping-interpolation error', () => {
		expect(() => parse('a: ($missing)\nb:\n  x: 1\nc: Value ($b)\n', { strict: true }))
			.toThrow('($missing)')
	})

	it('reports the earlier mapping-interpolation error over a later unresolved reference', () => {
		expect(() => parse('c: Value ($b)\nb:\n  x: 1\na: ($missing)\n', { strict: true }))
			.toThrow('mapping cannot be interpolated')
	})

	it('reports a correct, non-zero line for a mapping-interpolation error resolved in phase 2 in non-strict mode', () => {
		// Both modes always throw for this error type — regression guard for a
		// bug where phase 2's line number was only computed in strict mode,
		// so this specific error (which can first surface in phase 2) reported
		// "at line 0" in non-strict mode.
		expect(() => parse('c: ($b) text\nb:\n  x: 1\n')).toThrow('at line 1')
	})
})

describe('quoted reference tokens', () => {
	it('stays literal at the top level', () => {
		const result = parse(`
			source: 42
			value: "($source)"
		`)
		expect(result.value).toBe('($source)')
	})

	it('stays literal nested inside a block mapping', () => {
		const result = parse(`
			source: 42
			wrapper:
			  value: "($source)"
		`)
		expect((result.wrapper as any).value).toBe('($source)')
	})

	it('stays literal nested inside a block array item', () => {
		const result = parse(`
			source: 42
			list:
			  - "($source)"
		`)
		expect(result.list).toEqual(['($source)'])
	})

	it('stays literal nested inside a flow mapping', () => {
		const result = parse(`
			source: 42
			wrapper: {value: "($source)"}
		`)
		expect((result.wrapper as any).value).toBe('($source)')
	})

	it('stays literal nested inside a flow sequence', () => {
		const result = parse(`
			source: 42
			list: ["($source)", other]
		`)
		expect(result.list).toEqual(['($source)', 'other'])
	})

	it('stays literal for a forward reference (phase 2), not just backward', () => {
		const result = parse(`
			wrapper:
			  value: "($source)"
			source: 42
		`)
		expect((result.wrapper as any).value).toBe('($source)')
	})

	it('does not trigger a strict-mode unresolved-reference error when nested', () => {
		expect(() => parse(`
			wrapper:
			  value: "($source)"
		`, { strict: true })).not.toThrow()
	})

	it('never leaks the internal inactive-value marker to the public result', () => {
		const result = parse(`wrapper:\n  value: "($source)"`)
		const nested = (result.wrapper as any).value
		expect(typeof nested).toBe('string')
		expect(Object.getOwnPropertySymbols(result.wrapper as any)).toHaveLength(0)
	})
})

})
