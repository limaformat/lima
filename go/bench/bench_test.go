package bench

import (
	"fmt"
	"testing"

	lima "github.com/limaformat/lima/go"
	"go.yaml.in/yaml/v3"
)

var sink any

func BenchmarkLimaVsYAML(b *testing.B) {
	for _, s := range YAMLScenarios() {
		b.Run(s.Name+"/Lima_ParseCore", func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				v, e := lima.ParseCore(s.Document, false)
				if e != nil {
					b.Fatal(e)
				}
				sink = v
			}
		})
		b.Run(s.Name+"/YAML_Unmarshal", func(b *testing.B) {
			data := []byte(s.Document)
			for i := 0; i < b.N; i++ {
				var v any
				if e := yaml.Unmarshal(data, &v); e != nil {
					b.Fatal(e)
				}
				sink = v
			}
		})
	}
}

func BenchmarkLimaInternal(b *testing.B) {
	for _, s := range InternalScenarios() {
		s := s
		b.Run(s.Name, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				var v lima.Value
				var e error
				if s.Partials == nil {
					v, e = lima.ParseCore(s.Document, false)
				} else {
					v, e = lima.ParseReferences(s.Document, lima.ReferencesOptions{Partials: s.Partials})
				}
				if e != nil {
					b.Fatal(e)
				}
				sink = v
			}
		})
	}
	for _, n := range []int{100, 200, 400, 800, 1600} {
		doc := "root:\n"
		for i := 0; i < n; i++ {
			doc += fmt.Sprintf("  k%d: v%d\n", i, i)
		}
		b.Run(fmt.Sprintf("scaling keys/%d", n), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				v, e := lima.ParseCore(doc, false)
				if e != nil {
					b.Fatal(e)
				}
				sink = v
			}
		})
	}
	for _, n := range []int{50, 100, 200, 400, 800, 1600, 3200} {
		doc := "base: 42\nrefs:\n"
		for i := 0; i < n; i++ {
			doc += fmt.Sprintf("  k%d: ($base)\n", i)
		}
		if len(doc) > 65536 {
			continue
		}
		b.Run(fmt.Sprintf("scaling references/%d", n), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				v, e := lima.ParseReferences(doc, lima.ReferencesOptions{})
				if e != nil {
					b.Fatal(e)
				}
				sink = v
			}
		})
	}
}

func BenchmarkErrorPaths(b *testing.B) {
	b.Run("Core strict invalid number", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_, e := lima.ParseCore("value: 1e400\n", true)
			sink = e
		}
	})
	b.Run("References strict unresolved", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_, e := lima.ParseReferences("value: ($missing)\n", lima.ReferencesOptions{Strict: true})
			sink = e
		}
	})
}
