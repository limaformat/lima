/** Manual outline scaling sweep; run `bun bench/outline.ts [--json]`. */
import { outline } from '../src/outline'
import { createBench, JSON_OUTPUT, type BenchResult } from './helpers'

const results: BenchResult[] = []
const bench = createBench(results)
for (const count of [256, 512, 1024, 2048]) {
	const input = 'r:\n' + Array.from({ length: count }, (_, i) => `  k${i}: [[], 1]\n`).join('')
	bench(`${count} malformed lines`, () => outline(input), Math.max(5, Math.floor(2000 / count)))
}
for (const count of [100, 500, 1000, 2000, 4000]) {
	const input = 'r:\n' + Array.from({ length: count }, (_, i) => `  k${i}: 1\n`).join('')
	bench(`${count} nested keys`, () => outline(input), Math.max(5, Math.floor(2000 / count)))
}
for (const count of [1000, 2000, 4000]) {
	const input = 'r: {' + Array.from({ length: count }, (_, i) => `k${i}: 1`).join(', ') + '}\n'
	bench(`${count} flow keys`, () => outline(input), 5)
}
if (JSON_OUTPUT) console.log(JSON.stringify(results, null, 2))
