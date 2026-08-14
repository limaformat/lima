#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const [beforePath, afterPath] = process.argv.slice(2)
if (!beforePath || !afterPath) {
  console.error('usage: node regression.mjs before.json after.json')
  process.exit(2)
}

const rows = (path) => {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  return Array.isArray(parsed) ? parsed : parsed.results
}
const baseline = new Map(rows(beforePath).map((row) => [row.name, row]))
let failed = false
for (const current of rows(afterPath)) {
  const previous = baseline.get(current.name)
  if (!previous) continue
  const ratio = current.medianUs / previous.medianUs
  const limit = current.name.startsWith('core ') ? 1.05 : 1.10
  const marker = ratio > limit ? 'REGRESSION' : 'ok'
  console.log(`${marker.padEnd(10)} ${current.name}: ${(ratio * 100 - 100).toFixed(1)}%`)
  failed ||= ratio > limit
}
if (failed) process.exit(1)
