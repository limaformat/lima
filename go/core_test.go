package lima

import (
	"reflect"
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
	for _, tc := range []struct{ name, space string }{{"NBSP", "\u00a0"}, {"BOM", "\ufeff"}, {"line separator", "\u2028"}, {"paragraph separator", "\u2029"}} {
		t.Run(tc.name, func(t *testing.T) {
			input := "parent:\n" + tc.space + "child: value\n"
			got, err := ParseCore(input, false)
			if err != nil {
				t.Fatal(err)
			}
			want := Map{{Key: "parent", Value: Null{}}, {Key: tc.space + "child", Value: String("value")}}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("got %#v, want %#v", got, want)
			}
		})
	}
}

func TestUnicodeWhitespaceDoesNotBecomeIndentationAtDepth(t *testing.T) {
	got, err := ParseCore("parent:\n  a:\n\u00a0\u00a0b: value\n", false)
	if err != nil {
		t.Fatal(err)
	}
	want := Map{{Key: "parent", Value: Map{{Key: "a", Value: Null{}}}}, {Key: "\u00a0\u00a0b", Value: String("value")}}
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

func TestLeadingUnicodeWhitespaceKeyIsPreserved(t *testing.T) {
	got, err := ParseCore("\u00a0key: value\n", false)
	if err != nil {
		t.Fatal(err)
	}
	want := Map{{Key: "\u00a0key", Value: String("value")}}
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
