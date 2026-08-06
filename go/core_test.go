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
