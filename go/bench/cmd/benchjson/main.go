package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	lima "github.com/limaformat/lima/go"
	bench "github.com/limaformat/lima/go/bench"
	"go.yaml.in/yaml/v3"
)

type result struct {
	Name           string  `json:"name"`
	Implementation string  `json:"implementation"`
	Iterations     int     `json:"iterations"`
	Samples        int     `json:"samples"`
	MedianUS       float64 `json:"medianUs"`
	P95US          float64 `json:"p95Us"`
	MinUS          float64 `json:"minUs"`
	MaxUS          float64 `json:"maxUs"`
	OpsPerSec      float64 `json:"opsPerSec"`
	AllocsPerOp    float64 `json:"allocsPerOp"`
	BytesPerOp     float64 `json:"bytesPerOp"`
}
type output struct {
	Timestamp   string   `json:"timestamp"`
	OS          string   `json:"os"`
	Arch        string   `json:"arch"`
	CPU         string   `json:"cpu"`
	GoVersion   string   `json:"goVersion"`
	GitRevision string   `json:"gitRevision"`
	Results     []result `json:"results"`
}

var sink any

func measure(name, impl string, iterations, samples int, fn func()) result {
	for i := 0; i < min(iterations, 1000); i++ {
		fn()
	}
	xs := make([]float64, samples)
	for s := range samples {
		start := time.Now()
		for range iterations {
			fn()
		}
		xs[s] = float64(time.Since(start).Nanoseconds()) / 1000 / float64(iterations)
	}
	sort.Float64s(xs)
	med := xs[len(xs)/2]
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	for range 100 {
		fn()
	}
	runtime.ReadMemStats(&after)
	return result{name, impl, iterations, samples, med, xs[min(len(xs)-1, int(math.Ceil(float64(len(xs))*.95))-1)], xs[0], xs[len(xs)-1], 1e6 / med, testing.AllocsPerRun(100, fn), float64(after.TotalAlloc-before.TotalAlloc) / 100}
}
func main() {
	iterations := flag.Int("iterations", 2000, "operations per timing sample")
	samples := flag.Int("samples", 9, "independent samples")
	flag.Parse()
	out := output{Timestamp: time.Now().UTC().Format(time.RFC3339), OS: runtime.GOOS, Arch: runtime.GOARCH, CPU: cpu(), GoVersion: runtime.Version(), GitRevision: git()}
	for _, s := range bench.YAMLScenarios() {
		data := []byte(s.Document)
		lf := func() {
			v, e := lima.ParseCore(s.Document, false)
			if e != nil {
				panic(e)
			}
			sink = v
		}
		yf := func() {
			var v any
			if e := yaml.Unmarshal(data, &v); e != nil {
				panic(e)
			}
			sink = v
		}
		if len(out.Results)%2 == 0 {
			out.Results = append(out.Results, measure(s.Name, "go-lima-core", *iterations, *samples, lf), measure(s.Name, "go-yaml-v3", *iterations, *samples, yf))
		} else {
			y := measure(s.Name, "go-yaml-v3", *iterations, *samples, yf)
			l := measure(s.Name, "go-lima-core", *iterations, *samples, lf)
			out.Results = append(out.Results, l, y)
		}
	}
	for _, s := range bench.InternalScenarios() {
		s := s
		fn := func() {
			var v lima.Value
			var e error
			if s.Partials == nil {
				v, e = lima.ParseCore(s.Document, false)
			} else {
				v, e = lima.ParseReferences(s.Document, lima.ReferencesOptions{Partials: s.Partials})
			}
			if e != nil {
				panic(e)
			}
			sink = v
		}
		out.Results = append(out.Results, measure(s.Name, "go-lima", *iterations, *samples, fn))
	}
	for _, n := range []int{100, 200, 400, 800, 1600} {
		doc := "root:\n"
		for i := 0; i < n; i++ {
			doc += fmt.Sprintf("  k%d: v%d\n", i, i)
		}
		fn := func() {
			v, e := lima.ParseCore(doc, false)
			if e != nil {
				panic(e)
			}
			sink = v
		}
		out.Results = append(out.Results, measure(fmt.Sprintf("scaling keys/%d", n), "go-lima", *iterations, *samples, fn))
	}
	for _, n := range []int{50, 100, 200, 400, 800, 1600, 3200} {
		doc := "base: 42\nrefs:\n"
		for i := 0; i < n; i++ {
			doc += fmt.Sprintf("  k%d: ($base)\n", i)
		}
		if len(doc) > 65536 {
			continue
		}
		fn := func() {
			v, e := lima.ParseReferences(doc, lima.ReferencesOptions{})
			if e != nil {
				panic(e)
			}
			sink = v
		}
		out.Results = append(out.Results, measure(fmt.Sprintf("scaling references/%d", n), "go-lima", *iterations, *samples, fn))
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if e := enc.Encode(out); e != nil {
		panic(e)
	}
}
func cpu() string {
	b, _ := os.ReadFile("/proc/cpuinfo")
	for _, l := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(l, "model name") {
			if p := strings.SplitN(l, ":", 2); len(p) == 2 {
				return strings.TrimSpace(p[1])
			}
		}
	}
	return "unknown"
}
func git() string {
	b, e := exec.Command("git", "rev-parse", "HEAD").Output()
	if e != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(b))
}
