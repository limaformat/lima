# Lima for Go

Zero-dependency Go implementation of Lima Core <!-- facts:language.core_version -->1.2<!-- /facts --> and Lima References <!-- facts:language.references_version -->2.1<!-- /facts -->.

## Install

```sh
go get github.com/limaformat/lima/go
```

## Quickstart

```go
package main

import (
    "fmt"
    lima "github.com/limaformat/lima/go"
)

func main() {
    value, err := lima.Parse(
        "title: Hello World\npublished: 2024-03-01\ndraft: false\n",
        lima.ParseOptions{},
    )
    if err != nil { panic(err) }
    fmt.Printf("%#v\n", value)
}
```

`Parse` enables References <!-- facts:language.references_version -->2.1<!-- /facts --> by default: `${key}` reads document values and
`$(partial)` reads supplied partials. Use `ModeCore` or `ParseCore` when tokens
must remain literal. `ParseReferences` is retained as a deprecated alias for
`Parse`. `ParseCoreWithOptions` and `ParseOptions` accept duplicate-key warning
callbacks.

The returned `Value` has the concrete forms `Null`, `Bool`, `Int64`,
`Float64`, `String`, `Instant`, `Array`, and insertion-ordered `Map`.
`LimaError` exposes stable diagnostic fields and works with `errors.As`.

The implementation is verified against the shared conformance corpus: <!-- facts:corpus.default.core_cases -->479<!-- /facts -->
Lima Core <!-- facts:language.core_version -->1.2<!-- /facts --> cases (the <!-- facts:corpus.suites.core_1_0.cases -->218<!-- /facts --> Core 1.0 cases — a byte-frozen <!-- facts:corpus.suites.core_1_0.baseline_cases -->149<!-- /facts -->-case 1.0.0
baseline plus additive errata through <!-- facts:corpus.suites.core_1_0.latest_errata_version -->1.0.10<!-- /facts --> — without the <!-- facts:corpus.suites.core_1_1.superseded_core_1_0_cases -->8<!-- /facts --> Core 1.1
supersedes, plus <!-- facts:corpus.suites.core_1_1.cases -->126<!-- /facts --> Core 1.1 and <!-- facts:corpus.suites.core_1_2.cases -->143<!-- /facts --> Core 1.2 cases), <!-- facts:corpus.default.references_cases -->141<!-- /facts --> References <!-- facts:language.references_version -->2.1<!-- /facts --> cases, and the <!-- facts:corpus.suites.references_1_0.cases -->101<!-- /facts -->-case frozen
References 1.0 corpus (a regression target only — its resolver is not part
of the published module). All counts are pinned; zero cases skipped.
