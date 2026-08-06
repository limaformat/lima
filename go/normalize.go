package lima

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	documentSizeLimit = 65536
	keyLengthLimit    = 128
	topLevelKeyLimit  = 128
	nestingDepthLimit = 16
	scalarLengthLimit = 16384
)

func checkKeyLength(key string, line int) error {
	if utf8.RuneCountInString(key) > keyLengthLimit {
		return limaError(ResourceLimit, line, fmt.Sprintf("Lima: key %q exceeds maximum length of %d code points at line %d", key, keyLengthLimit, line))
	}
	return nil
}
func checkDuplicate(exists bool, key string, line int, strict bool) error {
	if exists && strict {
		e := limaError(DuplicateKey, line, fmt.Sprintf("Lima: duplicate key %q at line %d — last value wins", key, line))
		e.Key = key
		return e
	}
	return nil
}
func checkStringLimit(s string, line int) error {
	if utf8.RuneCountInString(s) > scalarLengthLimit {
		return limaError(ResourceLimit, line, fmt.Sprintf("Lima: scalar exceeds maximum length of %d code points at line %d", scalarLengthLimit, line))
	}
	return nil
}

func isTrimWhitespace(r rune) bool {
	return r == 0x9 || (r >= 0xa && r <= 0xd) || r == 0x20 || r == 0xa0 || r == 0x1680 || (r >= 0x2000 && r <= 0x200a) || r == 0x2028 || r == 0x2029 || r == 0x202f || r == 0x205f || r == 0x3000 || r == 0xfeff
}

func trimWhitespace(s string) string     { return strings.TrimFunc(s, isTrimWhitespace) }
func trimLeftWhitespace(s string) string { return strings.TrimLeftFunc(s, isTrimWhitespace) }
