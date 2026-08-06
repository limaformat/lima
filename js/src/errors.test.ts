import { describe, it, expect } from 'bun:test'
import { LimaError, type LimaDiagnostic } from './errors.js'

describe('LimaError', () => {
	it('is a real Error subclass — instanceof Error holds (Core §11.3)', () => {
		const err = new LimaError({ code: 'INVALID_DATE', message: 'Lima: invalid date "x" at line 1', line: 1 })
		expect(err).toBeInstanceOf(Error)
		expect(err).toBeInstanceOf(LimaError)
	})

	it('carries the diagnostic message as .message, unchanged', () => {
		const message = 'Lima: invalid date "x" at line 1'
		const err = new LimaError({ code: 'INVALID_DATE', message, line: 1 })
		expect(err.message).toBe(message)
	})

	it('exposes structured fields alongside the message', () => {
		const diagnostic: LimaDiagnostic = {
			code: 'DUPLICATE_KEY', message: 'Lima: duplicate key "a" at line 3', line: 3, key: 'a',
		}
		const err = new LimaError(diagnostic)
		expect(err.code).toBe('DUPLICATE_KEY')
		expect(err.line).toBe(3)
		expect(err.key).toBe('a')
		expect(err.token).toBeUndefined()
	})

	it('is catchable and narrowable via instanceof in a normal try/catch', () => {
		const throwIt = () => {
			throw new LimaError({ code: 'INVALID_PARTIAL', message: 'Lima: invalid partial "p" at path "x": reason' })
		}
		try {
			throwIt()
			expect.unreachable()
		} catch (e) {
			expect(e).toBeInstanceOf(LimaError)
			if (e instanceof LimaError) expect(e.code).toBe('INVALID_PARTIAL')
		}
	})
})
