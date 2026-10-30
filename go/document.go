package lima

import (
	"strconv"
	"unicode/utf8"
)

// validateDocument enforces Core §1 before options, partials, or parsing.
func validateDocument(input string) error {
	if utf8.ValidString(input) {
		return nil
	}
	line := 1
	for i := 0; i < len(input); {
		if input[i] == '\n' {
			line++
			i++
			continue
		}
		_, size := utf8.DecodeRuneInString(input[i:])
		if size == 1 && input[i] >= utf8.RuneSelf {
			return &LimaError{
				Code: InvalidDocument, Line: line,
				Message: "Lima: document contains an invalid Unicode scalar value at line " + strconv.Itoa(line),
			}
		}
		i += size
	}
	panic("utf8.ValidString reported invalid input without an invalid byte")
}
