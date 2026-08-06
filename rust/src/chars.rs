//! Mirrors `js/src/chars.ts`.

/// Exact ECMAScript WhiteSpace + LineTerminator set, one code point at a
/// time. Not the same set as Rust's `char::is_whitespace()` — notably
/// U+FEFF (BOM) is WhiteSpace here (matching JS) but not in Unicode's
/// `White_Space` property.
pub fn is_trim_whitespace(c: char) -> bool {
    matches!(
        c as u32,
        0x0009 | 0x000a..=0x000d | 0x0020 | 0x00a0 | 0x1680 | 0x2000..=0x200a
            | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff
    )
}
