package lima

import (
	"fmt"
	"strings"
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
	return limaError(UnrecognizedLine, number, fmt.Sprintf(`Lima: unrecognised line at line %d: %q (an unquoted key has letters, digits, "_", "-" and ":" only; quote any other)`, number, text))
}

func indentedLine(l sourceLine, inlineValue string) error {
	content := strings.TrimLeftFunc(l.text, isTrimWhitespace)
	return limaError(InvalidIndentation, l.number, fmt.Sprintf("Lima: unexpected indentation at line %d: %q%s", l.number, content, yamlHint(inlineValue)))
}

// unrecognizedHint is what a reader likely meant by an unrecognised line.
func unrecognizedHint(text string) string {
	if text == "---" || text == "..." {
		return " (a YAML document marker; Lima has one document)"
	}
	if text == "-" || strings.HasPrefix(text, "- ") {
		return " (a sequence item is indented under its key)"
	}
	if strings.HasPrefix(text, `"`) || strings.HasPrefix(text, "'") {
		return " (a quoted key closes on its own line)"
	}
	// `author Odile`, `key:value`: key characters, but no ": " after them
	first, _, _ := strings.Cut(text, " ")
	keyChars := first != ""
	for i := 0; i < len(first); i++ {
		b := first[i]
		alnum := b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == '_'
		if !alnum && !(i > 0 && (b == ':' || b == '-')) {
			keyChars = false
			break
		}
	}
	if !strings.Contains(text, ":") || keyChars {
		return ` (a key needs ": " after it)`
	}
	return ` (an unquoted key has letters, digits, "_", "-" and ":" only; quote any other)`
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
