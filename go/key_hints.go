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
	// Appendix E: what YAML front matter writes in a key, and what Lima
	// writes instead
	key, ok := keyCandidate(withoutSpaces)
	if !ok {
		return ""
	}
	if key == "<<" {
		return " (a YAML merge key; Lima has no merge keys)"
	}
	if words := strings.Split(key, " "); len(words) > 1 && allValidKeys(words) {
		return fmt.Sprintf(" (quote a key that holds spaces: '%s':)", key)
	}
	if parts := strings.Split(key, "."); len(parts) > 1 && allValidKeys(parts) {
		return fmt.Sprintf(` (Lima nests by indentation: "%s:", and "%s:" below it)`, parts[0], parts[1])
	}
	return ""
}

// keyCandidate is the key a line that is no entry seems to hold: the text
// before its first colon that a space or a tab follows, or before the colon
// that ends it (§5.1). Mirrors js keyCandidate.
func keyCandidate(text string) (string, bool) {
	for i := 0; i < len(text); i++ {
		if text[i] != ':' {
			continue
		}
		if i+1 == len(text) || text[i+1] == ' ' || text[i+1] == '\t' {
			return text[:i], true
		}
	}
	return "", false
}

func allValidKeys(keys []string) bool {
	for _, k := range keys {
		if !isValidUnquotedKey(k, false) {
			return false
		}
	}
	return true
}
