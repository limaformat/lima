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
    // Appendix E: what YAML front matter writes in a key, and what Lima
    // writes instead
    let key = key_candidate(without_spaces)?;
    if key == "<<" {
        return Some(" (a YAML merge key; Lima has no merge keys)".into());
    }
    let all_keys = |parts: &[&str]| parts.iter().all(|part| is_valid_unquoted(part, false));
    let words: Vec<&str> = key.split(' ').collect();
    if words.len() > 1 && all_keys(&words) {
        return Some(format!(" (quote a key that holds spaces: '{key}':)"));
    }
    let parts: Vec<&str> = key.split('.').collect();
    if parts.len() > 1 && all_keys(&parts) {
        let (outer, inner) = (parts[0], parts[1]);
        return Some(format!(
            " (Lima nests by indentation: \"{outer}:\", and \"{inner}:\" below it)"
        ));
    }
    None
}

/// The key a line that is no entry seems to hold: the text before its first
/// colon that a space or a tab follows, or before the colon that ends it
/// (§5.1). Mirrors `js/src/key-hints.ts`'s `keyCandidate`.
fn key_candidate(text: &str) -> Option<&str> {
    let b = text.as_bytes();
    let separates = |i: usize| matches!(b.get(i + 1), None | Some(b' ' | b'\t'));
    let colon = (0..b.len()).find(|&i| b[i] == b':' && separates(i))?;
    Some(&text[..colon])
}
