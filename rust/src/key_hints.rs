use crate::chars::is_trim_whitespace;
use crate::unicode_key::is_valid_unquoted;

pub(crate) const KEY_GRAMMAR_HINT: &str = " (an unquoted key starts with a Unicode letter or number or \"_\", then has letters, marks, numbers, \"_\", \":\", \"-\", \"*\" and \"·\"; quote any other)";

pub(crate) fn specific_key_hint(text: &str) -> Option<String> {
    let without_spaces = text.trim_start_matches(' ');
    if let Some(c) = without_spaces.chars().next() {
        if c != ' ' && is_trim_whitespace(c) {
            return Some(format!(
                " (U+{:04X} before the key; Lima indents by spaces only)",
                c as u32
            ));
        }
    }
    if let Some(colon) = text.find('：') {
        if colon > 0 && is_valid_unquoted(&text[..colon], false) {
            return Some(" (the key-value separator is \": \" (U+003A and a space), not U+FF1A FULLWIDTH COLON)".into());
        }
    }
    None
}
