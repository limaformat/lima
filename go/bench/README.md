# Lima Go benchmarks

Manual, non-gating performance benchmarks for the Go port. Run them on an
otherwise idle machine; build time and process startup are outside every
timed loop. Results compare speed, not syntax compatibility—Lima deliberately
does not implement all of YAML.

## Dependency isolation and YAML choice

This directory is a separate Go module. Its dependencies never enter
`../go.mod`, so the published Lima module remains dependency-free.

The YAML reference is `go.yaml.in/yaml/v3 v3.0.4`. It is the maintained,
canonical successor to the archived `gopkg.in/yaml.v3` repository and keeps
the v3 API. The comparison calls `yaml.Unmarshal` into `any`, while Lima calls
`ParseCore(document, false)`. References are never compared with YAML because
YAML has no equivalent feature.

## Go benchmark output

```sh
cd go/bench
go test -bench=. -benchmem -count=10
```

This reports Go's calibrated `ns/op`, `B/op`, and `allocs/op`. Error paths are
separate benchmarks. For before/after work:

```sh
go test -bench=. -benchmem -count=10 > before.txt
go test -bench=. -benchmem -count=10 > after.txt
benchstat before.txt after.txt
```

`benchstat` is an optional external developer tool, not a module dependency.

## JSON and cross-language comparison

The custom Go runner reports median, p95, min/max, operations per second,
allocations and allocated bytes, plus OS, architecture, CPU, Go version, UTC
timestamp and Git revision:

```sh
cd go/bench
go run ./cmd/benchjson -samples 9 -iterations 2000 > go.json

cd ../../rust
cargo bench --bench cross_language -- --json > ../go/bench/rust.json

cd ../js
bun run bench:cross-language -- --json > ../go/bench/js.json

cd ../go/bench
node compare.mjs go.json rust.json js.json
```

The six Go-vs-YAML documents are identical to `js/bench/vs-yaml.ts` and
`rust/benches/vs_yaml.rs`. The cross-language scripts share names, document
construction, warm-up, seven or more independent samples, median/p95 output,
and the Core/References/scaling scenarios requested for this port.

Use release/optimized execution (`go test`, Rust's `cargo bench`, and Bun).
Run all languages on the same machine under the same CPU governor and quiet
system load. Cross-runtime results are contextual measurements, not an
absolute language ranking: allocators, garbage collectors, APIs and runtime
warm-up differ. Rust's consuming `ReferencesOptions` API takes ownership of
the partials, so the cross-language benchmark clones them on every call just
to keep reusing the same input across samples — on top of the deep copy
`parse_references` already makes internally (the same deep copy Go's
`ParseReferences` and JS's `parseReferences` also make). Reference-heavy
Rust numbers in this benchmark therefore reflect two copies, not one; Go and
JavaScript pass a reusable option value into the harness and only pay the
one internal copy.

The JSON aggregator does not combine unlike scenario names and does not claim
statistical significance. Preserve raw files with the runtime/compiler
versions and Git revision when publishing any result.

## Scenario inventory

Go versus YAML, Core only:

1. typical blog post (nine flat keys)
2. nested author plus block tag array
3. SEO-heavy nested mappings
4. 50-tag block array
5. ten author mappings
6. 50 mixed scalar keys

Cross-language Lima:

- typical Core and reference-free References parses
- document references plus a partial
- maximum permitted nesting and 128 top-level keys
- wide block array and interpolation-heavy input
- repeated copies of a large partial
- key-count and reference-count scaling sweeps
- separate Go error-path benchmarks
