package lima

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// references1Options configures the frozen References 1.0 test implementation.
type references1Options struct {
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
				c.inserted = &insertedAt{line: v.line, token: text}
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
			return pstr(r, v.line, false, false, nil), nil
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

// parseReferencesV1 is retained only for the frozen References 1.0 corpus.
func parseReferencesV1(input string, opts references1Options) (Value, error) {
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
	root, e := parseCorePositioned(input, opts.Strict, nil, false)
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
