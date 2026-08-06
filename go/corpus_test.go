package lima

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

type corpusCase struct {
	ID        string `json:"id"`
	Input     string `json:"input"`
	InputFile string `json:"inputFile"`
	Options   struct {
		Strict   bool           `json:"strict"`
		Partials map[string]any `json:"partials"`
	} `json:"options"`
	Generator *struct {
		Name       string         `json:"name"`
		Parameters map[string]any `json:"parameters"`
	} `json:"generator"`
	Expect struct {
		Result any        `json:"result"`
		Error  *LimaError `json:"error"`
	} `json:"expect"`
}

func corpusInput(c corpusCase, dir string) (string, bool) {
	if c.InputFile != "" {
		b, e := os.ReadFile(filepath.Join(dir, c.InputFile))
		return string(b), e == nil
	}
	if c.Generator == nil {
		return c.Input, true
	}
	p := c.Generator.Parameters
	switch c.Generator.Name {
	case "repeated-key":
		n := int(p["count"].(float64))
		pre := "k"
		if x, ok := p["keyPrefix"].(string); ok {
			pre = x
		}
		v := "v"
		if x, ok := p["value"].(string); ok {
			v = x
		}
		a := make([]string, n)
		for i := range n {
			a[i] = fmt.Sprintf("%s%d: %s", pre, i, v)
		}
		return strings.Join(a, "\n"), true
	case "repeated-scalar":
		return fmt.Sprintf("%s: %s", p["key"], strings.Repeat(p["codePoint"].(string), int(p["length"].(float64)))), true
	case "nested-mappings":
		d := int(p["depth"].(float64))
		k := "k"
		if x, ok := p["key"].(string); ok {
			k = x
		}
		leaf := "v"
		if x, ok := p["leafValue"].(string); ok {
			leaf = x
		}
		a := make([]string, d+1)
		for i := 0; i < d; i++ {
			a[i] = strings.Repeat("  ", i) + k + ":"
		}
		a[d] = strings.Repeat("  ", d) + k + ": " + leaf
		return strings.Join(a, "\n"), true
	case "document-bytes":
		length := int(p["length"].(float64))
		fill := "x"
		if x, ok := p["fillCodePoint"].(string); ok {
			fill = x
		}
		lines := []string{}
		remaining := length
		for index := 0; remaining > 0; index++ {
			if len(lines) > 0 {
				remaining--
			}
			prefix := fmt.Sprintf("k%d: ", index)
			budget := remaining - len(prefix)
			count := budget / len([]byte(fill))
			if count > 1000 {
				count = 1000
			}
			lines = append(lines, prefix+strings.Repeat(fill, count))
			remaining -= len(prefix) + count*len([]byte(fill))
		}
		return strings.Join(lines, "\n"), true
	}
	return "", false
}
func equalCorpus(v Value, e any) bool {
	switch x := v.(type) {
	case Null:
		return e == nil
	case Bool:
		y, ok := e.(bool)
		return ok && bool(x) == y
	case Int64:
		y, ok := e.(float64)
		return ok && float64(x) == y
	case Float64:
		y, ok := e.(float64)
		return ok && float64(x) == y
	case String:
		y, ok := e.(string)
		return ok && string(x) == y
	case Instant:
		y, ok := e.(map[string]any)
		return ok && y["$type"] == "instant" && y["value"] == x.ISOString()
	case Array:
		y, ok := e.([]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for i := range x {
			if !equalCorpus(x[i], y[i]) {
				return false
			}
		}
		return true
	case Map:
		y, ok := e.(map[string]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for _, z := range x {
			ev, ok := y[z.Key]
			if !ok || !equalCorpus(z.Value, ev) {
				return false
			}
		}
		return true
	}
	return false
}
func TestCoreCorpus(t *testing.T) {
	paths, globErr := filepath.Glob("../corpus/core/*.json")
	if globErr != nil {
		t.Fatal(globErr)
	}
	sort.Strings(paths)
	pass := 0
	skip := 0
	for _, path := range paths {
		b, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatal(readErr)
		}
		var c corpusCase
		if e := json.Unmarshal(b, &c); e != nil {
			t.Fatal(e)
		}
		input, ok := corpusInput(c, filepath.Dir(path))
		if !ok {
			skip++
			continue
		}
		got, e := ParseCore(input, c.Options.Strict)
		if c.Expect.Error != nil {
			var le *LimaError
			if e == nil {
				t.Errorf("%s: expected %s", c.ID, c.Expect.Error.Code)
			} else if !errorAs(e, &le) || !diagnosticMatches(le, c.Expect.Error) {
				t.Errorf("%s: got %v expected %s", c.ID, e, c.Expect.Error.Code)
			} else {
				pass++
			}
		} else if e != nil {
			t.Errorf("%s: unexpected %v", c.ID, e)
		} else if !equalCorpus(got, c.Expect.Result) {
			t.Errorf("%s: mismatch %#v != %#v", c.ID, got, c.Expect.Result)
		} else {
			pass++
		}
	}
	if pass+skip != len(paths) {
		t.Fatalf("core corpus accounting mismatch: %d passed + %d skipped != %d fixtures", pass, skip, len(paths))
	}
	t.Logf("core corpus: %d/%d (%d skipped)", pass, len(paths), skip)
	_ = math.NaN()
}
func errorAs(err error, target **LimaError) bool {
	return errors.As(err, target)
}
func diagnosticMatches(got, want *LimaError) bool {
	if got == nil || got.Code != want.Code {
		return false
	}
	if want.Line != 0 && got.Line != want.Line {
		return false
	}
	if want.Column != 0 && got.Column != want.Column {
		return false
	}
	if want.Token != "" && got.Token != want.Token {
		return false
	}
	if want.Key != "" && got.Key != want.Key {
		return false
	}
	if want.Partial != "" && got.Partial != want.Partial {
		return false
	}
	if want.Path != "" && got.Path != want.Path {
		return false
	}
	return true
}

func jsonValue(v any) Value {
	switch x := v.(type) {
	case nil:
		return Null{}
	case bool:
		return Bool(x)
	case float64:
		return Float64(x)
	case string:
		return String(x)
	case []any:
		a := make(Array, len(x))
		for i, z := range x {
			a[i] = jsonValue(z)
		}
		return a
	case map[string]any:
		if x["$type"] == "instant" {
			i, _ := parseDateUTC(x["value"].(string), false, 0)
			return *i
		}
		if x["$type"] == "host-number" {
			switch x["value"] {
			case "nan":
				return Float64(math.NaN())
			case "infinity":
				return Float64(math.Inf(1))
			case "-infinity":
				return Float64(math.Inf(-1))
			case "-0":
				return Float64(math.Copysign(0, -1))
			}
		}
		if x["$type"] == "host-date" {
			return Instant{EpochSeconds: daysFromCivil(10000, 1, 1) * 86400}
		}
		m := Map{}
		for k, z := range x {
			m = append(m, Entry{k, jsonValue(z)})
		}
		return m
	}
	return Null{}
}
func referencesInput(c corpusCase) (string, map[string]Value, bool) {
	p := map[string]Value{}
	for k, v := range c.Options.Partials {
		p[k] = jsonValue(v)
	}
	if c.Generator == nil {
		return c.Input, p, true
	}
	q := c.Generator.Parameters
	switch c.Generator.Name {
	case "nested-mappings":
		s, ok := corpusInput(c, "../corpus/references")
		return s, p, ok
	case "partial-count":
		n := int(q["count"].(float64))
		pre := "p"
		if x, ok := q["namePrefix"].(string); ok {
			pre = x
		}
		for i := range n {
			p[fmt.Sprintf("%s%d", pre, i)] = String("v")
		}
		return "", p, true
	case "partial-node-tree":
		n := int(q["totalNodes"].(float64))
		name := "big"
		if x, ok := q["partialName"].(string); ok {
			name = x
		}
		a := make(Array, n-1)
		for i := range a {
			a[i] = Int64(1)
		}
		p[name] = a
		return "", p, true
	case "result-node-expansion":
		n := int(q["topLevelKeys"].(float64))
		nodes := int(q["partialNodes"].(float64))
		name := "big"
		if x, ok := q["partialName"].(string); ok {
			name = x
		}
		a := make(Array, nodes-1)
		for i := range a {
			a[i] = Int64(1)
		}
		p[name] = a
		ls := make([]string, n)
		for i := range n {
			ls[i] = fmt.Sprintf("k%d: (%%%s)", i, name)
		}
		return strings.Join(ls, "\n"), p, true
	}
	return "", nil, false
}
func TestReferencesCorpus(t *testing.T) {
	paths, globErr := filepath.Glob("../corpus/references/*.json")
	if globErr != nil {
		t.Fatal(globErr)
	}
	sort.Strings(paths)
	pass := 0
	skip := 0
	for _, path := range paths {
		b, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatal(readErr)
		}
		var c corpusCase
		if e := json.Unmarshal(b, &c); e != nil {
			t.Fatal(e)
		}
		input, p, ok := referencesInput(c)
		if !ok {
			skip++
			continue
		}
		got, e := ParseReferences(input, ReferencesOptions{Partials: p, Strict: c.Options.Strict})
		if c.Expect.Error != nil {
			var le *LimaError
			if e == nil {
				t.Errorf("%s expected %s", c.ID, c.Expect.Error.Code)
			} else if !errorAs(e, &le) || !diagnosticMatches(le, c.Expect.Error) {
				t.Errorf("%s got %v expected %s", c.ID, e, c.Expect.Error.Code)
			} else {
				pass++
			}
		} else if e != nil {
			t.Errorf("%s unexpected %v", c.ID, e)
		} else if !equalCorpus(got, c.Expect.Result) {
			t.Errorf("%s mismatch", c.ID)
		} else {
			pass++
		}
	}
	if pass+skip != len(paths) {
		t.Fatalf("references corpus accounting mismatch: %d passed + %d skipped != %d fixtures", pass, skip, len(paths))
	}
	t.Logf("references corpus: %d/%d (%d skipped)", pass, len(paths), skip)
}
