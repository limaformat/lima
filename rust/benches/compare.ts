/** Compare two `cross_language --json` benchmark runs.
 * Usage: bun benches/compare.ts before.json after.json
 */
type Result = { name: string; medianUs: number }
const [beforePath, afterPath] = process.argv.slice(2)
if (!beforePath || !afterPath) throw new Error('usage: bun benches/compare.ts before.json after.json')
const before = JSON.parse(await Bun.file(beforePath).text()) as Result[]
const after = JSON.parse(await Bun.file(afterPath).text()) as Result[]
const baseline = new Map(before.map((row) => [row.name, row]))
let failed = false
for (const current of after) {
	const previous = baseline.get(current.name)
	if (!previous) continue
	const ratio = current.medianUs / previous.medianUs
	const limit = current.name.startsWith('core ') ? 1.05 : 1.10
	const marker = ratio > limit ? 'REGRESSION' : 'ok'
	console.log(`${marker.padEnd(10)} ${current.name}: ${(ratio * 100 - 100).toFixed(1)}%`)
	failed ||= ratio > limit
}
if (failed) process.exit(1)
