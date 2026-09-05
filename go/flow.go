package lima

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// flowPart is one comma-separated element of a flow container: its trimmed
// text and the byte offset of that trimmed text within the container's
// inner string. The offset feeds References §5 error ordering — a token's
// position must reflect its real place across a flow collection's
// elements, not an offset local to one element's own scalar text.
type flowPart struct {
	text  string
	start int
}

// rawOffsetOf maps a byte offset in the decoded flow container `val` to the
// corresponding offset in the physical container `raw`. The two differ only
// by `\#` → `#` collapses outside quoted strings (stripComment keeps `\#`
// inside quotes), so every `#` in `val` outside a quote is one such collapse
// — `raw` has `\#` there. `#`, `\`, `"`, `'` are ASCII, so byte scanning is
// safe (continuation bytes of a multi-byte rune are all >= 0x80).
func rawOffsetOf(raw, val string, valOffset int) int {
	ri, vi := 0, 0
	q := byte(0)
	for vi < valOffset && vi < len(val) {
		c := val[vi]
		if q != 0 {
			if c == '\\' {
				vi += 2
				ri += 2
				continue
			}
			if c == q {
				q = 0
			}
			vi++
			ri++
			continue
		}
		if c == '"' || c == '\'' {
			q = c
		} else if c == '#' {
			vi++
			ri += 2 // '#' in the decoded container <= '\#' in raw
			continue
		}
		vi++
		ri++
	}
	if ri > len(raw) {
		ri = len(raw)
	}
	return ri
}

// elementSource is the referenceSource for a flow element spanning bytes
// [byteStart, byteEnd) of the decoded container `dec` — src.col (the column
// of the container's opening `[`/`{`) plus the codepoint distance to the
// element's start in the physical text, plus the physical element slice as
// raw. So a token's reported position (§2.4) and §5 ordering are right even
// when an earlier `\#` widened the source.
func elementSource(src *referenceSource, dec string, byteStart, byteEnd int) *referenceSource {
	if src == nil {
		return nil
	}
	raw := src.raw
	if raw == "" {
		raw = dec
	}
	rs := rawOffsetOf(raw, dec, byteStart)
	re := rawOffsetOf(raw, dec, byteEnd)
	return &referenceSource{
		line:      src.line,
		col:       src.col + utf8.RuneCountInString(raw[:rs]),
		raw:       raw[rs:re],
		tabAdjust: src.tabAdjust,
	}
}

// innerByteOffset is the byte offset of the trimmed inner string within the
// flow container `raw` (past `[`/`{` and any leading whitespace).
func innerByteOffset(raw string) int {
	body := raw[1 : len(raw)-1]
	return 1 + len(body) - len(trimLeftWhitespace(body))
}

func flowParts(s string) []flowPart {
	var out []flowPart
	seg := 0
	emit := func(end int) {
		raw := s[seg:end]
		out = append(out, flowPart{
			text:  trimWhitespace(raw),
			start: seg + len(raw) - len(trimLeftWhitespace(raw)),
		})
	}
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
			emit(i)
			seg = i + 1
		}
	}
	emit(len(s))
	return out
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
func parseFlowOrScalar(raw string, strict bool, line int, onWarning func(Diagnostic), captureReferences bool, src *referenceSource) (*pvalue, error) {
	if strings.HasPrefix(raw, "[") {
		if !strings.HasSuffix(raw, "]") {
			if strict {
				return nil, limaError(InvalidFlowSyntax, line, fmt.Sprintf("Lima: unclosed flow sequence at line %d", line))
			}
			return parseScalar(raw, strict, line, captureReferences, src)
		}
		innerOff := innerByteOffset(raw)
		inner := trimWhitespace(raw[1 : len(raw)-1])
		a := []*pvalue{}
		if inner != "" {
			parts := flowParts(inner)
			for partIndex, fp := range parts {
				part := fp.text
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
				es := elementSource(src, raw, innerOff+fp.start, innerOff+fp.start+len(part))
				v, e := parseFlowOrScalar(part, strict, line, onWarning, captureReferences, es)
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
			return parseScalar(raw, strict, line, captureReferences, src)
		}
		innerOff := innerByteOffset(raw)
		inner := trimWhitespace(raw[1 : len(raw)-1])
		m := []pentry{}
		if inner != "" {
			for _, fp := range flowParts(inner) {
				part := fp.text
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
					return parseScalar(raw, strict, line, captureReferences, src)
				}
				keyRaw := trimWhitespace(part[:sep])
				if !isValidKey(keyRaw) {
					// §5.1: not a usable key — the item is skipped in both
					// modes (§10's strict list is closed and does not cover
					// this), the same as at the top level.
					continue
				}
				key, e := stripKeyQuotes(keyRaw, strict, line)
				if e != nil {
					return nil, e
				}
				if e := checkKeyLength(key, line); e != nil {
					return nil, e
				}
				idx := -1
				for i := range m {
					if m[i].key == key {
						idx = i
					}
				}
				if e := checkDuplicate(idx >= 0, key, line, strict, onWarning); e != nil {
					return nil, e
				}
				valuePart := part[sep+2:]
				rv := trimWhitespace(valuePart)
				if strings.HasPrefix(rv, "[") || strings.HasPrefix(rv, "{") {
					return nil, limaError(InvalidFlowSyntax, line, fmt.Sprintf("Lima: invalid flow nesting at line %d: %q", line, rv))
				}
				vStart := innerOff + fp.start + sep + 2 + len(valuePart) - len(trimLeftWhitespace(valuePart))
				es := elementSource(src, raw, vStart, vStart+len(rv))
				v, e := parseScalar(rv, strict, line, captureReferences, es)
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
	return parseScalar(raw, strict, line, captureReferences, src)
}
