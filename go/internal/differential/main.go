// Command differential is the Go side of the differential test
// (corpus/runner/src/differential.ts): it reads a JSON array of documents
// from stdin and writes, for each, the non-strict and the strict ParseCore
// outcome as JSON — the value (a date as {"$date": …}) with the lines of its
// warnings, or the error's code and line.
package main

import (
	"encoding/json"
	"errors"
	"os"

	lima "github.com/limaformat/lima/go"
)

func encode(v lima.Value) any {
	switch x := v.(type) {
	case lima.Null:
		return nil
	case lima.Bool:
		return bool(x)
	case lima.Int64:
		return int64(x)
	case lima.Float64:
		return float64(x)
	case lima.String:
		return string(x)
	case lima.Instant:
		return map[string]string{"$date": x.ISOString()}
	case lima.Array:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = encode(e)
		}
		return out
	case lima.Map:
		out := make(map[string]any, len(x))
		for _, e := range x {
			out[e.Key] = encode(e.Value)
		}
		return out
	}
	panic("differential: unknown value type")
}

func main() {
	var documents []string
	if err := json.NewDecoder(os.Stdin).Decode(&documents); err != nil {
		panic(err)
	}
	out := make([]any, 0, len(documents)*2)
	for _, document := range documents {
		for _, strict := range []bool{false, true} {
			warnings := []int{}
			v, err := lima.ParseCoreWithOptions(document, lima.CoreOptions{
				Strict:    strict,
				OnWarning: func(d lima.Diagnostic) { warnings = append(warnings, d.Line) },
			})
			var le *lima.LimaError
			switch {
			case errors.As(err, &le):
				out = append(out, map[string]any{"error": string(le.Code), "line": le.Line})
			case err != nil:
				panic(err)
			default:
				out = append(out, map[string]any{"value": encode(v), "warnings": warnings})
			}
		}
	}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		panic(err)
	}
}
