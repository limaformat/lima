// Package lima implements Lima Core 1.2 and Lima References 2.1 with only
// the Go standard library.
package lima

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

type sourceLine struct {
	text           string
	number, indent int
	// Columns Core §3 leading-tab expansion added to this line (one per
	// leading tab), subtracted when reporting a References 2.0 token's
	// column so it is the *original*-source column (§2.4).
	tabAdjust int
}

func sourceLines(input string) []sourceLine {
	input = strings.ReplaceAll(strings.ReplaceAll(input, "\r\n", "\n"), "\r", "\n")
	// Original (pre-tab-expansion) lines, only needed to count how many
	// columns leading-tab expansion added per line (References 2.0 §2.4).
	// Overwhelmingly, frontmatter has no tabs at all — skip the extra split
	// and the per-line scan in that case (mirrors the TS/Rust `has tab?`
	// guard). ParseCore discards tabAdjust entirely, but the count is cheap
	// enough here not to warrant a second `captureReferences` branch.
	var preTab []string
	if strings.Contains(input, "\t") {
		preTab = strings.Split(input, "\n")
	}
	input = expandLeadingTabs(input)
	raw := strings.Split(input, "\n")
	out := make([]sourceLine, len(raw))
	for i, s := range raw {
		// §3: trailing spaces go first, so a line of spaces alone is empty
		// and has no indentation (counting before the trim crashed
		// lineContent on such a line).
		s = strings.TrimRight(s, " ")
		// Structural indentation is ASCII-space-only after tabs have already
		// been expanded above. Non-ASCII trim whitespace remains part of the
		// key text here, matching Rust's top-level block-boundary scan.
		n := 0
		for n < len(s) && s[n] == ' ' {
			n++
		}
		tabs := 0
		if preTab != nil && i < len(preTab) {
			for _, c := range preTab[i] {
				if c == '\t' {
					tabs++
				} else if c != ' ' {
					break
				}
			}
		}
		out[i] = sourceLine{s, i + 1, n, tabs}
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
	// Indentation is spaces only (Core 1.1 §7.1): other whitespace before
	// content starts the content, and only a blank or comment line looks past
	// it, as at a zero ASCII indent.
	c := lineContent(l)
	if l.indent == 0 || (c != "" && c[0] > 0x20 && c[0] < 0x7f) {
		return l.indent
	}
	rest := trimLeftWhitespace(c)
	if rest != "" && rest[0] != '#' {
		return l.indent
	}
	return l.indent + len(c) - len(rest)
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
	if j >= len(lines) {
		return pv(Null{}, keyLine), nil
	}
	var v *pvalue
	var e error
	switch next := lineStructuralIndent(lines[j]); {
	case next > keyColumn:
		v, e = parseBlock(lines, idx, next, strict, onWarning, captureReferences, false)
	case next == keyColumn && isSequenceItem(lineContent(lines[j])):
		// Core 1.1 §7.2: a sequence may start at its key's own column
		v, e = parseBlock(lines, idx, keyColumn, strict, onWarning, captureReferences, true)
	default:
		return pv(Null{}, keyLine), nil
	}
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

func leadingWsBytes(s string) int { return len(s) - len(trimLeftWhitespace(s)) }

// valueColOf returns the codepoint column of the value's first character,
// given the full source line and the byte offset where the value begins.
func valueColOf(lineText string, valueByteStart int) int {
	if valueByteStart > len(lineText) {
		valueByteStart = len(lineText)
	}
	return utf8.RuneCountInString(lineText[:valueByteStart])
}

// inlineRefSource builds the References 2.0 source anchor for an inline
// value on line `l`, only when references are being captured (ParseCore
// discards it, so skip the allocation there). `rawFrom` is the value text
// before `\#` collapse; a trailing comment is dropped here (its
// `${…}`-shaped text is not part of the value) but `\#` is kept, so a
// token's column is its physical position in the original source (§2.4).
// `col` is the value's codepoint column in the tab-expanded line.
func inlineRefSource(capture bool, l sourceLine, rawFrom string, col int) *referenceSource {
	if !capture {
		return nil
	}
	return &referenceSource{
		raw:       strings.TrimRight(physicalRaw(rawFrom), " "),
		line:      l.number,
		col:       col,
		tabAdjust: []int{l.tabAdjust},
	}
}

func parseArrayItemContinuationKeys(item *[]pentry, lines []sourceLine, idx *int, indent, keyColumn int, strict bool, onWarning func(Diagnostic), captureReferences bool, compact bool) error {
	// blank and comment lines are skipped (§7.1 rules 6 and 7), and in
	// non-strict mode a line at the dash's column that is no item, which the
	// sequence skips (§7.1) — unless it ends a compact sequence (§7.2)
	skipped := func(l sourceLine) bool {
		return isBlankOrComment(l.text) ||
			(!strict && !compact && lineStructuralIndent(l) == indent && !isSequenceItem(lineContent(l)))
	}
	for *idx < len(lines) {
		// the item goes on when the next content line is deeper than its dash
		if skipped(lines[*idx]) {
			next := *idx + 1
			for next < len(lines) && skipped(lines[next]) {
				next++
			}
			if next == len(lines) || lineStructuralIndent(lines[next]) <= indent {
				break
			}
			*idx = next
		}
		// §7.2: the item's keys stand at its first key's column. A line less
		// indented ends the item (§7.1 rule 4), and the block parser reads
		// it; a deeper one, which no nested block took, is inconsistently
		// indented (rule 5) and the item goes on
		switch li := lineStructuralIndent(lines[*idx]); {
		case li < keyColumn:
			return nil
		case li > keyColumn:
			if strict {
				return limaError(InvalidIndentation, lines[*idx].number, fmt.Sprintf("Lima: unexpected indentation at line %d: %q", lines[*idx].number, lineContent(lines[*idx])))
			}
			*idx++
			continue
		}
		cl := lines[*idx]
		cc := lineContent(cl)
		s := findSep(cc)
		bare := false
		keyEnd := s
		if s < 0 {
			if !strings.HasSuffix(cc, ":") || len(cc) < 2 {
				// freetext, a stray item or marker deeper than the dash:
				// skipped in non-strict mode; in strict mode the block
				// parser reports its indentation
				if !strict {
					*idx++
					continue
				}
				break
			}
			keyEnd = len(cc) - 1
			bare = true
		}
		ckRaw := trimRightWhitespace(cc[:keyEnd]) // leading whitespace makes it no key (Core 1.1 §7.1)
		if !isValidKey(ckRaw) {
			// §5.1: an unrecognised line, an error in strict mode (Core 1.1 §10.1)
			if strict {
				return unrecognizedKeyLine(cl.number, cc)
			}
			*idx++
			continue
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
			rvRaw := cc[s+2:]
			// The raw anchor must start at the same byte the column points
			// to — after the *project* (ECMAScript) leading-whitespace set,
			// not Go's `strings.TrimSpace` (which also eats U+0085 etc.), so
			// raw and decoded scans stay in lockstep (§2.4).
			valueByte := cl.indent + s + 2 + leadingWsBytes(rvRaw)
			if bv, ok, be := blockScalarValue(trimWhitespace(rvRaw), cl.indent, cl.number, lines, idx, captureReferences); ok {
				cv, e = bv, be
			} else {
				src := inlineRefSource(captureReferences, cl, cl.text[valueByte:], valueColOf(cl.text, valueByte))
				cv, e = parseFlowOrScalar(stripComment(trimWhitespace(rvRaw)), strict, cl.number, onWarning, captureReferences, src)
			}
		}
		if e != nil {
			return e
		}
		setP(item, ck, cv)
	}
	return nil
}

// itemKeyColumn is the column of an object item's first key, after `- `
// (§7.2), where its later keys stand. Codepoints: a multi-byte space after
// the dash counts as one column, matching the TypeScript reference (CR-M2).
func itemKeyColumn(l sourceLine, c string) int {
	afterDash := c[1:]
	dashWs := afterDash[:len(afterDash)-len(trimLeftWhitespace(afterDash))]
	return lineStructuralIndent(l) + 1 + utf8.RuneCountInString(dashWs)
}

// firstIsItem reports whether the first item or mapping entry at indent, from
// line i on, is an item; lines that are neither, or deeper, do not count.
func firstIsItem(lines []sourceLine, i, indent int) bool {
	for ; i < len(lines); i++ {
		if isBlankOrComment(lines[i].text) {
			continue
		}
		switch li := lineStructuralIndent(lines[i]); {
		case li < indent:
			return false
		case li > indent:
			continue
		}
		c := lineContent(lines[i])
		if isSequenceItem(c) {
			return true
		}
		sep := findSep(c)
		if sep < 0 && strings.HasSuffix(c, ":") {
			sep = len(c) - 1
		}
		if sep >= 0 && isValidKey(trimRightWhitespace(c[:sep])) {
			return false
		}
	}
	return false
}

// parseBlock parses the block at indent; a compact sequence (Core 1.1 §7.2,
// one at its key's own column) ends at that column's first line that is no
// item.
func parseBlock(lines []sourceLine, idx *int, indent int, strict bool, onWarning func(Diagnostic), captureReferences bool, compact bool) (*pvalue, error) {
	for *idx < len(lines) && (trimWhitespace(lines[*idx].text) == "" || strings.HasPrefix(trimWhitespace(lines[*idx].text), "#")) {
		*idx++
	}
	if *idx >= len(lines) || lineStructuralIndent(lines[*idx]) < indent {
		return nil, nil
	}
	start := lines[*idx].number
	// the first entry or item decides (Core 1.1 §7.1); in strict mode a line
	// that is neither throws before any other
	isArray := isSequenceItem(lineContent(lines[*idx])) || (!strict && firstIsItem(lines, *idx, indent))
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
			if !isSequenceItem(c) {
				// a sequence at its key's column ends at that column's first
				// line that is no item (Core 1.1 §7.2)
				if compact {
					break
				}
				if strict {
					return nil, limaError(InvalidIndentation, l.number, fmt.Sprintf("Lima: mixed map and array entries for the same key at line %d", l.number))
				}
				*idx++
				continue
			}
			rest := trimWhitespace(strings.TrimPrefix(c, "-"))
			rest = stripComment(rest)
			if isSequenceItem(rest) {
				if strict {
					return nil, limaError(InvalidIndentation, l.number, fmt.Sprintf("Lima: nested block sequence at line %d: %q", l.number, c))
				}
				arr = append(arr, pv(Null{}, l.number))
				*idx++
				for *idx < len(lines) && (isBlankOrComment(lines[*idx].text) || lineStructuralIndent(lines[*idx]) > indent) {
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
				// `|` alone is a block scalar marker; `| # c` is the string `|` (§6.1.5)
				afterDash := trimWhitespace(strings.TrimPrefix(c, "-"))
				commented := trimWhitespace(stripCommentKeepEscapes(afterDash)) != afterDash
				*idx++
				var v *pvalue
				var e error
				// a `|` scalar's lines are deeper than its key's column, after `- `
				if rawVal == "|" && !commented {
					v, _, e = blockScalarValue(rawVal, itemKeyColumn(l, c), l.number, lines, idx, captureReferences)
				} else {
					restByteInC := 1 + leadingWsBytes(c[1:])
					valueByte := l.indent + restByteInC + sep + 2 + leadingWsBytes(rest[sep+2:])
					vcol := valueColOf(l.text, valueByte)
					v, e = parseFlowOrScalar(rawVal, strict, l.number, onWarning, captureReferences, inlineRefSource(captureReferences, l, l.text[valueByte:], vcol))
				}
				if e != nil {
					return nil, e
				}
				item := []pentry{{key, v}}
				if e := parseArrayItemContinuationKeys(&item, lines, idx, indent, itemKeyColumn(l, c), strict, onWarning, captureReferences, compact); e != nil {
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
				*idx++
				v, e := bareNestedValue(itemKeyColumn(l, c), l.number, lines, idx, strict, onWarning, captureReferences)
				if e != nil {
					return nil, e
				}
				item := []pentry{{key, v}}
				if e := parseArrayItemContinuationKeys(&item, lines, idx, indent, itemKeyColumn(l, c), strict, onWarning, captureReferences, compact); e != nil {
					return nil, e
				}
				arr = append(arr, &pvalue{line: l.number, mapping: item})
				continue
			}
			restByte := l.indent + 1 + leadingWsBytes(c[1:])
			v, e := parseFlowOrScalar(rest, strict, l.number, onWarning, captureReferences, inlineRefSource(captureReferences, l, l.text[restByte:], valueColOf(l.text, restByte)))
			if e != nil {
				return nil, e
			}
			// an item's value is an inline value (§15.3); a flow sequence
			// there is a sequence in a sequence (§7.2)
			if v.array != nil {
				if strict {
					return nil, limaError(InvalidFlowSyntax, l.number, fmt.Sprintf("Lima: nested sequence at line %d: %q", l.number, c))
				}
				v = pv(Null{}, l.number)
			}
			arr = append(arr, v)
			*idx++
		} else {
			if isSequenceItem(c) {
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
			if !isValidKey(trimRightWhitespace(c[:sep])) {
				// §5.1: not a usable key — an unrecognised line, skipped in
				// non-strict mode and an error in strict mode, as at the top
				// level (Core 1.1 §10.1)
				if strict {
					return nil, unrecognizedKeyLine(l.number, c)
				}
				*idx++
				continue
			}
			key, e0 := stripKeyQuotes(trimRightWhitespace(c[:sep]), strict, l.number)
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
				// deeper than the key, or a sequence at its column (Core 1.1
				// §7.2); bareNestedValue skips blank and comment lines first
				v, e = bareNestedValue(indent, l.number, lines, idx, strict, onWarning, captureReferences)
			} else {
				raw := trimWhitespace(c[sep+2:])
				valueByte := l.indent + sep + 2 + leadingWsBytes(c[sep+2:])
				vcol := valueColOf(l.text, valueByte)
				if bv, ok, be := blockScalarValue(raw, indent, l.number, lines, idx, captureReferences); ok {
					v, e = bv, be
				} else {
					v, e = parseFlowOrScalar(stripComment(raw), strict, l.number, onWarning, captureReferences, inlineRefSource(captureReferences, l, l.text[valueByte:], vcol))
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

// topLevelKeyCount counts the top-level key entries in lines, duplicates
// included (§9): the lines at column 0 the loop in parseCorePositioned reads
// as keys.
func topLevelKeyCount(lines []sourceLine) int {
	n := 0
	for _, l := range lines {
		c := l.text
		if l.indent > 0 || trimWhitespace(c) == "" || strings.HasPrefix(c, "#") || spaceBeforeColon(c) {
			continue
		}
		sep := findSep(c)
		if sep < 0 && strings.HasSuffix(c, ":") && len(c) > 1 {
			sep = len(c) - 1
		}
		if sep >= 0 && isValidKey(c[:sep]) {
			n++
		}
	}
	return n
}

func parseCorePositioned(input string, strict bool, onWarning func(Diagnostic), captureReferences bool) ([]pentry, error) {
	if len(input) > documentSizeLimit {
		return nil, limaError(ResourceLimit, 1, fmt.Sprintf("Lima: document exceeds maximum size of %d bytes at line 1", documentSizeLimit))
	}
	lines := sourceLines(input)
	var root []pentry
	entryCount := 0
	// Core 1.1: the inline value of the last top-level key, for the hint an
	// indented line after a YAML marker earns (structure.go)
	lastValue := ""
	for i := 0; i < len(lines); {
		l := lines[i]
		if l.indent > 0 || trimWhitespace(l.text) == "" || strings.HasPrefix(l.text, "#") {
			// Core 1.1: an indented line the loop sees is one no block took —
			// before the first key, after an inline value, below a block's base
			// indentation, or after a "|" scalar a line at column 0 ended
			if strict && l.indent > 0 && !isBlankOrComment(l.text) {
				return nil, indentedLine(l, lastValue)
			}
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
			if strict && !isBlankOrComment(c) {
				return nil, unrecognizedLine(l)
			}
			i++
			continue
		}
		if !isValidKey(c[:sep]) {
			// §5.1: not a usable key — an unrecognised line, skipped in
			// non-strict mode and an error in strict mode (Core 1.1 §10.1).
			if strict {
				return nil, unrecognizedLine(l)
			}
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
		// §9: the top-level key entries are counted before the first is
		// read, so that the limit, not a later error, rejects the document
		// (each entry has a line of its own, so no more lines than the
		// limit need no count)
		if entryCount == 0 && len(lines)-i > topLevelKeyLimit && topLevelKeyCount(lines[i:]) > topLevelKeyLimit {
			return nil, limaError(ResourceLimit, 1, fmt.Sprintf("Lima: too many top-level key entries (max %d) at line 1", topLevelKeyLimit))
		}
		entryCount++
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
			lastValue = ""
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
				v, e = parseBlock(lines, &i, lines[j].indent, strict, onWarning, captureReferences, false)
			} else if j < len(lines) && isSequenceItem(lines[j].text) {
				// Core 1.1 §7.2: a sequence may start at its key's own column, 0
				v, e = parseBlock(lines, &i, 0, strict, onWarning, captureReferences, true)
			}
			if v == nil && e == nil {
				v = pv(Null{}, l.number)
			}
		} else {
			raw := trimWhitespace(c[sep+2:])
			valueByte := sep + 2 + leadingWsBytes(c[sep+2:])
			vcol := valueColOf(c, valueByte)
			lastValue = raw
			if bv, ok, be := blockScalarValue(raw, 0, l.number, lines, &i, captureReferences); ok {
				lastValue = ""
				v, e = bv, be
			} else {
				v, e = parseFlowOrScalar(stripComment(raw), strict, l.number, onWarning, captureReferences, inlineRefSource(captureReferences, l, c[valueByte:], vcol))
			}
		}
		if e != nil {
			return nil, e
		}
		setP(&root, key, v)
	}
	return root, nil
}

// ParseCore parses input according to Lima Core 1.1. The returned Value is
// always a Map. strict enables the specification's strict diagnostics.
func ParseCore(input string, strict bool) (Value, error) {
	return ParseCoreWithOptions(input, CoreOptions{Strict: strict})
}

// CoreOptions configures ParseCoreWithOptions.
type CoreOptions struct {
	Strict    bool
	OnWarning func(Diagnostic)
}

// ParseCoreWithOptions parses Lima Core 1.1 with warning callbacks.
func ParseCoreWithOptions(input string, options CoreOptions) (Value, error) {
	if err := validateDocument(input); err != nil {
		return nil, err
	}
	return parseCoreWithOptionsValidated(input, options)
}

func parseCoreWithOptionsValidated(input string, options CoreOptions) (Value, error) {
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
