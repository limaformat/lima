package lima

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

const partialCountLimit = 128
const partialNodeLimit = 4096
const resultNodeLimit = 65536

func validatePartial(v Value, name, path string, depth int) (int, error) {
	bad := func(reason string) (int, error) {
		return 0, &LimaError{Code: InvalidPartial, Partial: name, Path: path, Message: fmt.Sprintf("Lima: invalid partial %q at path %q: %s", name, path, reason)}
	}
	switch x := v.(type) {
	case Float64:
		if math.IsNaN(float64(x)) || math.IsInf(float64(x), 0) {
			return bad("non-finite number")
		}
	case String:
		if utf8.RuneCountInString(string(x)) > scalarLengthLimit {
			return bad("string exceeds maximum length")
		}
	case Instant:
		y, _, _ := civilFromDays(floorDiv(x.EpochSeconds, 86400))
		if y < 1 || y > 9999 {
			return bad("date outside supported range")
		}
	case Array:
		if depth >= 16 {
			return bad("nesting depth exceeds maximum")
		}
		nodes := 1
		for i, z := range x {
			if _, ok := z.(Array); ok {
				return 0, &LimaError{Code: InvalidPartial, Partial: name, Path: fmt.Sprintf("%s[%d]", path, i), Message: "Lima: nested arrays are not supported"}
			}
			n, e := validatePartial(z, name, fmt.Sprintf("%s[%d]", path, i), depth+1)
			if e != nil {
				return 0, e
			}
			nodes += n
		}
		return nodes, nil
	case Map:
		if depth >= 16 {
			return bad("nesting depth exceeds maximum")
		}
		nodes := 1
		for _, z := range x {
			p := path + "." + z.Key
			if utf8.RuneCountInString(z.Key) > 128 {
				return 0, &LimaError{Code: InvalidPartial, Partial: name, Path: p, Message: "Lima: partial mapping key exceeds maximum length"}
			}
			n, e := validatePartial(z.Value, name, p, depth+1)
			if e != nil {
				return 0, e
			}
			nodes += n
		}
		return nodes, nil
	}
	return 1, nil
}

// ReferencesOptions configures ParseReferences.
type ReferencesOptions struct {
	// Partials contains named, deeply copied values available as (%name).
	Partials map[string]Value
	// Strict enables strict reference and Core diagnostics.
	Strict bool
}

func refToken(s string, i int) (end int, partial bool, key string, ok bool) {
	if i+3 > len(s) || s[i] != '(' || (s[i+1] != '$' && s[i+1] != '%') {
		return
	}
	partial = s[i+1] == '%'
	j := i + 2
	for j < len(s) && s[j] != ')' {
		c := s[j]
		allowed := "_:-."
		if partial {
			allowed = "_:/-"
		}
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune(allowed, rune(c))) {
			return
		}
		j++
	}
	if j == i+2 || j >= len(s) {
		return
	}
	return j + 1, partial, s[i+2 : j], true
}
func pureRef(s string) (bool, string, bool) {
	e, p, k, o := refToken(s, 0)
	return p, k, o && e == len(s)
}
func lookupP(m []pentry, path string) *pvalue {
	parts := strings.Split(path, ".")
	var v *pvalue
	for _, e := range m {
		if e.key == parts[0] {
			v = e.value
			break
		}
	}
	for _, k := range parts[1:] {
		if v == nil {
			return nil
		}
		var n *pvalue
		for _, e := range v.mapping {
			if e.key == k {
				n = e.value
				break
			}
		}
		v = n
	}
	return v
}
func freeP(v *pvalue) bool {
	if v == nil {
		return false
	}
	if s, ok := v.value.(String); ok {
		return v.quoted || (!strings.Contains(string(s), "($") && !strings.Contains(string(s), "(%"))
	}
	for _, x := range v.array {
		if !freeP(x) {
			return false
		}
	}
	for _, e := range v.mapping {
		if !freeP(e.value) {
			return false
		}
	}
	return true
}
func fromValue(v Value, line int) *pvalue {
	switch x := v.(type) {
	case Array:
		a := make([]*pvalue, len(x))
		for i, z := range x {
			a[i] = fromValue(z, line)
		}
		return &pvalue{line: line, array: a}
	case Map:
		m := make([]pentry, len(x))
		for i, z := range x {
			m[i] = pentry{z.Key, fromValue(z.Value, line)}
		}
		return &pvalue{line: line, mapping: m}
	case String:
		return pstr(string(x), line, true)
	default:
		return pv(v, line)
	}
}
func canonical(v Value) string {
	switch x := v.(type) {
	case Null:
		return ""
	case Bool:
		if x {
			return "true"
		}
		return "false"
	case Int64:
		return strconv.FormatInt(int64(x), 10)
	case Float64:
		n := float64(x)
		a := math.Abs(n)
		f := 'f'
		if a != 0 && (a < 1e-6 || a >= 1e21) {
			f = 'e'
		}
		s := strconv.FormatFloat(n, byte(f), -1, 64)
		if f == 'e' {
			a := strings.Split(s, "e")
			exp := a[1]
			sign := ""
			if strings.HasPrefix(exp, "-") {
				sign = "-"
				exp = exp[1:]
			} else {
				exp = strings.TrimPrefix(exp, "+")
			}
			exp = strings.TrimLeft(exp, "0")
			if exp == "" {
				exp = "0"
			}
			s = a[0] + "e" + sign + exp
		}
		return s
	case String:
		return string(x)
	case Instant:
		return x.ISOString()
	}
	return ""
}
func resolve(v *pvalue, lookup, partials []pentry, strict bool) (*pvalue, error) {
	if s, ok := v.value.(String); ok && !v.quoted {
		text := string(s)
		if p, k, o := pureRef(text); o {
			target := lookupP(lookup, k)
			if p {
				target = lookupP(partials, k)
			}
			if target != nil && freeP(target) {
				c := fromValue(target.plain(), v.line)
				c.inserted = &insertedAt{v.line, text}
				return c, nil
			}
		}
		var b strings.Builder
		changed := false
		for i := 0; i < len(text); {
			e, p, k, o := refToken(text, i)
			if !o {
				b.WriteByte(text[i])
				i++
				continue
			}
			target := lookupP(lookup, k)
			if p {
				target = lookupP(partials, k)
			}
			if target == nil || !freeP(target) {
				b.WriteString(text[i:e])
				i = e
				continue
			}
			switch z := target.plain().(type) {
			case Map:
				return nil, &LimaError{Code: InvalidInterpolation, Line: v.line, Token: text[i:e], Message: fmt.Sprintf("Lima: invalid interpolation of %q at line %d: mapping cannot be interpolated into a string", text[i:e], v.line)}
			case Array:
				parts := make([]string, len(z))
				for j, item := range z {
					switch item.(type) {
					case Array, Map:
						return nil, &LimaError{Code: InvalidInterpolation, Line: v.line, Token: text[i:e], Message: "Lima: invalid interpolation of nested collection"}
					}
					parts[j] = canonical(item)
				}
				b.WriteString(strings.Join(parts, ", "))
				changed = true
				i = e
				continue
			}
			b.WriteString(canonical(target.plain()))
			changed = true
			i = e
		}
		if changed {
			r := b.String()
			if utf8.RuneCountInString(r) > scalarLengthLimit {
				return nil, limaError(ResourceLimit, v.line, fmt.Sprintf("Lima: scalar exceeds maximum length of %d code points at line %d", scalarLengthLimit, v.line))
			}
			return pstr(r, v.line, false), nil
		}
		if strict && (strings.Contains(text, "($") || strings.Contains(text, "(%")) {
			return nil, &LimaError{Code: UnresolvedReference, Line: v.line, Token: text, Message: fmt.Sprintf("Lima: unresolved reference %q at line %d", text, v.line)}
		}
		return v, nil
	}
	if v.array != nil {
		a := make([]*pvalue, len(v.array))
		for i, x := range v.array {
			r, e := resolve(x, lookup, partials, strict)
			if e != nil {
				return nil, e
			}
			if r.array != nil {
				return nil, &LimaError{Code: InvalidReferenceShape, Line: x.line, Message: "Lima: array reference cannot be inserted as a sequence item"}
			}
			a[i] = r
		}
		return &pvalue{line: v.line, array: a, inserted: v.inserted}, nil
	}
	if v.mapping != nil {
		m := make([]pentry, len(v.mapping))
		for i, x := range v.mapping {
			r, e := resolve(x.value, lookup, partials, strict)
			if e != nil {
				return nil, e
			}
			m[i] = pentry{x.key, r}
		}
		return &pvalue{line: v.line, mapping: m, inserted: v.inserted}, nil
	}
	return v, nil
}

// ParseReferences parses Lima Core 1.0 and resolves Lima References 1.0.
func ParseReferences(input string, opts ReferencesOptions) (Value, error) {
	if len(opts.Partials) > partialCountLimit {
		return nil, &LimaError{Code: InvalidPartial, Message: "Lima: too many partials (max 128)"}
	}
	partials := []pentry{}
	totalPartialNodes := 0
	for k, v := range opts.Partials {
		if utf8.RuneCountInString(k) > 128 {
			return nil, &LimaError{Code: InvalidPartial, Partial: k, Path: k, Message: "Lima: invalid partial name"}
		}
		n, e := validatePartial(v, k, k, 0)
		if e != nil {
			return nil, e
		}
		totalPartialNodes += n
		if totalPartialNodes > partialNodeLimit {
			return nil, &LimaError{Code: InvalidPartial, Message: fmt.Sprintf("Lima: partials exceed the combined maximum of %d value nodes", partialNodeLimit)}
		}
		partials = append(partials, pentry{k, fromValue(v, 0)})
	}
	root, e := parseCorePositioned(input, opts.Strict)
	if e != nil {
		return nil, e
	}
	if opts.Strict {
		var best *LimaError
		for _, x := range root {
			if s, ok := x.value.value.(String); ok && !x.value.quoted {
				txt := string(s)
				for i := 0; i < len(txt); i++ {
					tokenEnd, p, k, o := refToken(txt, i)
					if o {
						target := lookupP(root, k)
						if p {
							target = lookupP(partials, k)
						}
						if target == nil && (best == nil || x.value.line < best.Line) {
							best = &LimaError{Code: UnresolvedReference, Line: x.value.line, Token: txt[i:tokenEnd], Message: fmt.Sprintf("Lima: unresolved reference %q at line %d", txt[i:tokenEnd], x.value.line)}
						}
						if target != nil {
							if _, isMap := target.plain().(Map); isMap {
								_, _, pure := pureRef(txt)
								if !pure && (best == nil || x.value.line < best.Line) {
									best = &LimaError{Code: InvalidInterpolation, Line: x.value.line, Token: txt[i:tokenEnd], Message: "Lima: mapping cannot be interpolated"}
								}
							}
						}
						break
					}
				}
			}
		}
		if best != nil {
			return nil, best
		}
	}
	live := []pentry{}
	for _, x := range root {
		r, e := resolve(x.value, live, partials, false)
		if e != nil {
			return nil, e
		}
		setP(&live, x.key, r)
	}
	snapshot := append([]pentry(nil), live...)
	// A key whose original value is itself a pure reference remains that
	// original token in the immutable phase-2 lookup, enforcing one hop.
	for i, x := range root {
		if s, ok := x.value.value.(String); ok && !x.value.quoted {
			if _, _, ok := pureRef(string(s)); ok {
				snapshot[i] = x
			}
		}
	}
	final := []pentry{}
	for _, x := range live {
		r, e := resolve(x.value, snapshot, partials, opts.Strict)
		if e != nil {
			return nil, e
		}
		setP(&final, x.key, r)
	}
	out := make(Map, len(final))
	nodes := 1
	maxDepth := 0
	for i, x := range final {
		out[i] = Entry{x.key, x.value.plain()}
		nodes += countNodes(out[i].Value)
		if d := valueDepth(out[i].Value); d > maxDepth {
			maxDepth = d
		}
	}
	if maxDepth > nestingDepthLimit {
		line, token := earliestInsertion(final)
		e := limaError(ResourceLimit, line, fmt.Sprintf("Lima: nesting depth exceeds maximum of %d at line %d", nestingDepthLimit, line))
		e.Token = token
		return nil, e
	}
	if nodes > resultNodeLimit {
		line, token := earliestInsertion(final)
		e := limaError(ResourceLimit, line, fmt.Sprintf("Lima: result exceeds maximum size of %d total nodes at line %d", resultNodeLimit, line))
		e.Token = token
		return nil, e
	}
	return out, nil
}
func earliestInsertion(m []pentry) (int, string) {
	line := 0
	token := ""
	var walk func(*pvalue)
	walk = func(v *pvalue) {
		if v.inserted != nil && (line == 0 || v.inserted.line < line) {
			line = v.inserted.line
			token = v.inserted.token
		}
		for _, x := range v.array {
			walk(x)
		}
		for _, e := range v.mapping {
			walk(e.value)
		}
	}
	for _, e := range m {
		walk(e.value)
	}
	if line == 0 {
		line = 1
	}
	return line, token
}
func countNodes(v Value) int {
	switch x := v.(type) {
	case Array:
		n := 1
		for _, z := range x {
			n += countNodes(z)
		}
		return n
	case Map:
		n := 1
		for _, z := range x {
			n += countNodes(z.Value)
		}
		return n
	}
	return 1
}
