#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const files = process.argv.slice(2)
if (files.length < 2) {
  console.error('usage: node compare.mjs go.json rust.json js.json')
  process.exit(2)
}
const rows=[]
for(const file of files){const doc=JSON.parse(readFileSync(file,'utf8'));for(const r of Array.isArray(doc)?doc:doc.results)rows.push({...r,source:file})}
const groups=Map.groupBy(rows,r=>r.name)
for(const [name,items] of groups){if(items.length<2)continue;console.log(`\n${name}`);for(const r of items)console.log(`  ${(r.implementation??r.source).padEnd(24)} ${r.medianUs.toFixed(2).padStart(10)} us/op  p95 ${r.p95Us.toFixed(2).padStart(10)}  ${r.opsPerSec.toFixed(0).padStart(10)} ops/s`)}
