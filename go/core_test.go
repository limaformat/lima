package lima

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestMultipleLeadingTabsAreExpanded(t *testing.T) {
	got, err := ParseCore("parent:\n\t\tchild: value\n", false)
	if err != nil {
		t.Fatal(err)
	}
	want := Map{{Key: "parent", Value: Map{{Key: "child", Value: String("value")}}}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestUnicodeWhitespaceIsNotStructuralIndentation(t *testing.T) {
	// The leading Unicode space is not ASCII structural indentation, so the
	// line is not a nested child of `parent`. It is also not a valid §5.1
	// unquoted key (§5.1's grammar is ASCII), so it is an unrecognised
	// top-level line, skipped in both modes — matching the TypeScript
	// reference. `parent` is left a bare key with no child.
	for _, tc := range []struct{ name, space string }{{"NBSP", "\u00a0"}, {"BOM", "\ufeff"}, {"line separator", "\u2028"}, {"paragraph separator", "\u2029"}} {
		t.Run(tc.name, func(t *testing.T) {
			input := "parent:\n" + tc.space + "child: value\n"
			got, err := ParseCore(input, false)
			if err != nil {
				t.Fatal(err)
			}
			want := Map{{Key: "parent", Value: Null{}}}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("got %#v, want %#v", got, want)
			}
		})
	}
}

func TestUnicodeWhitespaceDoesNotBecomeIndentationAtDepth(t *testing.T) {
	// `\u00a0\u00a0b` is neither an ASCII-indented child nor a valid §5.1
	// key, so the line is dropped and `parent.a` stays a bare key. (This
	// port deliberately does not treat Unicode whitespace as indentation —
	// see structural-indentation-unicode-whitespace.md — so unlike the
	// TypeScript reference it does not reparent `b` under `parent`; both
	// agree the odd key itself is not produced.)
	got, err := ParseCore("parent:\n  a:\n\u00a0\u00a0b: value\n", false)
	if err != nil {
		t.Fatal(err)
	}
	want := Map{{Key: "parent", Value: Map{{Key: "a", Value: Null{}}}}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestUnicodeWhitespaceAfterASCIIIndentIsNotAcceptedAsNestedKey(t *testing.T) {
	for _, tc := range []struct{ name, space string }{{"NBSP", "\u00a0"}, {"BOM", "\ufeff"}} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseCore("parent:\n  "+tc.space+"child: value\n", false)
			if err != nil {
				t.Fatal(err)
			}
			want := Map{{Key: "parent", Value: Null{}}}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("got %#v, want %#v", got, want)
			}
		})
	}
}

func TestLeadingUnicodeWhitespaceKeyIsRejected(t *testing.T) {
	// \u00a75.1's unquoted-key grammar is ASCII; a key beginning with NBSP is
	// not a key. The line is unrecognised and skipped in both modes,
	// matching the TypeScript reference (corpus C: key-leading-nbsp-invalid).
	got, err := ParseCore("\u00a0key: value\n", false)
	if err != nil {
		t.Fatal(err)
	}
	want := Map{}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestUnicodeWhitespaceBlankLineRemainsIgnorable(t *testing.T) {
	got, err := ParseCore("parent:\n\u00a0\n  child: value\n", false)
	if err != nil {
		t.Fatal(err)
	}
	want := Map{{Key: "parent", Value: Map{{Key: "child", Value: String("value")}}}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

// Core \u00a74 rule 7 / \u00a76.1.3: a comment line does not affect base indentation
// and is skipped, including in the lookahead that decides whether a bare
// key has any nested block at all \u2014 regardless of the comment's own
// leading whitespace kind (docs/decisions/comment-lines-and-bare-key-block-detection.md,
// decided 2026-09-04, option C). This corrects the prior behaviour this
// test asserted, where a Unicode-whitespace-prefixed comment's own ASCII
// indent (0) wrongly ended the lookahead before it ever reached the real
// nested content on the next line.
func TestUnicodeWhitespaceCommentDoesNotEstablishBaseline(t *testing.T) {
	got, err := ParseCore("parent:\n\u00a0# comment\n  child: value\n", false)
	if err != nil {
		t.Fatal(err)
	}
	want := Map{{Key: "parent", Value: Map{{Key: "child", Value: String("value")}}}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestCore12UnicodeKeysAndMessageHints(t *testing.T) {
	got, err := ParseCore("größe: one\n𠀀: two\nautor*in: three\n", false)
	if err != nil {
		t.Fatal(err)
	}
	want := Map{{Key: "größe", Value: String("one")}, {Key: "𠀀", Value: String("two")}, {Key: "autor*in", Value: String("three")}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
	for input, hint := range map[string]string{
		"\u00a0key: value\n": "U+00A0 before the key; Lima indents by spaces only",
		"title： value\n":     `the key-value separator is ": " (U+003A and a space), not U+FF1A FULLWIDTH COLON`,
	} {
		_, err := ParseCore(input, true)
		if err == nil || !strings.Contains(err.Error(), hint) {
			t.Fatalf("%q: got %v, want hint %q", input, err, hint)
		}
	}
}

func TestInvalidUTF8DocumentIsRejectedFirstWithLine(t *testing.T) {
	input := "valid: one\nbad: \xff\n"
	want := "Lima: document contains an invalid Unicode scalar value at line 2"
	for _, strict := range []bool{false, true} {
		_, err := ParseCore(input, strict)
		var le *LimaError
		if !errors.As(err, &le) || le.Code != InvalidDocument || le.Line != 2 || le.Message != want {
			t.Fatalf("strict=%v: got %#v", strict, err)
		}
	}
	_, err := Parse(input, ParseOptions{Mode: ParseMode("invalid"), Partials: map[string]Value{"bad": String("partial")}})
	var le *LimaError
	if !errors.As(err, &le) || le.Code != InvalidDocument {
		t.Fatalf("invalid document must precede option and partial work: %#v", err)
	}
}
