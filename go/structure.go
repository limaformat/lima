package lima

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// Core 1.1 §4, §7.1 rule 5 and §10.1: in strict mode every content line
// belongs to the structure — mirrors js/src/structure.ts. A line that is
// neither blank nor a comment is
//
//   - unrecognised (UnrecognizedLine) when it starts at column 0 and matches
//     no key pattern;
//   - inconsistently indented (InvalidIndentation) when it is indented and
//     no block took it: before the first key; after a key with an inline
//     value other than "|", which opens no block; below a block's base
//     indentation, where the block parser stops; or after a "|" scalar that
//     a line at column 0 ended (§6.1.5).
//
// The block parsers take the lines they own, so the top-level loop sees an
// indented line only when no block owns it. Non-strict mode skips all of these
// lines, as Core 1.0 did in both modes.

// isBlankOrComment reports a line that needs no structure: blank, or a
// comment, by Lima's own whitespace.
func isBlankOrComment(text string) bool {
	content := strings.TrimLeftFunc(text, isTrimWhitespace)
	return content == "" || strings.HasPrefix(content, "#")
}

func unrecognizedLine(l sourceLine) error {
	return limaError(UnrecognizedLine, l.number, fmt.Sprintf("Lima: unrecognised line at line %d: %q%s", l.number, l.text, unrecognizedHint(l.text)))
}

// unrecognizedKeyLine is, in strict mode, a line in a block whose key the key
// grammar (§5.1) rejects (Core 1.1 §10.1).
func unrecognizedKeyLine(number int, text string) error {
	hint := specificKeyHint(text)
	if hint == "" {
		hint = keyGrammarHint
	}
	return limaError(UnrecognizedLine, number, fmt.Sprintf(`Lima: unrecognised line at line %d: %q%s`, number, text, hint))
}

func indentedLine(l sourceLine, inlineValue string) error {
	content := strings.TrimLeftFunc(l.text, isTrimWhitespace)
	return limaError(InvalidIndentation, l.number, fmt.Sprintf("Lima: unexpected indentation at line %d: %q%s", l.number, content, yamlHint(inlineValue)))
}

// unrecognizedHint is what a reader likely meant by an unrecognised line.
func unrecognizedHint(text string) string {
	if hint := specificKeyHint(text); hint != "" {
		return hint
	}
	if text == "---" || text == "..." {
		return " (a YAML document marker; Lima has one document)"
	}
	if isSequenceItem(text) {
		return " (a sequence item belongs to a key with no value of its own)"
	}
	if strings.HasPrefix(text, `"`) || strings.HasPrefix(text, "'") {
		return " (a quoted key closes on its own line)"
	}
	if separator := strings.Index(text, ": "); separator >= 0 && !isValidUnquotedKey(text[:separator], false) {
		return keyGrammarHint
	}
	// `author Odile`, `key:value`: key characters, but no ": " after them
	first, _, _ := strings.Cut(text, " ")
	keyChars := isValidUnquotedKey(first, false)
	if !strings.Contains(text, ":") || keyChars {
		return ` (a key needs ": " after it)`
	}
	return keyGrammarHint
}

// yamlHint is the hint a YAML block scalar marker in place of a value earns.
func yamlHint(value string) string {
	switch value {
	case ">", ">-", ">+":
		return fmt.Sprintf(` ("%s" is YAML's folded scalar; Lima writes "|" and continues a line with "^^")`, value)
	case "|-", "|+":
		return fmt.Sprintf(` ("%s" is a YAML chomping indicator; Lima writes "|")`, value)
	}
	return ""
}

// isSequenceItem reports whether a line's content begins a sequence item
// (§7.2): "-" alone or "-" followed by whitespace; "---" or "-x" does not
// (Core 1.1).
func isSequenceItem(c string) bool {
	rest, ok := strings.CutPrefix(c, "-")
	if !ok {
		return false
	}
	if rest == "" {
		return true
	}
	r, _ := utf8.DecodeRuneInString(rest)
	return isTrimWhitespace(r)
}
