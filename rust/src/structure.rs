//! Core 1.1 §4, §7.1 rule 5 and §10.1: in strict mode every content line
//! belongs to the structure — mirrors `js/src/structure.ts`. Between two
//! top-level keys (and before the first), a line that is neither blank nor a
//! comment is
//!
//! - unrecognised (`UnrecognizedLine`) when it starts at column 0: it
//!   matches no key pattern, or the top-level scan would have ended the
//!   range at it. A sequence that starts at column 0 under a bare key is that
//!   key's (Core 1.1 §7.2), up to the first line at column 0 that is no item.
//! - inconsistently indented (`InvalidIndentation`) when it is indented and
//!   no block owns it: before the first key; after a key with an inline
//!   value other than `|`, which opens no block; under a block mapping but
//!   less indented than its first line (its base indentation, §7.1 rule 1),
//!   where the block parser stops; or after a `|` scalar that a line at
//!   column 0 ended (§6.1.5).
//!
//! The lines a block mapping or a `|` scalar owns are checked where they are
//! parsed. Non-strict mode skips all of these lines, as Core 1.0 did in both
//! modes.

use crate::chars::is_trim_whitespace;
use crate::errors::{LimaDiagnosticCode as Code, LimaError};

/// What the lines after a key belong to.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum RangeOwner {
    /// Before the first key: nothing.
    None,
    /// After a key with an inline value other than `|`: nothing, it opens no block.
    Inline,
    /// After a bare key: a block mapping or sequence from its base indentation on.
    Mapping,
    /// After a `|` marker: a scalar, up to the first non-empty line at column 0.
    Scalar,
}

/// Checks the lines of `source` from `start` (a line start) to `end` that
/// follow a key owned as `owner`; `line` is the 1-based line at `start`, and
/// `inline_value` the value of that key, for the hint a YAML marker earns.
/// Returns the first line that belongs to no structure as an error.
pub(crate) fn check_range_lines(
    source: &str,
    start: usize,
    end: usize,
    line: u32,
    owner: RangeOwner,
    inline_value: &str,
) -> Result<(), LimaError> {
    let mut pos = start;
    let mut current = line;
    // a block mapping's base indentation, once its first content line set it
    let mut base: Option<usize> = None;
    let mut scalar_open = owner == RangeOwner::Scalar;
    while pos < end {
        let line_end = source[pos..end].find('\n').map(|p| pos + p);
        let text = &source[pos..line_end.unwrap_or(end)];
        let indent = text.bytes().take_while(|&b| b == b' ').count();
        // §6.1.5: a `|` scalar holds every line up to the first non-empty
        // one at its key's column (0), `#` included
        let belongs_to_scalar = scalar_open && (indent == text.len() || indent > 0);
        if !belongs_to_scalar {
            scalar_open = false;
            // blank and comment lines by Lima's own whitespace; indentation
            // by ASCII space only (§3 expanded the tabs)
            let content = text.trim_start_matches(is_trim_whitespace);
            if !content.is_empty() && !content.starts_with('#') {
                // §7.2: a bare key's sequence may start at its own column, 0
                // here; it ends at the first line there that is no item
                let item = indent == 0 && is_item(text);
                if owner == RangeOwner::Mapping && base.is_none() && item {
                    base = Some(0);
                }
                if indent == 0 && !(base == Some(0) && item) {
                    return Err(LimaError::new(
                        Code::UnrecognizedLine,
                        current,
                        format!(
                            "Lima: unrecognised line at line {current}: \"{text}\"{}",
                            hint(text)
                        ),
                    ));
                }
                if owner == RangeOwner::Mapping && base.is_none() {
                    base = Some(indent);
                }
                if indent > 0
                    && !(owner == RangeOwner::Mapping && base.is_some_and(|b| indent >= b))
                {
                    let marker = if owner == RangeOwner::Inline {
                        yaml_hint(inline_value)
                    } else {
                        String::new()
                    };
                    return Err(LimaError::new(
                        Code::InvalidIndentation,
                        current,
                        format!(
                            "Lima: unexpected indentation at line {current}: \"{content}\"{marker}"
                        ),
                    ));
                }
            }
        }
        match line_end {
            Some(e) => {
                pos = e + 1;
                current += 1;
            }
            None => break,
        }
    }
    Ok(())
}

/// What a reader likely meant by an unrecognised line, as a hint after the message.
fn hint(text: &str) -> &'static str {
    if text == "---" || text == "..." {
        return " (a YAML document marker; Lima has one document)";
    }
    if is_item(text) {
        return " (a sequence item belongs to a key with no value of its own)";
    }
    if text.starts_with('"') || text.starts_with('\'') {
        return " (a quoted key closes on its own line)";
    }
    // `author Odile`, `key:value`: key characters, but no ": " after them
    let first_word = text.split(' ').next().unwrap_or("");
    let key_chars = first_word.bytes().enumerate().all(|(i, b)| {
        b.is_ascii_alphanumeric() || b == b'_' || (i > 0 && (b == b':' || b == b'-'))
    });
    if !text.contains(':') || (!first_word.is_empty() && key_chars) {
        return " (a key needs \": \" after it)";
    }
    " (an unquoted key has letters, digits, \"_\", \"-\" and \":\" only; quote any other)"
}

/// The hint a YAML block scalar marker in place of a value earns.
fn yaml_hint(value: &str) -> String {
    match value {
        ">" | ">-" | ">+" => {
            format!(" (\"{value}\" is YAML's folded scalar; Lima writes \"|\" and continues a line with \"^^\")")
        }
        "|-" | "|+" => format!(" (\"{value}\" is a YAML chomping indicator; Lima writes \"|\")"),
        _ => String::new(),
    }
}

/// §7.2: `-` alone or `-` followed by whitespace begins a sequence item (Core 1.1); `---` or `-x` does not.
fn is_item(text: &str) -> bool {
    text.strip_prefix('-')
        .is_some_and(|rest| rest.is_empty() || rest.starts_with(is_trim_whitespace))
}
