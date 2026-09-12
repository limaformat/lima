package lima

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

const partialCountLimit = 128
const partialNodeLimit = 4096
const resultNodeLimit = 65536

func validatePartial(v Value, name, path string, depth int) (int, error) {
	bad := func(reason string) (int, error) {
		return 0, &LimaError{Code: InvalidPartial, Partial: name, Path: path, Message: fmt.Sprintf("Lima: invalid partial %q at path %q: %s", name, path, reason)}
	}
	switch x := v.(type) {
	case Float64:
		if math.IsNaN(float64(x)) || math.IsInf(float64(x), 0) {
			return bad("non-finite number")
		}
	case String:
		if utf8.RuneCountInString(string(x)) > scalarLengthLimit {
			return bad("string exceeds maximum length")
		}
	case Instant:
		y, _, _ := civilFromDays(floorDiv(x.EpochSeconds, 86400))
		if y < 1 || y > 9999 {
			return bad("date outside supported range")
		}
	case Array:
		if depth >= 16 {
			return bad("nesting depth exceeds maximum")
		}
		nodes := 1
		for i, z := range x {
			if _, ok := z.(Array); ok {
				return 0, &LimaError{Code: InvalidPartial, Partial: name, Path: fmt.Sprintf("%s[%d]", path, i), Message: "Lima: nested arrays are not supported"}
			}
			n, e := validatePartial(z, name, fmt.Sprintf("%s[%d]", path, i), depth+1)
			if e != nil {
				return 0, e
			}
			nodes += n
		}
		return nodes, nil
	case Map:
		if depth >= 16 {
			return bad("nesting depth exceeds maximum")
		}
		nodes := 1
		for _, z := range x {
			p := path + "." + z.Key
			if utf8.RuneCountInString(z.Key) > 128 {
				return 0, &LimaError{Code: InvalidPartial, Partial: name, Path: p, Message: "Lima: partial mapping key exceeds maximum length"}
			}
			n, e := validatePartial(z.Value, name, p, depth+1)
			if e != nil {
				return 0, e
			}
			nodes += n
		}
		return nodes, nil
	}
	return 1, nil
}

func fromValue(v Value, line int) *pvalue {
	switch x := v.(type) {
	case Array:
		a := make([]*pvalue, len(x))
		for i, z := range x {
			a[i] = fromValue(z, line)
		}
		return &pvalue{line: line, array: a}
	case Map:
		m := make([]pentry, len(x))
		for i, z := range x {
			m[i] = pentry{z.Key, fromValue(z.Value, line)}
		}
		return &pvalue{line: line, mapping: m}
	case String:
		return pstr(string(x), line, true, false, nil)
	default:
		return pv(v, line)
	}
}
func canonical(v Value) string {
	switch x := v.(type) {
	case Null:
		return ""
	case Bool:
		if x {
			return "true"
		}
		return "false"
	case Int64:
		return strconv.FormatInt(int64(x), 10)
	case Float64:
		n := float64(x)
		a := math.Abs(n)
		f := 'f'
		if a != 0 && (a < 1e-6 || a >= 1e21) {
			f = 'e'
		}
		s := strconv.FormatFloat(n, byte(f), -1, 64)
		if f == 'e' {
			a := strings.Split(s, "e")
			exp := a[1]
			sign := ""
			if strings.HasPrefix(exp, "-") {
				sign = "-"
				exp = exp[1:]
			} else {
				exp = strings.TrimPrefix(exp, "+")
			}
			exp = strings.TrimLeft(exp, "0")
			if exp == "" {
				exp = "0"
			}
			s = a[0] + "e" + sign + exp
		}
		return s
	case String:
		return string(x)
	case Instant:
		return x.ISOString()
	}
	return ""
}
