//! Core 1.1 §4, §7.1 rule 5 and §10.1: in strict mode every content line
//! belongs to the structure — mirrors `js/src/structure.ts`. Between two
//! top-level keys (and before the first), a line that is neither blank nor a
//! comment is
//!
//! - unrecognised (`UnrecognizedLine`) when it starts at column 0: it
//!   matches no key pattern, or the top-level scan would have ended the
//!   range at it;
//! - inconsistently indented (`InvalidIndentation`) when it is indented and
//!   the range belongs to no block: before the first key, or after a key
//!   with an inline value other than `|`, which opens no block.
//!
//! The indented lines under a block value or a `|` scalar are its own and
//! are checked where they are parsed. Non-strict mode skips all of these
//! lines, as Core 1.0 did in both modes.

use crate::chars::is_trim_whitespace;
use crate::errors::{LimaDiagnosticCode as Code, LimaError};

/// Whether the lines after a key belong to it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum RangeOwner {
    /// Before the first key: no key owns the lines.
    None,
    /// After a key with an inline value other than `|`: it opens no block.
    Inline,
    /// After a key with a nested block or a `|` scalar: the indented lines are its own.
    Block,
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
    while pos < end {
        let line_end = source[pos..end].find('\n').map(|p| pos + p);
        let text = &source[pos..line_end.unwrap_or(end)];
        // blank and comment lines by Lima's own whitespace; indentation by
        // ASCII space only (§3 expanded the tabs)
        let content = text.trim_start_matches(is_trim_whitespace);
        if !content.is_empty() && !content.starts_with('#') {
            if !text.starts_with(' ') {
                return Err(LimaError::new(
                    Code::UnrecognizedLine,
                    current,
                    format!(
                        "Lima: unrecognised line at line {current}: \"{text}\"{}",
                        hint(text)
                    ),
                ));
            }
            if owner != RangeOwner::Block {
                return Err(LimaError::new(
                    Code::InvalidIndentation,
                    current,
                    format!(
                        "Lima: unexpected indentation at line {current}: \"{content}\"{}",
                        yaml_hint(inline_value)
                    ),
                ));
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
