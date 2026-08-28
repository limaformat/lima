// Package lima implements Lima Core 1.0 and Lima References 2.0 with only
// the Go standard library.
package lima

import (
	"fmt"
	"strings"
)

type sourceLine struct {
	text           string
	number, indent int
}

func sourceLines(input string) []sourceLine {
	input = strings.ReplaceAll(strings.ReplaceAll(input, "\r\n", "\n"), "\r", "\n")
	input = expandLeadingTabs(input)
	raw := strings.Split(input, "\n")
	out := make([]sourceLine, len(raw))
	for i, s := range raw {
		// Structural indentation is ASCII-space-only after tabs have already
		// been expanded above. Non-ASCII trim whitespace remains part of the
		// key text here, matching Rust's top-level block-boundary scan.
		n := 0
		for n < len(s) && s[n] == ' ' {
			n++
		}
		out[i] = sourceLine{strings.TrimRight(s, " "), i + 1, n}
	}
	return out
}

func expandLeadingTabs(input string) string {
	if !strings.ContainsRune(input, '\t') {
		return input
	}
	var out strings.Builder
	out.Grow(len(input))
	atLineStart := true
	for _, r := range input {
		if atLineStart && r == '\t' {
			out.WriteString("  ")
			continue
		}
		out.WriteRune(r)
		if r == '\n' {
			atLineStart = true
		} else if r != ' ' {
			atLineStart = false
		}
	}
	return out.String()
}
func lineContent(l sourceLine) string {
	// sourceLine.indent is the ASCII-space structural boundary computed by
	// sourceLines after leading tabs have been expanded. Unicode trim
	// whitespace after that boundary remains part of the physical content.
	return l.text[l.indent:]
}
func lineStructuralIndent(l sourceLine) int {
	// A zero ASCII indent remains a top-level boundary; Rust's top-level
	// range scan removes such a line from the preceding block before its
	// BlockCursor observes any following Unicode whitespace.
	if l.indent == 0 {
		return 0
	}
	c := lineContent(l)
	return l.indent + len(c) - len(trimLeftWhitespace(c))
}
func setP(m *[]pentry, key string, v *pvalue) {
	for i := range *m {
		if (*m)[i].key == key {
			(*m)[i].value = v
			return
		}
	}
	*m = append(*m, pentry{key, v})
}

func spaceBeforeColon(s string) bool {
	if len(s) < 3 || (s[0] != '"' && s[0] != '\'') {
		return false
	}
	q := s[0]
	esc := false
	for i := 1; i < len(s); i++ {
		if esc {
			esc = false
			continue
		}
		if q == '"' && s[i] == '\\' {
			esc = true
			continue
		}
		if s[i] == q {
			j := i + 1
			for j < len(s) && (s[j] == ' ' || s[j] == '\t') {
				j++
			}
			return j > i+1 && j < len(s) && s[j] == ':'
		}
	}
	return false
}

// bareNestedValue looks ahead (skipping blank/comment lines, per Core §4
// rule 7 / §6.1.3) for a nested block belonging to a bare key (one with no
// inline value) inside a block-sequence item's mapping. keyColumn is the
// column of the bare key itself; §7.1 rule 3 / §7.2 require a nested block
// to be indented deeper than that — a line at the key's own column is the
// next sibling key, not the key's value. *idx must already point at the
// first line after the bare key's own line. Returns null when no deeper
// block follows.
func bareNestedValue(keyColumn, keyLine int, lines []sourceLine, idx *int, strict bool, onWarning func(Diagnostic), captureReferences bool) (*pvalue, error) {
	j := *idx
	for j < len(lines) && (trimWhitespace(lines[j].text) == "" || strings.HasPrefix(trimWhitespace(lines[j].text), "#")) {
		j++
	}
	if j >= len(lines) || lineStructuralIndent(lines[j]) <= keyColumn {
		return pv(Null{}, keyLine), nil
	}
	v, e := parseBlock(lines, idx, lineStructuralIndent(lines[j]), strict, onWarning, captureReferences)
	if e != nil {
		return nil, e
	}
	if v == nil {
		return pv(Null{}, keyLine), nil
	}
	return v, nil
}

// parseArrayItemContinuationKeys consumes the key/value lines following a
// block-sequence item's first key, at any indentation deeper than the
// item's own base (indent) — mirroring the top-level/nested-mapping key
// grammar, including a bare key (§4 rule 7 / §6.1.3 comment-skip, nested
// block) alongside an ordinary key: value pair. Stops at the first line
// that is not a valid continuation key, leaving *idx there.
func parseArrayItemContinuationKeys(item *[]pentry, lines []sourceLine, idx *int, indent int, strict bool, onWarning func(Diagnostic), captureReferences bool) error {
	for *idx < len(lines) && lineStructuralIndent(lines[*idx]) > indent {
		cl := lines[*idx]
		cc := lineContent(cl)
		s := findSep(cc)
		bare := false
		keyEnd := s
		if s < 0 {
			if !strings.HasSuffix(cc, ":") || len(cc) < 2 {
				break
			}
			keyEnd = len(cc) - 1
			bare = true
		}
		ckRaw := trimWhitespace(cc[:keyEnd])
		if !isValidKey(ckRaw) {
			break
		}
		ck, e := stripKeyQuotes(ckRaw, strict, cl.number)
		if e != nil {
			return e
		}
		*idx++
		var cv *pvalue
		if bare {
			cv, e = bareNestedValue(lineStructuralIndent(cl), cl.number, lines, idx, strict, onWarning, captureReferences)
		} else {
			cv, e = parseFlowOrScalar(stripComment(trimWhitespace(cc[s+2:])), strict, cl.number, onWarning, captureReferences)
		}
		if e != nil {
			return e
		}
		setP(item, ck, cv)
	}
	return nil
}

func parseBlock(lines []sourceLine, idx *int, indent int, strict bool, onWarning func(Diagnostic), captureReferences bool) (*pvalue, error) {
	for *idx < len(lines) && (trimWhitespace(lines[*idx].text) == "" || strings.HasPrefix(trimWhitespace(lines[*idx].text), "#")) {
		*idx++
	}
	if *idx >= len(lines) || lineStructuralIndent(lines[*idx]) < indent {
		return nil, nil
	}
	start := lines[*idx].number
	isArray := strings.HasPrefix(lineContent(lines[*idx]), "-")
	var arr []*pvalue
	var m []pentry
	for *idx < len(lines) {
		l := lines[*idx]
		c := lineContent(l)
		if trimWhitespace(c) == "" || strings.HasPrefix(trimWhitespace(c), "#") {
			*idx++
			continue
		}
		lineIndent := lineStructuralIndent(l)
		if lineIndent < indent {
			break
		}
		if lineIndent > indent {
			if strict {
				return nil, limaError(InvalidIndentation, l.number, fmt.Sprintf("Lima: unexpected indentation at line %d: %q", l.number, c))
			}
			*idx++
			continue
		}
		if isArray {
			if !strings.HasPrefix(c, "-") {
				if strict {
					return nil, limaError(InvalidIndentation, l.number, fmt.Sprintf("Lima: mixed map and array entries for the same key at line %d", l.number))
				}
				*idx++
				continue
			}
			rest := trimWhitespace(strings.TrimPrefix(c, "-"))
			rest = stripComment(rest)
			if strings.HasPrefix(rest, "-") {
				if strict {
					return nil, limaError(InvalidIndentation, l.number, fmt.Sprintf("Lima: nested block sequence at line %d: %q", l.number, c))
				}
				arr = append(arr, pv(Null{}, l.number))
				*idx++
				for *idx < len(lines) && lineStructuralIndent(lines[*idx]) > indent {
					*idx++
				}
				continue
			}
			if rest == "" {
				arr = append(arr, pv(Null{}, l.number))
				*idx++
				continue
			}
			if sep := findSep(rest); sep >= 0 && isValidKey(trimWhitespace(rest[:sep])) {
				key, e0 := stripKeyQuotes(trimWhitespace(rest[:sep]), strict, l.number)
				if e0 != nil {
					return nil, e0
				}
				rawVal := trimWhitespace(rest[sep+2:])
				*idx++
				var v *pvalue
				var e error
				// The key sits after `- `, two columns past the dash.
				if bv, ok, be := blockScalarValue(rawVal, indent+2, l.number, lines, idx, captureReferences); ok {
					v, e = bv, be
				} else {
					v, e = parseFlowOrScalar(rawVal, strict, l.number, onWarning, captureReferences)
				}
				if e != nil {
					return nil, e
				}
				item := []pentry{{key, v}}
				if e := parseArrayItemContinuationKeys(&item, lines, idx, indent, strict, onWarning, captureReferences); e != nil {
					return nil, e
				}
				arr = append(arr, &pvalue{line: l.number, mapping: item})
				continue
			}
			if keyPart, ok := strings.CutSuffix(rest, ":"); ok && keyPart != "" && isValidKey(trimWhitespace(keyPart)) {
				key, e0 := stripKeyQuotes(trimWhitespace(keyPart), strict, l.number)
				if e0 != nil {
					return nil, e0
				}
				// §7.2: the item's sibling keys align at the first key's
				// column, after `- `; a nested block must be deeper than that.
				afterDash := c[1:]
				keyColumn := lineStructuralIndent(l) + 1 + (len(afterDash) - len(trimLeftWhitespace(afterDash)))
				*idx++
				v, e := bareNestedValue(keyColumn, l.number, lines, idx, strict, onWarning, captureReferences)
				if e != nil {
					return nil, e
				}
				item := []pentry{{key, v}}
				if e := parseArrayItemContinuationKeys(&item, lines, idx, indent, strict, onWarning, captureReferences); e != nil {
					return nil, e
				}
				arr = append(arr, &pvalue{line: l.number, mapping: item})
				continue
			}
			v, e := parseFlowOrScalar(rest, strict, l.number, onWarning, captureReferences)
			if e != nil {
				return nil, e
			}
			arr = append(arr, v)
			*idx++
		} else {
			if strings.HasPrefix(c, "-") {
				if strict {
					return nil, limaError(InvalidIndentation, l.number, fmt.Sprintf("Lima: mixed array and map entries for the same key at line %d", l.number))
				}
				*idx++
				continue
			}
			sep := findSep(c)
			bare := false
			if sep < 0 && strings.HasSuffix(c, ":") {
				sep = len(c) - 1
				bare = true
			}
			if sep < 0 {
				if strict {
					return nil, limaError(InvalidIndentation, l.number, fmt.Sprintf("Lima: indented freetext without a block scalar marker at line %d: %q", l.number, c))
				}
				*idx++
				continue
			}
			if !isValidKey(trimWhitespace(c[:sep])) {
				// §5.1: not a usable key — unrecognised line, skipped in both
				// modes (§10's strict list is closed and does not cover this).
				*idx++
				continue
			}
			key, e0 := stripKeyQuotes(trimWhitespace(c[:sep]), strict, l.number)
			if e0 != nil {
				return nil, e0
			}
			if e := checkKeyLength(key, l.number); e != nil {
				return nil, e
			}
			exists := false
			for _, e := range m {
				exists = exists || e.key == key
			}
			if e := checkDuplicate(exists, key, l.number, strict, onWarning); e != nil {
				return nil, e
			}
			*idx++
			var v *pvalue
			var e error
			if bare {
				// Core §4 rule 7 / §6.1.3: comment lines (and blank lines)
				// do not affect base indentation and are skipped when
				// deciding whether this bare key has any nested block at
				// all. parseBlock re-skips the same lines from *idx once
				// it is called, so this lookahead only peeks, never mutates.
				j := *idx
				for j < len(lines) && (trimWhitespace(lines[j].text) == "" || strings.HasPrefix(trimWhitespace(lines[j].text), "#")) {
					j++
				}
				if j < len(lines) && lineStructuralIndent(lines[j]) > indent {
					v, e = parseBlock(lines, idx, lineStructuralIndent(lines[j]), strict, onWarning, captureReferences)
				}
				if v == nil && e == nil {
					v = pv(Null{}, l.number)
				}
			} else {
				raw := trimWhitespace(c[sep+2:])
				if bv, ok, be := blockScalarValue(raw, indent, l.number, lines, idx, captureReferences); ok {
					v, e = bv, be
				} else {
					v, e = parseFlowOrScalar(stripComment(raw), strict, l.number, onWarning, captureReferences)
				}
			}
			if e != nil {
				return nil, e
			}
			setP(&m, key, v)
		}
	}
	if isArray {
		return &pvalue{line: start, array: arr}, nil
	}
	return &pvalue{line: start, mapping: m}, nil
}

func parseCorePositioned(input string, strict bool, onWarning func(Diagnostic), captureReferences bool) ([]pentry, error) {
	if len(input) > documentSizeLimit {
		return nil, limaError(ResourceLimit, 1, fmt.Sprintf("Lima: document exceeds maximum size of %d bytes at line 1", documentSizeLimit))
	}
	lines := sourceLines(input)
	var root []pentry
	entryCount := 0
	for i := 0; i < len(lines); {
		l := lines[i]
		if l.indent > 0 || trimWhitespace(l.text) == "" || strings.HasPrefix(l.text, "#") {
			i++
			continue
		}
		c := l.text
		if spaceBeforeColon(c) {
			if strict {
				return nil, limaError(InvalidQuote, l.number, fmt.Sprintf("Lima: space between closing quote and colon at line %d", l.number))
			}
			i++
			continue
		}
		sep := findSep(c)
		bare := false
		if sep < 0 && strings.HasSuffix(c, ":") && len(c) > 1 {
			sep = len(c) - 1
			bare = true
		}
		if sep < 0 {
			i++
			continue
		}
		if !isValidKey(c[:sep]) {
			// §5.1: not a usable key — unrecognised line, skipped in both
			// modes (§10's strict list is closed and does not cover this).
			i++
			continue
		}
		// The top-level scanner preserves non-ASCII leading whitespace as
		// literal key text. Trimming applies inside recognized block/flow
		// values, not while deciding top-level structure.
		key, e0 := stripKeyQuotes(c[:sep], strict, l.number)
		if e0 != nil {
			return nil, e0
		}
		entryCount++
		if entryCount > topLevelKeyLimit {
			return nil, limaError(ResourceLimit, 1, fmt.Sprintf("Lima: too many top-level key entries (max %d) at line 1", topLevelKeyLimit))
		}
		if e := checkKeyLength(key, l.number); e != nil {
			return nil, e
		}
		exists := false
		for _, x := range root {
			exists = exists || x.key == key
		}
		if e := checkDuplicate(exists, key, l.number, strict, onWarning); e != nil {
			return nil, e
		}
		i++
		var v *pvalue
		var e error
		if bare {
			j := i
			// Core §4 rule 7 / §6.1.3: comment lines do not affect base
			// indentation and are skipped — including here, in the lookahead
			// that decides whether this bare key has any nested block at all.
			// Neither a blank nor a comment line establishes the baseline;
			// parseBlock re-skips the same lines from i once it is called.
			for j < len(lines) && (trimWhitespace(lines[j].text) == "" || strings.HasPrefix(trimWhitespace(lines[j].text), "#")) {
				j++
			}
			if j < len(lines) && lines[j].indent > 0 {
				v, e = parseBlock(lines, &i, lines[j].indent, strict, onWarning, captureReferences)
			}
			if v == nil && e == nil {
				v = pv(Null{}, l.number)
			}
		} else {
			raw := trimWhitespace(c[sep+2:])
			if bv, ok, be := blockScalarValue(raw, 0, l.number, lines, &i, captureReferences); ok {
				v, e = bv, be
			} else {
				v, e = parseFlowOrScalar(stripComment(raw), strict, l.number, onWarning, captureReferences)
			}
		}
		if e != nil {
			return nil, e
		}
		setP(&root, key, v)
	}
	return root, nil
}

// ParseCore parses input according to Lima Core 1.0. The returned Value is
// always a Map. strict enables the specification's strict diagnostics.
func ParseCore(input string, strict bool) (Value, error) {
	return ParseCoreWithOptions(input, CoreOptions{Strict: strict})
}

// CoreOptions configures ParseCoreWithOptions.
type CoreOptions struct {
	Strict    bool
	OnWarning func(Diagnostic)
}

// ParseCoreWithOptions parses Lima Core 1.0 with warning callbacks.
func ParseCoreWithOptions(input string, options CoreOptions) (Value, error) {
	m, e := parseCorePositioned(input, options.Strict, options.OnWarning, false)
	if e != nil {
		return nil, e
	}
	out := make(Map, len(m))
	for i, x := range m {
		out[i] = Entry{x.key, x.value.plain()}
	}
	for _, e := range out {
		if valueDepth(e.Value) > nestingDepthLimit {
			return nil, limaError(ResourceLimit, 1, fmt.Sprintf("Lima: nesting depth exceeds maximum of %d at line 1", nestingDepthLimit))
		}
	}
	return out, nil
}
