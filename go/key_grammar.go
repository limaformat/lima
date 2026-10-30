package lima

import "unicode/utf8"

func isASCIIKeyInitial(b byte) bool {
	return b == '_' || b >= '0' && b <= '9' || b >= 'A' && b <= 'Z' || b >= 'a' && b <= 'z'
}

func isASCIIKeyCharacter(b byte) bool {
	return isASCIIKeyInitial(b) || b == ':' || b == '-' || b == '*'
}

func unicodeKeyCategory(codePoint rune) uint32 {
	low, high := 0, len(unicodeKeyRanges)/3
	for low < high {
		mid := (low + high) / 2
		offset := mid * 3
		if uint32(codePoint) < unicodeKeyRanges[offset] {
			high = mid
		} else if uint32(codePoint) > unicodeKeyRanges[offset+1] {
			low = mid + 1
		} else {
			return unicodeKeyRanges[offset+2]
		}
	}
	return 0
}

func isKeyInitial(r rune) bool {
	if r <= 0x7f {
		return isASCIIKeyInitial(byte(r))
	}
	return unicodeKeyCategory(r)&5 != 0
}

func isKeyCharacter(r rune) bool {
	if r <= 0x7f {
		return isASCIIKeyCharacter(byte(r))
	}
	return r == '·' || unicodeKeyCategory(r) != 0
}

func isValidUnquotedKey(raw string, allowSlash bool) bool {
	if raw == "" {
		return false
	}
	i := 0
	if raw[0] < utf8.RuneSelf {
		if !isASCIIKeyInitial(raw[0]) {
			return false
		}
		i = 1
	} else {
		r, size := utf8.DecodeRuneInString(raw)
		if r == utf8.RuneError && size == 1 || !isKeyInitial(r) {
			return false
		}
		i = size
	}
	for i < len(raw) {
		if raw[i] < utf8.RuneSelf {
			b := raw[i]
			if !(isASCIIKeyCharacter(b) || allowSlash && b == '/') {
				return false
			}
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(raw[i:])
		if r == utf8.RuneError && size == 1 || !(isKeyCharacter(r) || allowSlash && r == '/') {
			return false
		}
		i += size
	}
	return true
}
