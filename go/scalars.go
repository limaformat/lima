package lima

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

func pv(v Value, line int) *pvalue { return &pvalue{value: v, line: line} }
func pstr(s string, line int, quoted bool) *pvalue {
	return &pvalue{value: String(s), line: line, quoted: quoted}
}

func parseDateUTC(s string, strict bool, line int) (*Instant, error) {
	invalid := func() (*Instant, error) {
		if strict {
			return nil, limaError(InvalidDate, line, fmt.Sprintf("Lima: invalid date %q at line %d", s, line))
		}
		return nil, nil
	}
	date, timePart := s, ""
	separator := byte(0)
	if i := strings.IndexAny(s, "T "); i >= 0 {
		separator = s[i]
		date, timePart = s[:i], s[i+1:]
	}
	var y, mo, d int64
	shape := false
	if len(date) == 10 && date[4] == '-' && date[7] == '-' && digitsOnly(date[:4]) && digitsOnly(date[5:7]) && digitsOnly(date[8:]) {
		y, _ = strconv.ParseInt(date[:4], 10, 64)
		mo, _ = strconv.ParseInt(date[5:7], 10, 64)
		d, _ = strconv.ParseInt(date[8:], 10, 64)
		shape = true
	} else if p := strings.Split(date, "/"); len(p) == 3 && len(p[0]) == 4 && digitsOnly(p[0]) && digitsOnly(p[1]) && digitsOnly(p[2]) {
		y, _ = strconv.ParseInt(p[0], 10, 64)
		mo, _ = strconv.ParseInt(p[1], 10, 64)
		d, _ = strconv.ParseInt(p[2], 10, 64)
		shape = true
	} else if p := strings.Split(date, "."); len(p) == 3 && len(p[2]) == 4 && digitsOnly(p[0]) && digitsOnly(p[1]) && digitsOnly(p[2]) {
		d, _ = strconv.ParseInt(p[0], 10, 64)
		mo, _ = strconv.ParseInt(p[1], 10, 64)
		y, _ = strconv.ParseInt(p[2], 10, 64)
		shape = true
	}
	if !shape {
		return nil, nil
	}
	// ISO datetimes require T; the space form is only valid for the German
	// and slash date grammars.
	if separator == ' ' && len(date) == 10 && date[4] == '-' {
		return nil, nil
	}
	var h, mi, sec, offset int64
	if timePart != "" {
		if strings.HasSuffix(timePart, "Z") {
			timePart = strings.TrimSuffix(timePart, "Z")
		} else if len(timePart) >= 6 {
			i := len(timePart) - 6
			if (timePart[i] == '+' || timePart[i] == '-') && timePart[i+3] == ':' {
				oh, e1 := strconv.ParseInt(timePart[i+1:i+3], 10, 64)
				om, e2 := strconv.ParseInt(timePart[i+4:], 10, 64)
				if e1 != nil || e2 != nil || oh > 14 || om > 59 || (oh == 14 && om != 0) {
					return invalid()
				}
				offset = oh*60 + om
				if timePart[i] == '-' {
					offset = -offset
				}
				timePart = timePart[:i]
			}
		}
		parts := strings.Split(timePart, ":")
		if len(parts) < 2 || len(parts) > 3 || len(parts[0]) != 2 || len(parts[1]) != 2 {
			return nil, nil
		}
		var err error
		h, err = strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			return nil, nil
		}
		mi, err = strconv.ParseInt(parts[1], 10, 64)
		if err != nil {
			return nil, nil
		}
		if len(parts) == 3 {
			if len(parts[2]) != 2 {
				return nil, nil
			}
			sec, err = strconv.ParseInt(parts[2], 10, 64)
			if err != nil {
				return nil, nil
			}
		}
	}
	leap := y%400 == 0 || (y%4 == 0 && y%100 != 0)
	md := []int64{31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}
	if leap {
		md[1] = 29
	}
	if y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > md[mo-1] || h > 23 || mi > 59 || sec > 59 {
		return invalid()
	}
	i := Instant{EpochSeconds: daysFromCivil(y, int(mo), int(d))*86400 + h*3600 + mi*60 + sec - offset*60}
	ry, _, _ := civilFromDays(floorDiv(i.EpochSeconds, 86400))
	if ry < 1 || ry > 9999 {
		return invalid()
	}
	return &i, nil
}
func floorDiv(a, b int64) int64 { q, _ := divModFloor(a, b); return q }
func digitsOnly(s string) bool {
	if s == "" {
		return false
	}
	for i := range len(s) {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

func numberGrammar(s string) bool {
	if s == "" {
		return false
	}
	i := 0
	if s[0] == '-' {
		i++
		if i == len(s) {
			return false
		}
	}
	if i < len(s) && s[i] == '0' {
		i++
	} else if i < len(s) && s[i] >= '1' && s[i] <= '9' {
		for i < len(s) && s[i] >= '0' && s[i] <= '9' {
			i++
		}
	} else if i >= len(s) || s[i] != '.' {
		return false
	}
	if i < len(s) && s[i] == '.' {
		i++
		start := i
		for i < len(s) && s[i] >= '0' && s[i] <= '9' {
			i++
		}
		if i == start {
			return false
		}
	}
	if i < len(s) && (s[i] == 'e' || s[i] == 'E') {
		i++
		if i < len(s) && (s[i] == '+' || s[i] == '-') {
			i++
		}
		start := i
		for i < len(s) && s[i] >= '0' && s[i] <= '9' {
			i++
		}
		if i == start {
			return false
		}
	}
	return i == len(s)
}
func zeroLiteral(s string) bool {
	s = strings.TrimPrefix(s, "-")
	if i := strings.IndexAny(s, "eE"); i >= 0 {
		s = s[:i]
	}
	s = strings.ReplaceAll(s, ".", "")
	return s != "" && strings.Trim(s, "0") == ""
}

func buildTyped(s string, strict bool, line int) (*pvalue, error) {
	switch s {
	case "", "null", "~":
		return pv(Null{}, line), nil
	case "true":
		return pv(Bool(true), line), nil
	case "false":
		return pv(Bool(false), line), nil
	}
	if len(s) > 2 && s[0] == '0' && strings.ContainsRune("xXoObB", rune(s[1])) {
		if e := checkStringLimit(s, line); e != nil {
			return nil, e
		}
		return pstr(s, line, false), nil
	}
	if numberGrammar(s) {
		if strings.ContainsAny(s, ".eE") {
			n, _ := strconv.ParseFloat(s, 64)
			if !math.IsNaN(n) {
				if math.IsInf(n, 0) {
					if strict {
						return nil, limaError(InvalidNumber, line, fmt.Sprintf("Lima: float value overflows to a non-finite value at line %d: %q", line, s))
					}
				} else if n == 0 && !zeroLiteral(s) {
					if strict {
						return nil, limaError(InvalidNumber, line, fmt.Sprintf("Lima: non-zero float value underflows to zero at line %d: %q", line, s))
					}
				} else {
					if n == 0 {
						n = 0
					}
					return pv(Float64(n), line), nil
				}
			}
		} else if n, e := strconv.ParseInt(s, 10, 64); e == nil && n >= -9007199254740991 && n <= 9007199254740991 {
			return pv(Int64(n), line), nil
		}
	}
	if !strings.Contains(s, "@") {
		if d, e := parseDateUTC(s, strict, line); e != nil {
			return nil, e
		} else if d != nil {
			return pv(*d, line), nil
		}
	}
	if e := checkStringLimit(s, line); e != nil {
		return nil, e
	}
	return pstr(s, line, false), nil
}

func unescapeDQ(s string, strict bool, line int) (string, error) {
	var b strings.Builder
	rr := []rune(s)
	for i := 0; i < len(rr); i++ {
		if rr[i] != '\\' || i+1 >= len(rr) {
			b.WriteRune(rr[i])
			continue
		}
		k := rr[i+1]
		n := 1
		hexN := 0
		if k == 'u' {
			hexN = 4
		} else if k == 'U' {
			hexN = 8
		} else if k == 'x' {
			hexN = 2
		}
		token := string(k)
		if hexN > 0 {
			j := i + 2
			for j < len(rr) && j < i+2+hexN && strings.ContainsRune("0123456789abcdefABCDEF", rr[j]) {
				j++
			}
			token = string(rr[i+1 : j])
			n = j - i - 1
		}
		valid := strings.ContainsRune("\"\\/bfnrt", k) && len([]rune(token)) == 1
		var cp int64
		if hexN > 0 && len([]rune(token)) == hexN+1 {
			cp, _ = strconv.ParseInt(token[1:], 16, 32)
			valid = !(k == 'u' && cp >= 0xd800 && cp <= 0xdfff) && cp <= 0x10ffff
		}
		if !valid {
			if strict {
				return "", limaError(InvalidEscape, line, fmt.Sprintf("Lima: unknown escape sequence %q at line %d", "\\"+token, line))
			}
			b.WriteRune('\\')
			b.WriteString(token)
			i += n
			continue
		}
		switch k {
		case '"', '\\', '/':
			b.WriteRune(k)
		case 'b':
			b.WriteByte(8)
		case 'f':
			b.WriteByte(12)
		case 'n':
			b.WriteByte('\n')
		case 'r':
			b.WriteByte('\r')
		case 't':
			b.WriteByte('\t')
		default:
			b.WriteRune(rune(cp))
		}
		i += n
	}
	return b.String(), nil
}
func stripKeyQuotes(s string) string {
	if len(s) >= 2 && s[0] == '\'' && s[len(s)-1] == '\'' {
		return s[1 : len(s)-1]
	}
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		v, _ := unescapeDQ(s[1:len(s)-1], false, 0)
		return v
	}
	return s
}
func stripComment(s string) string {
	q := byte(0)
	esc := false
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
		} else if c == '\\' && i+1 < len(s) && s[i+1] == '#' {
			i++
		} else if c == '#' {
			return strings.ReplaceAll(strings.TrimRight(s[:i], " \t"), "\\#", "#")
		}
	}
	return strings.ReplaceAll(s, "\\#", "#")
}
func parseScalar(raw string, strict bool, line int, top bool) (*pvalue, error) {
	if len(raw) > 0 && (raw[0] == '"' || raw[0] == '\'') {
		q := raw[0]
		if raw[len(raw)-1] == q {
			inner := raw[1 : len(raw)-1]
			var v string
			var e error
			if q == '"' {
				v, e = unescapeDQ(inner, strict, line)
			} else {
				v = strings.ReplaceAll(inner, "\\'", "'")
			}
			if e != nil {
				return nil, e
			}
			if e = checkStringLimit(v, line); e != nil {
				return nil, e
			}
			return pstr(v, line, true), nil
		}
		if top && strict {
			return nil, limaError(InvalidQuote, line, fmt.Sprintf("Lima: non-whitespace content after closing quote at line %d", line))
		}
	}
	if utf8.RuneCountInString(raw) > scalarLengthLimit {
		return nil, checkStringLimit(raw, line)
	}
	return buildTyped(raw, strict, line)
}
