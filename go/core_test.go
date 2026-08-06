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

func TestUnicodeWhitespaceCommentEstablishesASCIIBaseline(t *testing.T) {
	got, err := ParseCore("parent:\n\u00a0# comment\n  child: value\n", false)
	if err != nil {
		t.Fatal(err)
	}
	want := Map{{Key: "parent", Value: Null{}}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}
