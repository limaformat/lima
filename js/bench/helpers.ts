/**
 * Shared timing helper for the manual benchmark scripts under `bench/`.
 * Not part of `bun test` and not a CI gate — timings are environment-
 * dependent and noisy by nature.
 */

export const JSON_OUTPUT = Bun.argv.includes('--json')
const SAMPLES = 7

export interface BenchResult {
	name: string
	iterations: number
	samples: number
	medianUs: number
	p95Us: number
	minUs: number
	maxUs: number
	opsPerSec: number
}

/** No-ops under `--json` so the only stdout output is the final JSON array. */
export function log(line: string): void {
	if (!JSON_OUTPUT) console.log(line)
}

/**
 * Returns a `bench()` function that appends every result to `results` (so
 * the caller can print it as JSON at the end) and, unless `--json` was
 * passed, logs a human-readable line immediately. Takes several
 * independent timing samples (not just one) and reports the median and
 * p95 per-op time — a single sample is easily skewed by GC pauses or OS
 * scheduling noise, which would make a genuine regression indistinguishable
 * from run-to-run jitter.
 */
export function createBench(results: BenchResult[]) {
	return function bench(name: string, fn: () => void, iterations: number): BenchResult {
		for (let i = 0; i < Math.min(iterations, 50); i++) fn() // warmup

		const perOpUs: number[] = []
		for (let s = 0; s < SAMPLES; s++) {
			const start = performance.now()
			for (let i = 0; i < iterations; i++) fn()
			perOpUs.push(((performance.now() - start) / iterations) * 1000)
		}
		perOpUs.sort((a, b) => a - b)

		const median = perOpUs[Math.floor(perOpUs.length / 2)]
		const p95 = perOpUs[Math.min(perOpUs.length - 1, Math.ceil(perOpUs.length * 0.95) - 1)]
		const min = perOpUs[0]
		const max = perOpUs[perOpUs.length - 1]
		const opsPerSec = 1_000_000 / median // median is in microseconds/op

		const result: BenchResult = { name, iterations, samples: SAMPLES, medianUs: median, p95Us: p95, minUs: min, maxUs: max, opsPerSec }
		results.push(result)
		log(
			`${name.padEnd(60)} median ${median.toFixed(2).padStart(9)} us/op  ` +
				`p95 ${p95.toFixed(2).padStart(9)} us/op  ${opsPerSec.toFixed(0).padStart(9)} ops/sec`
		)
		return result
	}
}
