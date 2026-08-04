/**
 * Typed corpus values, as defined in docs/corpus-design/README.md §5.
 *
 * JSON cannot natively express every host value the corpus needs (UTC
 * instants, NaN, -0, invalid dates). These typed markers are corpus
 * representations, not Lima values — `materialize` turns them into the
 * concrete host (JavaScript) representation each runner compares against.
 */

export type CorpusValue =
	| null
	| boolean
	| number
	| string
	| CorpusValue[]
	| InstantMarker
	| HostNumberMarker
	| HostDateMarker
	| CorpusMapping

export interface InstantMarker {
	$type: 'instant'
	value: string
}

export type HostNumberLiteral = 'nan' | 'infinity' | '-infinity' | '-0'

export interface HostNumberMarker {
	$type: 'host-number'
	value: HostNumberLiteral
}

export type HostDateSentinel = 'invalid' | 'year-underflow' | 'year-overflow'

export interface HostDateMarker {
	$type: 'host-date'
	value: HostDateSentinel
}

export interface CorpusMapping {
	[key: string]: CorpusValue
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMarker(value: unknown): value is { $type: string; value: unknown } {
	return isPlainObject(value) && typeof value.$type === 'string'
}

const HOST_NUMBERS: Record<HostNumberLiteral, number> = {
	nan: NaN,
	infinity: Infinity,
	'-infinity': -Infinity,
	'-0': -0,
}

/**
 * Converts a typed corpus value into its concrete JavaScript representation.
 * Recurses into arrays and mappings. Throws if a `$type` marker is
 * malformed — that indicates a corpus or schema-validation defect, not a
 * value the runner should silently pass through.
 */
export function materialize(value: CorpusValue): unknown {
	if (value === null || typeof value !== 'object') return value

	if (Array.isArray(value)) return value.map(materialize)

	if (isMarker(value)) {
		switch (value.$type) {
			case 'instant': {
				const date = new Date(value.value as string)
				if (Number.isNaN(date.getTime())) {
					throw new Error(`materialize: invalid instant value "${value.value}"`)
				}
				return date
			}
			case 'host-number': {
				const literal = value.value as HostNumberLiteral
				if (!(literal in HOST_NUMBERS)) {
					throw new Error(`materialize: unknown host-number literal "${literal}"`)
				}
				return HOST_NUMBERS[literal]
			}
			case 'host-date': {
				const sentinel = value.value as HostDateSentinel
				switch (sentinel) {
					case 'invalid':
						return new Date(NaN)
					case 'year-underflow': {
						// Date.UTC(0, ...) would map year 0 to 1900 (the classic
						// two-digit-year quirk) — setUTCFullYear bypasses that.
						const date = new Date(0)
						date.setUTCFullYear(0, 0, 1)
						date.setUTCHours(0, 0, 0, 0)
						return date
					}
					case 'year-overflow':
						return new Date(Date.UTC(10000, 0, 1, 0, 0, 0))
					default:
						throw new Error(`materialize: unknown host-date sentinel "${sentinel}"`)
				}
			}
			default:
				throw new Error(`materialize: unknown $type "${(value as { $type: string }).$type}"`)
		}
	}

	const result: Record<string, unknown> = {}
	for (const [key, entry] of Object.entries(value as CorpusMapping)) {
		result[key] = materialize(entry)
	}
	return result
}
