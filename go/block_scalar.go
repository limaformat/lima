package lima

import "strings"

const blockScalarMaxInt = int(^uint(0) >> 1)

// buildBlockScalar builds a Core §6.1.5 literal block scalar (`|`). It is
// shared by the top-level key path and the nested block path
// (parseCorePositioned and parseBlock): §6.1.5 defines block scalar extent
// generically ("indentation strictly greater than the indentation of the
// key that introduced the scalar"), with no top-level restriction, so both
// call sites must agree byte for byte. Mirrors js/src/block-scalar.ts.
//
// bodyLines are the physical source lines after the `|` line. keyIndent is
// the introducing key's indentation (0 at the top level). It returns the
// joined value, the raw body (original column-0 lines joined with "\n", from
// which a token's physical (line, offset) is read — §2.4, never from the
// ^^-merged value), how many of bodyLines the scalar consumed, and any
// scalar-length error.
func buildBlockScalar(bodyLines []sourceLine, keyIndent int) (string, string, int, error) {
	// Extent (§6.1.5): a line belongs to the scalar iff its indentation is
	// strictly greater than the introducing key's. Empty lines between
	// content lines belong regardless; the first non-empty line dedented to
	// the key's column or less ends the scalar, `#` lines included.
	consumed := len(bodyLines)
	for i, l := range bodyLines {
		if trimWhitespace(l.text) == "" {
			continue
		}
		if l.indent <= keyIndent {
			consumed = i
			break
		}
	}
	lines := bodyLines[:consumed]

	// Content indentation (§6.1.5): the smallest number of leading spaces
	// among all non-empty content lines, measured from column 0, removed
	// uniformly from every line. No cap tied to the key's length.
	minIndent := blockScalarMaxInt
	for _, l := range lines {
		if trimWhitespace(l.text) != "" && l.indent < minIndent {
			minIndent = l.indent
		}
	}
	trimAmt := 0
	if minIndent != blockScalarMaxInt {
		trimAmt = minIndent
	}

	merged := []string{}
	rawLines := make([]string, len(lines))
	for i, l := range lines {
		rawLines[i] = l.text
		text := l.text
		cut := trimAmt
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

	joined := strings.Join(merged, "\n")
	limitLine := 1
	if len(bodyLines) > 0 {
		limitLine = bodyLines[0].number - 1
	}
	if e := checkStringLimit(joined, limitLine); e != nil {
		return "", "", 0, e
	}
	return joined, strings.Join(rawLines, "\n"), consumed, nil
}

// blockScalarValue handles a key whose inline value text is exactly `|`.
// *idx must already point at the first line after the `key: |` line; it
// consumes the lines belonging to the block scalar introduced by a key at
// keyIndent, advancing *idx past them, and returns (value, true, err). For
// any other raw it returns (nil, false, nil) and the caller parses the
// inline value itself.
func blockScalarValue(raw string, keyIndent, keyLine int, lines []sourceLine, idx *int, captureReferences bool) (*pvalue, bool, error) {
	if raw != "|" {
		return nil, false, nil
	}
	var body []sourceLine
	for *idx < len(lines) && (lines[*idx].indent > keyIndent || trimWhitespace(lines[*idx].text) == "") {
		body = append(body, lines[*idx])
		*idx++
	}
	text, rawBody, consumed, e := buildBlockScalar(body, keyIndent)
	if e != nil {
		return nil, true, e
	}
	var src *referenceSource
	if captureReferences {
		tab := make([]int, consumed)
		for i := 0; i < consumed && i < len(body); i++ {
			tab[i] = body[i].tabAdjust
		}
		src = &referenceSource{raw: rawBody, line: keyLine + 1, col: 0, tabAdjust: tab}
	}
	v := pstr(text, keyLine+1, false, captureReferences, src)
	return v, true, nil
}
