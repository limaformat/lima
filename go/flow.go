package lima

import (
	"fmt"
	"strings"
)

func flowParts(s string) []string {
	var out []string
	start := 0
	q := byte(0)
	esc := false
	depth := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		if esc {
			esc = false
			continue
		}
		if q != 0 {
			if c == '\\' {
				esc = true
			} else if c == q {
				q = 0
			}
			continue
		}
		if c == '"' || c == '\'' {
			q = c
		} else if c == '[' || c == '{' {
			depth++
		} else if c == ']' || c == '}' {
			depth--
		} else if c == ',' && depth == 0 {
			out = append(out, trimWhitespace(s[start:i]))
			start = i + 1
		}
	}
	return append(out, trimWhitespace(s[start:]))
}
func findSep(s string) int {
	q := byte(0)
	esc := false
	for i := 0; i+1 < len(s); i++ {
		c := s[i]
		if esc {
			esc = false
			continue
		}
		if q != 0 {
			if c == '\\' {
				esc = true
			} else if c == q {
				q = 0
			}
			continue
		}
		if c == '"' || c == '\'' {
			q = c
		} else if c == ':' && s[i+1] == ' ' {
			return i
		}
	}
	return -1
}
func parseFlowOrScalar(raw string, strict bool, line int) (*pvalue, error) {
	if strings.HasPrefix(raw, "[") {
		if !strings.HasSuffix(raw, "]") {
			if strict {
				return nil, limaError(InvalidFlowSyntax, line, fmt.Sprintf("Lima: unclosed flow sequence at line %d", line))
			}
			return parseScalar(raw, strict, line, true)
		}
		inner := trimWhitespace(raw[1 : len(raw)-1])
		a := []*pvalue{}
		if inner != "" {
			parts := flowParts(inner)
			for partIndex, part := range parts {
				if part == "" {
					if strict {
						return nil, limaError(InvalidFlowSyntax, line, fmt.Sprintf("Lima: empty element in flow sequence at line %d", line))
					}
					// Non-strict flow sequences preserve leading/consecutive empty
					// elements as null, but ignore a single trailing comma.
					if partIndex != len(parts)-1 || !strings.HasSuffix(inner, ",") {
						a = append(a, pv(Null{}, line))
					}
					continue
				}
				if strings.HasPrefix(part, "[") {
					return nil, limaError(InvalidFlowSyntax, line, fmt.Sprintf("Lima: invalid flow nesting at line %d: %q", line, part))
				}
				v, e := parseFlowOrScalar(part, strict, line)
				if e != nil {
					return nil, e
				}
				a = append(a, v)
			}
		}
		return &pvalue{line: line, array: a}, nil
	}
	if strings.HasPrefix(raw, "{") {
		if !strings.HasSuffix(raw, "}") {
			if strict {
				return nil, limaError(InvalidFlowSyntax, line, fmt.Sprintf("Lima: unclosed flow mapping at line %d", line))
			}
			return parseScalar(raw, strict, line, true)
		}
		inner := trimWhitespace(raw[1 : len(raw)-1])
		m := []pentry{}
		if inner != "" {
			for _, part := range flowParts(inner) {
				if part == "" {
					if strict {
						return nil, limaError(InvalidFlowSyntax, line, fmt.Sprintf("Lima: empty element in flow mapping at line %d", line))
					}
					continue
				}
				sep := findSep(part)
				if sep < 0 {
					if strict {
						return nil, limaError(InvalidFlowSyntax, line, fmt.Sprintf("Lima: invalid flow mapping item (missing \": \") at line %d: %q", line, part))
					}
					return parseScalar(raw, strict, line, true)
				}
				key := stripKeyQuotes(trimWhitespace(part[:sep]))
				if e := checkKeyLength(key, line); e != nil {
					return nil, e
				}
				idx := -1
				for i := range m {
					if m[i].key == key {
						idx = i
					}
				}
				if e := checkDuplicate(idx >= 0, key, line, strict); e != nil {
					return nil, e
				}
				rv := trimWhitespace(part[sep+2:])
				if strings.HasPrefix(rv, "[") || strings.HasPrefix(rv, "{") {
					return nil, limaError(InvalidFlowSyntax, line, fmt.Sprintf("Lima: invalid flow nesting at line %d: %q", line, rv))
				}
				v, e := parseScalar(rv, strict, line, false)
				if e != nil {
					return nil, e
				}
				if idx >= 0 {
					m[idx].value = v
				} else {
					m = append(m, pentry{key, v})
				}
			}
		}
		return &pvalue{line: line, mapping: m}, nil
	}
	return parseScalar(raw, strict, line, true)
}
