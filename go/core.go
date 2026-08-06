// Package lima implements Lima Core 1.0 and Lima References 1.0 with only
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
		n := len(s) - len(trimLeftWhitespace(s))
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
	return trimLeftWhitespace(l.text)
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

func mergeBlockScalar(lines []sourceLine, key string) string {
	minIndent := int(^uint(0) >> 1)
	for _, l := range lines {
		if trimWhitespace(l.text) != "" && l.indent < minIndent {
			minIndent = l.indent
		}
	}
	if minIndent > len([]rune(key))+2 {
		minIndent = len([]rune(key)) + 2
	}
	if minIndent <= 1 || minIndent == int(^uint(0)>>1) {
		minIndent = 0
	}
	merged := []string{}
	for _, l := range lines {
		text := l.text
		cut := minIndent
		if cut > len(text) {
			cut = len(text)
		}
		text = strings.TrimRight(text[cut:], " ")
		continuation := strings.HasPrefix(text, "^^")
		if continuation {
			text = text[2:]
		}
		if continuation && len(merged) > 0 {
			if text != "" {
				merged[len(merged)-1] += " " + text
			}
		} else {
			merged = append(merged, text)
		}
	}
	for len(merged) > 0 && merged[len(merged)-1] == "" {
		merged = merged[:len(merged)-1]
	}
	return strings.Join(merged, "\n")
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

func parseBlock(lines []sourceLine, idx *int, indent int, strict bool) (*pvalue, error) {
	for *idx < len(lines) && (trimWhitespace(lines[*idx].text) == "" || strings.HasPrefix(trimWhitespace(lines[*idx].text), "#")) {
		*idx++
	}
	if *idx >= len(lines) || lines[*idx].indent < indent {
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
		if l.indent < indent {
			break
		}
		if l.indent > indent {
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
				for *idx < len(lines) && lines[*idx].indent > indent {
					*idx++
				}
				continue
			}
			if rest == "" {
				arr = append(arr, pv(Null{}, l.number))
				*idx++
				continue
			}
			if sep := findSep(rest); sep >= 0 {
				key := stripKeyQuotes(trimWhitespace(rest[:sep]))
				v, e := parseFlowOrScalar(trimWhitespace(rest[sep+2:]), strict, l.number)
				if e != nil {
					return nil, e
				}
				item := []pentry{{key, v}}
				*idx++
				for *idx < len(lines) && lines[*idx].indent > indent {
					cl := lines[*idx]
					cc := lineContent(cl)
					s := findSep(cc)
					if s < 0 {
						break
					}
					ck := stripKeyQuotes(trimWhitespace(cc[:s]))
					cv, e := parseFlowOrScalar(stripComment(trimWhitespace(cc[s+2:])), strict, cl.number)
					if e != nil {
						return nil, e
					}
					setP(&item, ck, cv)
					*idx++
				}
				arr = append(arr, &pvalue{line: l.number, mapping: item})
				continue
			}
			v, e := parseFlowOrScalar(rest, strict, l.number)
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
			key := stripKeyQuotes(trimWhitespace(c[:sep]))
			if e := checkKeyLength(key, l.number); e != nil {
				return nil, e
			}
			exists := false
			for _, e := range m {
				exists = exists || e.key == key
			}
			if e := checkDuplicate(exists, key, l.number, strict); e != nil {
				return nil, e
			}
			*idx++
			var v *pvalue
			var e error
			if bare {
				if *idx < len(lines) && lines[*idx].indent > indent {
					v, e = parseBlock(lines, idx, lines[*idx].indent, strict)
				}
				if v == nil && e == nil {
					v = pv(Null{}, l.number)
				}
			} else {
				v, e = parseFlowOrScalar(stripComment(trimWhitespace(c[sep+2:])), strict, l.number)
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

func parseCorePositioned(input string, strict bool) ([]pentry, error) {
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
		key := stripKeyQuotes(trimWhitespace(c[:sep]))
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
		if e := checkDuplicate(exists, key, l.number, strict); e != nil {
			return nil, e
		}
		i++
		var v *pvalue
		var e error
		if bare {
			j := i
			for j < len(lines) && (trimWhitespace(lines[j].text) == "" || strings.HasPrefix(trimWhitespace(lines[j].text), "#")) {
				j++
			}
			if j < len(lines) && lines[j].indent > 0 {
				v, e = parseBlock(lines, &i, lines[j].indent, strict)
			}
			if v == nil && e == nil {
				v = pv(Null{}, l.number)
			}
		} else {
			raw := trimWhitespace(c[sep+2:])
			if raw == "|" {
				var body []sourceLine
				for i < len(lines) && (lines[i].indent > 0 || trimWhitespace(lines[i].text) == "") {
					body = append(body, lines[i])
					i++
				}
				v = pstr(mergeBlockScalar(body, key), l.number, false)
			} else {
				v, e = parseFlowOrScalar(stripComment(raw), strict, l.number)
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
	m, e := parseCorePositioned(input, strict)
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
