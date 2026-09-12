# Lima for Go

Zero-dependency Go implementation of Lima Core 1.0 and Lima References 2.0.

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

`Parse` enables References 2.0 by default: `${key}` reads document values and
`$(partial)` reads supplied partials. Use `ModeCore` or `ParseCore` when tokens
must remain literal. `ParseReferences` is retained as a deprecated alias for
`Parse`. `ParseCoreWithOptions` and `ParseOptions` accept duplicate-key warning
callbacks.

The returned `Value` has the concrete forms `Null`, `Bool`, `Int64`,
`Float64`, `String`, `Instant`, `Array`, and insertion-ordered `Map`.
`LimaError` exposes stable diagnostic fields and works with `errors.As`.

The implementation is verified against the shared conformance corpus: 211
Lima Core 1.0 cases (a byte-frozen 149-case 1.0.0 baseline plus additive
errata through 1.0.9), 136 References 2.0 cases, and the 101-case frozen
References 1.0 corpus (a regression target only — its resolver is not part
of the published module). All counts are pinned; zero cases skipped.
