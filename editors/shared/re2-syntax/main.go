// Command re2-syntax reads a JSON array of regular expressions on standard
// input and writes a JSON array with, for each, the error RE2 syntax gives
// it, or null where RE2 accepts it. Go's regexp/syntax parses RE2 syntax and
// rejects lookarounds, backreferences, atomic groups and possessive
// quantifiers. re2-syntax.test.ts runs it over every editor grammar pattern.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp/syntax"
)

func main() {
	var patterns []string
	if err := json.NewDecoder(os.Stdin).Decode(&patterns); err != nil {
		fmt.Fprintln(os.Stderr, "re2-syntax: expected a JSON array of strings on standard input:", err)
		os.Exit(2)
	}
	errors := make([]*string, len(patterns))
	for i, pattern := range patterns {
		if _, err := syntax.Parse(pattern, syntax.Perl); err != nil {
			message := err.Error()
			errors[i] = &message
		}
	}
	if err := json.NewEncoder(os.Stdout).Encode(errors); err != nil {
		fmt.Fprintln(os.Stderr, "re2-syntax:", err)
		os.Exit(1)
	}
}
