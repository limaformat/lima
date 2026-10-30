use crate::unicode_key_table::UNICODE_KEY_RANGES;

#[inline(always)]
fn category(code_point: u32) -> u32 {
    let mut low = 0usize;
    let mut high = UNICODE_KEY_RANGES.len() / 3;
    while low < high {
        let mid = (low + high) / 2;
        let offset = mid * 3;
        if code_point < UNICODE_KEY_RANGES[offset] {
            high = mid;
        } else if code_point > UNICODE_KEY_RANGES[offset + 1] {
            low = mid + 1;
        } else {
            return UNICODE_KEY_RANGES[offset + 2];
        }
    }
    0
}

#[inline(always)]
pub(crate) fn is_initial(c: char) -> bool {
    if c.is_ascii() {
        c.is_ascii_alphanumeric() || c == '_'
    } else {
        category(c as u32) & 5 != 0
    }
}

#[inline(always)]
pub(crate) fn is_character(c: char) -> bool {
    if c.is_ascii() {
        is_initial(c) || matches!(c, ':' | '-' | '*')
    } else {
        c == '·' || category(c as u32) != 0
    }
}

#[inline(always)]
pub(crate) fn is_valid_unquoted(raw: &str, allow_slash: bool) -> bool {
    let bytes = raw.as_bytes();
    let Some(&first) = bytes.first() else {
        return false;
    };
    let mut i = if first.is_ascii() {
        if !(first.is_ascii_alphanumeric() || first == b'_') {
            return false;
        }
        let mut non_ascii = None;
        for (offset, &b) in bytes[1..].iter().enumerate() {
            if !b.is_ascii() {
                non_ascii = Some(offset + 1);
                break;
            }
            if !(b.is_ascii_alphanumeric()
                || matches!(b, b'_' | b':' | b'-' | b'*')
                || allow_slash && b == b'/')
            {
                return false;
            }
        }
        let Some(offset) = non_ascii else {
            return true;
        };
        offset
    } else {
        let c = raw.chars().next().unwrap();
        if !is_initial(c) {
            return false;
        }
        c.len_utf8()
    };
    while i < bytes.len() {
        if bytes[i].is_ascii() {
            let b = bytes[i];
            if !(b.is_ascii_alphanumeric()
                || matches!(b, b'_' | b':' | b'-' | b'*')
                || allow_slash && b == b'/')
            {
                return false;
            }
            i += 1;
        } else {
            let c = raw[i..].chars().next().unwrap();
            if !(is_character(c) || allow_slash && c == '/') {
                return false;
            }
            i += c.len_utf8();
        }
    }
    true
}
