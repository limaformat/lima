/** Cross-language Lima scenarios shared with rust/benches/cross_language.rs
 * and go/bench. Manual only; `--json` emits machine-readable results. */
import { parseCore,parseReferences } from '../src/index'
import { createBench,JSON_OUTPUT,type BenchResult } from './helpers'
const results:BenchResult[]=[];const run=createBench(results)
const typical=`title: My Blog Post
slug: my-blog-post
date: 2024-03-01T09:00:00Z
draft: false
author: Alice
tags: [javascript, webdev, tutorial]
excerpt: A short excerpt about the post, nothing fancy.
readingTime: 4.5
category: Engineering
`
run('core typical',()=>parseCore(typical),20000)
run('references no references',()=>parseReferences(typical),20000)
const refs=`siteName: My Site
title: Hello ($siteName)!
byline: Written by ($author)
author: Alice
tagline: (%tagline)
`
run('references small document',()=>parseReferences(refs,{partials:{tagline:'Welcome'}}),20000)
const deep='a:\n'+Array.from({length:15},(_,i)=>'  '.repeat(i+1)+'k:\n').join('')+'  '.repeat(16)+'leaf: v\n'
run('core maximum nesting depth',()=>parseCore(deep),20000)
const keys=Array.from({length:128},(_,i)=>`k${i}: value${i}`).join('\n')+'\n'
run('core 128 top-level keys',()=>parseCore(keys),5000)
const wide='items:\n'+Array.from({length:1000},(_,i)=>`  - item${i}`).join('\n')+'\n'
run('core wide block array',()=>parseCore(wide),2000)
const interp=Array.from({length:20},(_,i)=>`k${i}: v${i}`).join('\n')+'\nsummary: '+Array.from({length:20},(_,i)=>`($k${i})`).join(' ')+' \n'
run('references interpolation-heavy',()=>parseReferences(interp),10000)
const big=Array.from({length:1999},(_,i)=>i);const partialDoc=Array.from({length:16},(_,i)=>`k${i}: (%big)`).join('\n')+'\n'
run('references large partial copies',()=>parseReferences(partialDoc,{partials:{big}}),200)
for(const n of [100,200,400,800,1600]){const doc='root:\n'+Array.from({length:n},(_,i)=>`  k${i}: v${i}`).join('\n')+'\n';run(`scaling keys/${n}`,()=>parseCore(doc),Math.max(50,Math.floor(20000/n)))}
for(const n of [50,100,200,400,800,1600,3200]){const doc='base: 42\nrefs:\n'+Array.from({length:n},(_,i)=>`  k${i}: ($base)`).join('\n')+'\n';if(new TextEncoder().encode(doc).length<=65536)run(`scaling references/${n}`,()=>parseReferences(doc),Math.max(30,Math.floor(5000/n)))}
if(JSON_OUTPUT)console.log(JSON.stringify(results.map(r=>({...r,implementation:'typescript-lima-bun'})),null,2))
