package lima

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const keyGrammarHint = ` (an unquoted key starts with a Unicode letter or number or "_", then has letters, marks, numbers, "_", ":", "-", "*" and "·"; quote any other)`

func specificKeyHint(text string) string {
	withoutSpaces := strings.TrimLeft(text, " ")
	if withoutSpaces != "" {
		r, _ := utf8.DecodeRuneInString(withoutSpaces)
		if r != ' ' && isTrimWhitespace(r) {
			return fmt.Sprintf(" (U+%04X before the key; Lima indents by spaces only)", r)
		}
	}
	if colon := strings.IndexRune(text, '：'); colon > 0 && isValidUnquotedKey(text[:colon], false) {
		return ` (the key-value separator is ": " (U+003A and a space), not U+FF1A FULLWIDTH COLON)`
	}
	return ""
}
