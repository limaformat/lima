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
	API       string `json:"api"`
	Input     string `json:"input"`
	InputFile string `json:"inputFile"`
	Options   struct {
		Strict   bool           `json:"strict"`
		Mode     ParseMode      `json:"mode"`
		Partials map[string]any `json:"partials"`
	} `json:"options"`
	Generator *struct {
		Name       string         `json:"name"`
		Parameters map[string]any `json:"parameters"`
	} `json:"generator"`
	Expect struct {
		Result   any        `json:"result"`
		Error    *LimaError `json:"error"`
		Warnings []struct {
			Code LimaDiagnosticCode `json:"code"`
			Line int                `json:"line"`
			Key  string             `json:"key"`
		} `json:"warnings"`
	} `json:"expect"`
}

type referencesSyntaxVersion uint8

const (
	referencesSyntaxV1 referencesSyntaxVersion = 1
	referencesSyntaxV2 referencesSyntaxVersion = 2
)

func warningsMatch(got []Diagnostic, c corpusCase) bool {
	if len(got) != len(c.Expect.Warnings) {
		return false
	}
	for i, want := range c.Expect.Warnings {
		if got[i].Line != want.Line || want.Key != "" && !strings.Contains(got[i].Message, want.Key) {
			return false
		}
	}
	return true
}

func references2Input(c corpusCase) (string, map[string]Value, bool) {
	input, partials, ok := referencesInput(c, referencesSyntaxV2)
	return input, partials, ok
}

func TestReferences2Corpus(t *testing.T) {
	paths, globErr := filepath.Glob("../corpus/references-2.0/*.json")
	if globErr != nil {
		t.Fatal(globErr)
	}
	sort.Strings(paths)
	if len(paths) != 131 {
		t.Fatalf("References 2.0 corpus count changed: %d", len(paths))
	}
	pass, skip := 0, 0
	for _, path := range paths {
		b, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatal(readErr)
		}
		var c corpusCase
		if err := json.Unmarshal(b, &c); err != nil {
			t.Fatal(err)
		}
		input, partials, ok := references2Input(c)
		if !ok {
			skip++
			continue
		}
		options := ParseOptions{Mode: c.Options.Mode, Partials: partials, Strict: c.Options.Strict}
		if c.Options.Partials == nil && len(partials) == 0 {
			options.Partials = nil
		}
		var got Value
		var err error
		var warnings []Diagnostic
		options.OnWarning = func(d Diagnostic) { warnings = append(warnings, d) }
		switch c.API {
		case "core":
			got, err = ParseCoreWithOptions(input, CoreOptions{Strict: c.Options.Strict, OnWarning: options.OnWarning})
		case "references":
			got, err = ParseReferences(input, options)
		default:
			got, err = Parse(input, options)
		}
		if c.Expect.Error != nil {
			var le *LimaError
			if err == nil {
				t.Errorf("%s expected %s", c.ID, c.Expect.Error.Code)
			} else if !errorAs(err, &le) || !diagnosticMatches(le, c.Expect.Error) {
				t.Errorf("%s got %#v expected %#v", c.ID, le, c.Expect.Error)
			} else {
				pass++
			}
		} else if err != nil {
			t.Errorf("%s unexpected %v", c.ID, err)
		} else if !equalCorpus(got, c.Expect.Result) {
			t.Errorf("%s mismatch: %#v != %#v", c.ID, got, c.Expect.Result)
		} else if !warningsMatch(warnings, c) {
			t.Errorf("%s warnings mismatch: %#v != %#v", c.ID, warnings, c.Expect.Warnings)
		} else {
			pass++
		}
	}
	if skip != 0 {
		t.Fatalf("References 2.0 corpus skipped %d cases", skip)
	}
	if pass != len(paths) {
		t.Fatalf("References 2.0 corpus: %d/%d", pass, len(paths))
	}
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

// frozenManifestCaseCount reads the pinned case count from a frozen
// manifest (baseline + any errata additions), so the corpus test
// count-pins against the manifest rather than a hard-coded number.
func frozenManifestCaseCount(t *testing.T, manifestPath string) int {
	t.Helper()
	b, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var m struct {
		CaseCount int `json:"caseCount"`
	}
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	return m.CaseCount
}

func TestCoreCorpus(t *testing.T) {
	paths, globErr := filepath.Glob("../corpus/core/*.json")
	if globErr != nil {
		t.Fatal(globErr)
	}
	sort.Strings(paths)
	if manifestCount := frozenManifestCaseCount(t, "../corpus/manifests/core-1.0.json"); len(paths) != manifestCount {
		t.Fatalf("Core corpus count does not match the manifest: %d != %d", len(paths), manifestCount)
	}
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
		var warnings []Diagnostic
		got, e := ParseCoreWithOptions(input, CoreOptions{Strict: c.Options.Strict, OnWarning: func(d Diagnostic) { warnings = append(warnings, d) }})
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
		} else if !warningsMatch(warnings, c) {
			t.Errorf("%s: warning mismatch %#v != %#v", c.ID, warnings, c.Expect.Warnings)
		} else {
			pass++
		}
	}
	if pass+skip != len(paths) {
		t.Fatalf("core corpus accounting mismatch: %d passed + %d skipped != %d fixtures", pass, skip, len(paths))
	}
	if skip != 0 {
		t.Fatalf("Core corpus skipped %d cases", skip)
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
func resultNodeExpansionInput(topLevelKeys, partialNodes int, partialName string, referencesVersion referencesSyntaxVersion) (string, map[string]Value) {
	var referenceFormat string
	switch referencesVersion {
	case referencesSyntaxV1:
		referenceFormat = "k%d: (%%%s)"
	case referencesSyntaxV2:
		referenceFormat = "k%d: $(%s)"
	default:
		panic(fmt.Sprintf("unsupported references syntax version %d", referencesVersion))
	}
	a := make(Array, partialNodes-1)
	for i := range a {
		a[i] = Int64(1)
	}
	partials := map[string]Value{partialName: a}
	lines := make([]string, topLevelKeys)
	for i := range topLevelKeys {
		lines[i] = fmt.Sprintf(referenceFormat, i, partialName)
	}
	return strings.Join(lines, "\n"), partials
}

func referencesInput(c corpusCase, referencesVersion referencesSyntaxVersion) (string, map[string]Value, bool) {
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
		input, generatedPartials := resultNodeExpansionInput(n, nodes, name, referencesVersion)
		for key, value := range generatedPartials {
			p[key] = value
		}
		return input, p, true
	}
	return "", nil, false
}

func TestResultNodeExpansionUsesReferencesVersionSyntax(t *testing.T) {
	v1, _ := resultNodeExpansionInput(2, 2, "big", referencesSyntaxV1)
	if v1 != "k0: (%big)\nk1: (%big)" {
		t.Fatalf("unexpected References 1.0 input: %q", v1)
	}
	v2, partials := resultNodeExpansionInput(2, 2, "big", referencesSyntaxV2)
	if v2 != "k0: $(big)\nk1: $(big)" {
		t.Fatalf("unexpected References 2.0 input: %q", v2)
	}
	if len(partials) != 1 {
		t.Fatalf("unexpected generated partials: %#v", partials)
	}
	t.Run("unsupported version", func(t *testing.T) {
		defer func() {
			if recover() == nil {
				t.Fatal("expected unsupported syntax version to panic")
			}
		}()
		resultNodeExpansionInput(1, 2, "big", referencesSyntaxVersion(3))
	})
}

func TestReferencesCorpus(t *testing.T) {
	paths, globErr := filepath.Glob("../corpus/references/*.json")
	if globErr != nil {
		t.Fatal(globErr)
	}
	sort.Strings(paths)
	if len(paths) != 101 {
		t.Fatalf("References 1.0 corpus count changed: %d", len(paths))
	}
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
		input, p, ok := referencesInput(c, referencesSyntaxV1)
		if !ok {
			skip++
			continue
		}
		got, e := parseReferencesV1(input, references1Options{Partials: p, Strict: c.Options.Strict})
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
	if skip != 0 {
		t.Fatalf("References 1.0 corpus skipped %d cases", skip)
	}
	t.Logf("references corpus: %d/%d (%d skipped)", pass, len(paths), skip)
}
