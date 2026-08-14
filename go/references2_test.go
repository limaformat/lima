package lima

import (
	"errors"
	"testing"
)

func TestParseOptionErrorsAreStructured(t *testing.T) {
	tests := map[string]ParseOptions{
		"invalid mode":          {Mode: ParseMode("bogus")},
		"partials in core mode": {Mode: ModeCore, Partials: map[string]Value{}},
	}
	for name, options := range tests {
		t.Run(name, func(t *testing.T) {
			_, err := Parse("a: 1", options)
			var le *LimaError
			if !errors.As(err, &le) || le.Code != InvalidOption {
				t.Fatalf("expected structured %s error, got %#v", InvalidOption, err)
			}
		})
	}
}

func TestReferences2StrictPositionSurvivesEarlierInterpolation(t *testing.T) {
	_, err := Parse("a: 12345\nx: value ${a} then ${missing}", ParseOptions{Strict: true})
	le, ok := err.(*LimaError)
	if !ok || le.Line != 2 || le.Column != 17 || le.Token != "${missing}" {
		t.Fatalf("unexpected diagnostic: %#v", err)
	}
}

func TestReferences2ColumnsCountUnicodeCodePoints(t *testing.T) {
	_, err := Parse("x: café ${missing}", ParseOptions{Strict: true})
	le, ok := err.(*LimaError)
	if !ok || le.Column != 6 || le.Token != "${missing}" {
		t.Fatalf("unexpected diagnostic: %#v", err)
	}
}

func TestReferences2DepthAttributionUsesDeepestParticipant(t *testing.T) {
	var deep Value = String("leaf")
	for range 16 {
		deep = Map{{Key: "k", Value: deep}}
	}
	_, err := Parse(
		"early: ${x}\nx: 1\nouter:\n  inner: $(deep)",
		ParseOptions{Partials: map[string]Value{"deep": deep}},
	)
	le, ok := err.(*LimaError)
	if !ok || le.Line != 4 || le.Token != "$(deep)" {
		t.Fatalf("unexpected diagnostic: %#v", err)
	}
}

func TestCoreWarningsReachAllMappingForms(t *testing.T) {
	for name, input := range map[string]string{
		"top":   "a: 1\na: 2",
		"block": "a:\n  b: 1\n  b: 2",
		"flow":  "a: {b: 1, b: 2}",
	} {
		t.Run(name, func(t *testing.T) {
			var warnings []Diagnostic
			_, err := ParseCoreWithOptions(input, CoreOptions{OnWarning: func(d Diagnostic) {
				warnings = append(warnings, d)
			}})
			if err != nil || len(warnings) != 1 {
				t.Fatalf("error=%v warnings=%#v", err, warnings)
			}
		})
	}
}
