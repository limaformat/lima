package lima

import "fmt"

// Value is one value in Lima's closed value model. Its concrete forms are
// Null, Bool, Int64, Float64, String, Instant, Array, and Map.
type Value interface{ limaValue() }

// Null is Lima's null value.
type Null struct{}

// Bool is a Lima boolean.
type Bool bool

// Int64 is a Lima integer. Lima integers are restricted to JavaScript's safe range.
type Int64 int64

// Float64 is a finite Lima floating-point number, distinct from Int64.
type Float64 float64

// String is Lima text.
type String string

// Instant is a UTC instant represented as Unix epoch seconds. It deliberately
// does not use time.Time so the complete normative year 0001–9999 range has
// one explicit, dependency-free representation.
type Instant struct{ EpochSeconds int64 }

// Array is an ordered Lima sequence.
type Array []Value

// Entry is one insertion-ordered mapping entry.
type Entry struct {
	Key   string
	Value Value
}

// Map is an insertion-ordered Lima mapping. Duplicate assignment replaces the
// existing entry without moving it.
type Map []Entry

func (Null) limaValue()    {}
func (Bool) limaValue()    {}
func (Int64) limaValue()   {}
func (Float64) limaValue() {}
func (String) limaValue()  {}
func (Instant) limaValue() {}
func (Array) limaValue()   {}
func (Map) limaValue()     {}

// ISOString renders i in the canonical corpus form YYYY-MM-DDTHH:MM:SSZ.
func (i Instant) ISOString() string {
	days, secs := divModFloor(i.EpochSeconds, 86400)
	y, m, d := civilFromDays(days)
	return fmt.Sprintf("%04d-%02d-%02dT%02d:%02d:%02dZ", y, m, d, secs/3600, (secs%3600)/60, secs%60)
}

func divModFloor(a, b int64) (int64, int64) {
	q, r := a/b, a%b
	if r < 0 {
		q--
		r += b
	}
	return q, r
}

func daysFromCivil(y int64, m, d int) int64 {
	if m <= 2 {
		y--
	}
	era := y / 400
	if y < 0 && y%400 != 0 {
		era--
	}
	yoe := y - era*400
	mp := int64((m + 9) % 12)
	doy := (153*mp+2)/5 + int64(d) - 1
	doe := yoe*365 + yoe/4 - yoe/100 + doy
	return era*146097 + doe - 719468
}

func civilFromDays(z int64) (int64, int, int) {
	z += 719468
	era := z / 146097
	if z < 0 && z%146097 != 0 {
		era--
	}
	doe := z - era*146097
	yoe := (doe - doe/1460 + doe/36524 - doe/146096) / 365
	y := yoe + era*400
	doy := doe - (365*yoe + yoe/4 - yoe/100)
	mp := (5*doy + 2) / 153
	d := int(doy - (153*mp+2)/5 + 1)
	m := int(mp + 3)
	if mp >= 10 {
		m = int(mp - 9)
	}
	if m <= 2 {
		y++
	}
	return y, m, d
}

func valueDepth(v Value) int {
	switch x := v.(type) {
	case Array:
		max := 0
		for _, item := range x {
			if d := valueDepth(item); d > max {
				max = d
			}
		}
		return 1 + max
	case Map:
		max := 0
		for _, e := range x {
			if d := valueDepth(e.Value); d > max {
				max = d
			}
		}
		return 1 + max
	default:
		return 0
	}
}

func mapIndex(m Map, key string) int {
	for i := range m {
		if m[i].Key == key {
			return i
		}
	}
	return -1
}
func mapSet(m *Map, key string, value Value) {
	if i := mapIndex(*m, key); i >= 0 {
		(*m)[i].Value = value
	} else {
		*m = append(*m, Entry{key, value})
	}
}

type insertedAt struct {
	line  int
	token string
}
type pvalue struct {
	value    Value
	line     int
	quoted   bool
	inserted *insertedAt
	array    []*pvalue
	mapping  []pentry
}
type pentry struct {
	key   string
	value *pvalue
}

func (p *pvalue) plain() Value {
	if p.array != nil {
		a := make(Array, len(p.array))
		for i, v := range p.array {
			a[i] = v.plain()
		}
		return a
	}
	if p.mapping != nil {
		m := make(Map, len(p.mapping))
		for i, e := range p.mapping {
			m[i] = Entry{e.key, e.value.plain()}
		}
		return m
	}
	if p.value == nil {
		return Null{}
	}
	return p.value
}
