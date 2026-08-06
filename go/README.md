# Lima for Go

Zero-dependency Go implementation of Lima Core 1.0 and Lima References 1.0.

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
    value, err := lima.ParseReferences(
        "title: Hello World\npublished: 2024-03-01\ndraft: false\n",
        lima.ReferencesOptions{},
    )
    if err != nil { panic(err) }
    fmt.Printf("%#v\n", value)
}
```

Use `ParseCore(input, strict)` when references and interpolation must remain
literal text. Use `ParseReferences(input, options)` for document references,
partials, interpolation, and two-phase forward-reference resolution.

The returned `Value` has the concrete forms `Null`, `Bool`, `Int64`,
`Float64`, `String`, `Instant`, `Array`, and insertion-ordered `Map`.
`LimaError` exposes stable diagnostic fields and works with `errors.As`.
