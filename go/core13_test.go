package lima

import (
	"encoding/json"
	"strings"
	"testing"
)

// Lima Core 1.3: what it reads otherwise than Core 1.2, its errata, and the
// defects it touches. Mirrors js/src/core-1.3.test.ts; each test fails on the
// Core 1.2 implementation.

// expectValue parses input with ParseCore, or with Parse when references is
// set, and compares the result with want, written as JSON.
func expectValue(t *testing.T, input string, strict, references bool, want string) {
	t.Helper()
	var expected any
	if err := json.Unmarshal([]byte(want), &expected); err != nil {
		t.Fatalf("bad expectation %s: %v", want, err)
	}
	var got Value
	var err error
	if references {
		got, err = Parse(input, ParseOptions{Strict: strict})
	} else {
		got, err = ParseCore(input, strict)
	}
	if err != nil {
		t.Fatalf("%q (strict %v): %v", input, strict, err)
	}
	if !equalCorpus(got, expected) {
		t.Fatalf("%q (strict %v): got %#v, want %s", input, strict, got, want)
	}
}

// expectError parses input in strict mode and checks the error's code and
// line, and that its message ends with hint when one is given.
func expectError(t *testing.T, input string, code LimaDiagnosticCode, line int, hint string) {
	t.Helper()
	_, err := ParseCore(input, true)
	le, ok := err.(*LimaError)
	if !ok || le.Code != code || le.Line != line {
		t.Fatalf("%q: got %#v, want %s at line %d", input, err, code, line)
	}
	if hint != "" && !strings.HasSuffix(le.Message, " "+hint) {
		t.Fatalf("%q: message %q does not end with %q", input, le.Message, hint)
	}
}

func TestCore13HashAfterTextIsText(t *testing.T) {
	for _, strict := range []bool{false, true} {
		expectValue(t, "link: https://example.org/x#top\nlang: C#", strict, false, `{"link": "https://example.org/x#top", "lang": "C#"}`)
	}
	expectValue(t, "k: x\u00a0#c\nj: x\ufeff#c", false, false, `{"k": "x", "j": "x"}`)
	expectValue(t, "k: x\u0085#c", false, false, `{"k": "x\u0085#c"}`)
	expectValue(t, "k: [a,#x]\nj: [#x]", false, false, `{"k": ["a", "#x"], "j": ["#x"]}`)
	expectValue(t, "k: [a, #x]", false, false, `{"k": "[a,"}`)
	expectError(t, "k: [a, #x]", InvalidFlowSyntax, 1, "")
	expectValue(t, "k: {a: x#y}", false, false, `{"k": {"a": "x#y"}}`)
	expectValue(t, "k: \\#x\nj: \\\\#x\nq: '#x'\n'#': x", false, false, `{"k": "#x", "j": "\\#x", "q": "#x", "#": "x"}`)
}

func TestCore13FlowHashMapsToItsSourceForReferences(t *testing.T) {
	// Core 1.2 assumed every # in a decoded flow value came from \#
	expectValue(t, "a: 42\nb: [a#b,${a}]", false, true, `{"a": 42, "b": ["a#b", 42]}`)
	expectValue(t, "a: 42\nb: [\\#x,${a}]", false, true, `{"a": 42, "b": ["#x", 42]}`)
	_, err := Parse("b: [a#b, ${missing}]", ParseOptions{Strict: true})
	if le, ok := err.(*LimaError); !ok || le.Line != 1 || le.Column != 10 {
		t.Fatalf("got %#v, want line 1, column 10", err)
	}
	expectValue(t, "a: 42\nb: ${a}#x", false, true, `{"a": 42, "b": "42#x"}`)
	expectValue(t, "a: 42\nb: v#${a}", false, true, `{"a": 42, "b": "v#42"}`)
	expectValue(t, "a: 42\nb: ${a} #x", false, true, `{"a": 42, "b": 42}`)
	expectValue(t, "a: 42\nb: #${a}", false, true, `{"a": 42, "b": null}`)
}

func TestCore13CommentOnlyValueIsBareKey(t *testing.T) {
	expectValue(t, "k: # c\n  a: 1", true, false, `{"k": {"a": 1}}`)
	expectValue(t, "k: #c\n- x", true, false, `{"k": ["x"]}`)
	expectValue(t, "m:\n  k: # c\n    a: 1\n  j: #c\n  - x", true, false, `{"m": {"k": {"a": 1}, "j": ["x"]}}`)
	expectValue(t, "k:\n  - a: x\n    b: #c\n      c: 1", true, false, `{"k": [{"a": "x", "b": {"c": 1}}]}`)
	expectValue(t, "k:\n- a: 1\n  b: # c\n    c: 2\n  d: 3", true, false, `{"k": [{"a": 1, "b": {"c": 2}, "d": 3}]}`)
	expectValue(t, "k:\n  - b: # c\n      c: 1", true, false, `{"k": [{"b": {"c": 1}}]}`)
	expectValue(t, "k: # c\nj: 1", true, false, `{"k": null, "j": 1}`)
	// `- # note` is a null item that opens no block
	expectValue(t, "k:\n  - #c\n    a: 1", false, false, `{"k": [null]}`)
	expectError(t, "k:\n  - #c\n    a: 1", InvalidIndentation, 3, "")
	// `k: null` and `k: ''` are no bare keys
	expectValue(t, "k: null\n  a: 1\nj: ''\n  a: 1", false, false, `{"k": null, "j": ""}`)
	expectError(t, "k: null\n  a: 1", InvalidIndentation, 2, "")
	expectError(t, "m:\n  k: ''\n    a: 1", InvalidIndentation, 3, "")
}

func TestCore13TabSeparates(t *testing.T) {
	expectValue(t, "k:\t1\n'q':\t2\na:b:\t3\nf: {a:\t1}\nm:\n  n:\t4\ns:\n  - o:\t5\n    p:\t6", true, false,
		`{"k": 1, "q": 2, "a:b": 3, "f": {"a": 1}, "m": {"n": 4}, "s": [{"o": 5, "p": 6}]}`)
	expectValue(t, "k:\t", true, false, `{"k": null}`)
	expectValue(t, "k:\t\n  a: 1", true, false, `{"k": {"a": 1}}`)
	expectValue(t, "k:\u00a0x", false, false, `{}`)
	expectError(t, "k:\u00a0x", UnrecognizedLine, 1, "")
}

func TestCore13AnchorAliasTagIsStrictError(t *testing.T) {
	expectError(t, "k: &x", UnsupportedYAML, 1, "")
	expectError(t, "k:\n- *x", UnsupportedYAML, 2, "")
	expectError(t, "k: [!x]", UnsupportedYAML, 1, "")
	expectError(t, "k: {a: &x}", UnsupportedYAML, 1, "")
	expectError(t, "m:\n  k: !!str 1", UnsupportedYAML, 2, "")
	expectValue(t, "k: &x\nl: [!x]\nm: {a: &x}", false, false, `{"k": "&x", "l": ["!x"], "m": {"a": "&x"}}`)
	expectValue(t, "k: '&x'\nl: |\n  &x", true, false, `{"k": "&x", "l": "&x"}`)
	_, err := ParseCore("k: *new*", true)
	want := `Lima: unquoted value starting with "*" at line 1 (YAML reads it as an alias; Lima has no anchors, aliases or tags: quote the value)`
	if err == nil || err.Error() != want {
		t.Fatalf("got %v, want %s", err, want)
	}
}

func TestCore13BlockScalarHeaderIsStrictErrorAtItsLine(t *testing.T) {
	for _, header := range []string{">", "|-", "|+", "|2", ">2-", ">-9", ">+"} {
		expectError(t, "k: "+header, UnsupportedYAML, 1, "")
		expectError(t, "k: "+header+"\n  text", UnsupportedYAML, 1, "")
	}
	expectError(t, "k: [>]", UnsupportedYAML, 1, "")
	expectError(t, "k: > #c", UnsupportedYAML, 1, "")
	expectValue(t, "k: > #c", false, false, `{"k": ">"}`)
	expectValue(t, "a: >#c\nb: > text\nc: >0\nd: >10\ne: |--\nf: >word", true, false,
		`{"a": ">#c", "b": "> text", "c": ">0", "d": ">10", "e": "|--", "f": ">word"}`)
	expectValue(t, "m:\n  a: | # c\n    text", false, false, `{"m": {"a": "|"}}`)
	expectError(t, "m:\n  a: | # c\n    text", InvalidIndentation, 3, "")
	expectValue(t, "k: |\n  #x\n  ^^y", true, false, `{"k": "#x y"}`)
	expectValue(t, "k: >\n  text\nj: 1", false, false, `{"k": ">", "j": 1}`)
}

func TestCore13FlowMappingSeparatorBeforeTrimming(t *testing.T) {
	// Core 1.2's Go read {k: } as a string, and threw in strict mode
	for _, strict := range []bool{false, true} {
		expectValue(t, "a: {k: }\nb: {k:\t}\nc: {x: 1, k: }", strict, false, `{"a": {"k": null}, "b": {"k": null}, "c": {"x": 1, "k": null}}`)
	}
	expectValue(t, "a: {k:}", false, false, `{"a": "{k:}"}`)
	expectError(t, "a: {k:}", InvalidFlowSyntax, 1, "")
}

func TestCore12Errata(t *testing.T) {
	expectValue(t, "draft: false\u00a0\nn: 1\u3000 # c", true, false, `{"draft": false, "n": 1}`)
	// §3: a tab after U+2028 is no leading tab
	expectValue(t, "k: a\u2028\tb", false, false, `{"k": "a\u2028\tb"}`)
	expectValue(t, "k: |\n  \u00a0\tx", false, false, `{"k": "\u00a0\tx"}`)
	expectValue(t, "x: 1 \nk: a \u2028b", false, false, `{"x": 1, "k": "a \u2028b"}`)
	_, err := Parse("x: a\u2028\tb\ny:\n\t\tc: ${nope}", ParseOptions{Strict: true})
	if le, ok := err.(*LimaError); !ok || le.Line != 3 || le.Column != 6 {
		t.Fatalf("got %#v, want line 3, column 6", err)
	}
	// Appendix D: a single-quoted key admits no escape
	expectValue(t, "'a\\'b': x", false, false, `{}`)
	expectError(t, "'a\\'b': x", UnrecognizedLine, 1, "")
}

func TestCore13MessagesNameTheLimaForm(t *testing.T) {
	for _, tc := range []struct {
		input string
		code  LimaDiagnosticCode
		line  int
		hint  string
	}{
		{"k: 'It''s'", InvalidQuote, 1, `(YAML doubles the quote; Lima writes 'It\'s' or "It's")`},
		{"k: >\n  a\n  b", UnsupportedYAML, 1, `(Lima writes "|", and "^^" to join lines)`},
		{"<<: *base", UnrecognizedLine, 1, "(a YAML merge key; Lima has no merge keys)"},
		{"m:\n  <<: *base", UnrecognizedLine, 2, "(a YAML merge key; Lima has no merge keys)"},
		{"%YAML 1.2", UnrecognizedLine, 1, "(a YAML directive; Lima has no directives)"},
		{"---", UnrecognizedLine, 1, `(a YAML document marker; Lima has none, and the caller strips the front matter's own "---")`},
		{"my key:\n  a: 1", UnrecognizedLine, 1, "(quote a key that holds spaces: 'my key':)"},
		{"seo.title: Hello", UnrecognizedLine, 1, `(Lima nests by indentation: "seo:", and "title:" below it)`},
		{"k: a\n  b", InvalidIndentation, 2, `(a value spans lines only after "|")`},
		{"m:\n  k: a\n    b", InvalidIndentation, 3, `(a value spans lines only after "|")`},
		{"k: \"a\n  b\"", InvalidQuote, 1, `(a quoted value ends on its line; write "|" for a value of several lines)`},
		{"k: [a,\n  b]", InvalidFlowSyntax, 1, `(a flow sequence ends on its line; write a block sequence with "- ")`},
	} {
		expectError(t, tc.input, tc.code, tc.line, tc.hint)
	}
}
