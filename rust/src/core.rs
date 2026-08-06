//! Public entry point — orchestrates `block`/`flow`/`scalars` into a full
//! document parse. Mirrors `js/src/core.ts`'s top-level scan (find `key:`/
//! `key: value` lines at column 0; everything else — including a strict-mode
//! non-key line — is silently skipped, per Core §10.1's closed strict-error
//! list) plus its `|` literal block-scalar merging. `block::parse_block_range`
//! is used only for a bare `key:`'s nested content, exactly as in the TS
//! source, not for the top level itself.
//!
//! Scoped down from `js/src/core.ts` for this pass:
//! - No `scanner.ts`/`KeyCursor` fast path — pure performance optimization,
//!   no behavioral difference from the linear scan below.
//!
//! `NESTING_DEPTH_LIMIT` *is* enforced here as a hard error (§9), gated by
//! `block.rs`'s cheap conservative "may exceed" risk flag so the common
//! case never pays for a full tree walk just to find depth 0.

use crate::block::parse_block_range;
use crate::chars::is_trim_whitespace;
use crate::errors::{LimaDiagnosticCode as Code, LimaError};
use crate::flow::parse_flow_or_scalar_value;
use crate::normalize::{
    check_duplicate_key, check_key_length, DOCUMENT_SIZE_LIMIT, NESTING_DEPTH_LIMIT,
    TOP_LEVEL_KEY_LIMIT,
};
use crate::scalars::{check_string_limit, strip_comment, strip_key_quotes};
use crate::value::{Builder, LimaValue, PlainBuilder, PositionedBuilder, PositionedValue};

/// One discovered top-level `key:`/`key: value` line.
struct TopKey {
    line: u32,
    /// Byte offset of this key's own line start — the previous entry's span
    /// ends here (exclusive).
    key_start: usize,
    /// Byte offset where the value text begins: right after `": "` for an
    /// inline value, or right after this line's own newline for a bare
    /// `key:` (`is_block`).
    value_start: usize,
    is_block: bool,
    key: String,
}

/// Unlike `block.rs`'s `find_key_sep` (matched against block.ts's own
/// naive, non-escape-aware `findKeySep`, used only for nested content),
/// the top-level key scan needs to recognize an escaped quote inside a
/// double-quoted key (`"say \"hi\"": value`) — real Lima delegates this to
/// `scanner.ts`'s escape-aware key scanner, not `findKeySep`. Single-quoted
/// keys stay non-escape-aware, matching `SPACE_BEFORE_COLON_RE`'s own
/// asymmetric `[^']*` vs `(?:[^"\\]|\\.)*` treatment of the two quote kinds.
fn find_key_sep(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let first = *b.first()?;
    if first == b'\'' {
        let mut i = 1;
        while i < b.len() && b[i] != first {
            i += 1;
        }
        if b.get(i + 1) == Some(&b':') && b.get(i + 2) == Some(&b' ') {
            return Some(i + 1);
        }
        return None;
    }
    if first == b'"' {
        let mut i = 1;
        while i < b.len() && b[i] != b'"' {
            i += if b[i] == b'\\' && i + 1 < b.len() {
                2
            } else {
                1
            };
        }
        if b.get(i + 1) == Some(&b':') && b.get(i + 2) == Some(&b' ') {
            return Some(i + 1);
        }
        return None;
    }
    s.find(": ")
}

/// Finds every `key:`/`key: value` line starting at column 0 (no leading
/// whitespace). Any other line — blank, comment, indented, or matching no
/// key pattern at all — is simply never visited here, which is *why* it's
/// tolerated even in strict mode (Core §10.1's closed list has nothing to
/// say about text the top-level scan never looks at).
fn scan_top_keys(source: &str) -> Vec<TopKey> {
    let mut result = Vec::new();
    let bytes = source.as_bytes();
    let mut pos = 0usize;
    let mut line_no = 1u32;
    while pos <= bytes.len() {
        let line_end = source[pos..]
            .find('\n')
            .map(|p| pos + p)
            .unwrap_or(bytes.len());
        let line = &source[pos..line_end];
        if !line.is_empty() && !line.starts_with([' ', '\t', '#']) {
            if let Some(colon_pos) = find_key_sep(line) {
                let key = strip_key_quotes(&line[..colon_pos]);
                result.push(TopKey {
                    line: line_no,
                    key_start: pos,
                    value_start: pos + colon_pos + 2,
                    is_block: false,
                    key,
                });
            } else if let Some(key_part) = line.strip_suffix(':') {
                if !key_part.is_empty() {
                    let key = strip_key_quotes(key_part);
                    let value_start = if line_end < bytes.len() {
                        line_end + 1
                    } else {
                        line_end
                    };
                    result.push(TopKey {
                        line: line_no,
                        key_start: pos,
                        value_start,
                        is_block: true,
                        key,
                    });
                }
            }
        }
        if line_end >= bytes.len() {
            break;
        }
        pos = line_end + 1;
        line_no += 1;
    }
    result
}

/// Core §6.1.6: does this quoted-key line have whitespace between the
/// closing quote and the colon? (`"key" : value` — invalid in strict mode.)
/// Mirrors `SPACE_BEFORE_COLON_RE`. Not escape-aware for single quotes
/// (matches the TS regex's own `[^']*`); double-quoted strings do skip
/// `\X` pairs so an escaped `"` doesn't end the string early.
fn has_space_before_colon(line: &str) -> bool {
    let b = line.as_bytes();
    let Some(&quote) = b.first() else {
        return false;
    };
    if quote != b'\'' && quote != b'"' {
        return false;
    }
    let mut i = 1;
    if quote == b'\'' {
        while i < b.len() && b[i] != b'\'' {
            i += 1;
        }
    } else {
        while i < b.len() && b[i] != b'"' {
            i += if b[i] == b'\\' && i + 1 < b.len() {
                2
            } else {
                1
            };
        }
    }
    if i >= b.len() {
        return false;
    } // unterminated quote
    i += 1; // past the closing quote
    let ws_start = i;
    while i < b.len() && (b[i] == b' ' || b[i] == b'\t') {
        i += 1;
    }
    i > ws_start && b.get(i) == Some(&b':')
}

fn line_at(source: &str, byte_pos: usize) -> u32 {
    1 + source[..byte_pos].bytes().filter(|&c| c == b'\n').count() as u32
}

/// `|` literal block scalar body: dedent to the minimum common indentation
/// (ASCII-space-only, capped defensively at `key.len() + 2`), apply `^^`
/// continuation-line joining (one space, no marker on an empty line adds
/// nothing), strip trailing blank lines.
fn merge_block_scalar(body: &str, key: &str) -> String {
    let body_lines: Vec<&str> = body.split('\n').collect();

    let mut min_indent = usize::MAX;
    for line in &body_lines {
        let indent = line.len() - line.trim_start_matches(' ').len();
        if indent == line.len() {
            continue;
        } // blank
        min_indent = min_indent.min(indent);
    }
    min_indent = min_indent.min(key.chars().count() + 2);
    let trim_amt = if min_indent > 1 && min_indent != usize::MAX {
        min_indent
    } else {
        0
    };

    let mut merged: Vec<String> = Vec::new();
    for line in &body_lines {
        let b = line.as_bytes();
        let mut start = trim_amt.min(line.len());
        let is_continuation = b.get(start) == Some(&b'^') && b.get(start + 1) == Some(&b'^');
        if is_continuation {
            start += 2;
        }
        let mut end = line.len();
        while end > start && b[end - 1] == b' ' {
            end -= 1;
        }
        if end < start {
            end = start;
        }
        let content = &line[start..end];
        if is_continuation {
            if let Some(last) = merged.last_mut() {
                if !content.is_empty() {
                    last.push(' ');
                    last.push_str(content);
                }
            } else {
                merged.push(content.to_string());
            }
        } else {
            merged.push(content.to_string());
        }
    }
    while merged.last().is_some_and(String::is_empty) {
        merged.pop();
    }
    merged.join("\n")
}

/// Expands tabs to two spaces, but only within each line's *leading*
/// whitespace run — a tab anywhere else in the line is left alone.
fn expand_leading_tabs(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for (i, line) in s.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        let leading_end = line
            .find(|c: char| c != ' ' && c != '\t')
            .unwrap_or(line.len());
        let (leading, rest) = line.split_at(leading_end);
        if leading.contains('\t') {
            for c in leading.chars() {
                if c == '\t' {
                    out.push_str("  ");
                } else {
                    out.push(c);
                }
            }
        } else {
            out.push_str(leading);
        }
        out.push_str(rest);
    }
    out
}

/// Strips trailing ASCII spaces from every line.
fn strip_trailing_spaces(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for (i, line) in s.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(line.trim_end_matches(' '));
    }
    out
}

/// Shared top-level scan, generic over [`Builder`] — mirrors
/// `js/src/core.ts`'s `parseCoreGeneric`. Returns the root mapping type
/// directly (`B::Mapping`), not wrapped in a `B::Value` — `parse_core`'s
/// `LimaValue` and `parse_core_with_positions`'s lookup table are both
/// "a set of top-level key/value pairs", not a value in their own right.
fn parse_core_generic<B: Builder>(
    front_matter: &str,
    strict: bool,
) -> Result<B::Mapping, LimaError> {
    if front_matter.len() > DOCUMENT_SIZE_LIMIT {
        return Err(LimaError::new(
            Code::ResourceLimit,
            1,
            format!("Lima: document exceeds maximum size of {DOCUMENT_SIZE_LIMIT} bytes at line 1"),
        ));
    }
    let mut owned = front_matter.to_string();
    if owned.contains('\r') {
        owned = owned.replace("\r\n", "\n").replace('\r', "\n");
    }
    if owned.contains('\t') {
        owned = expand_leading_tabs(&owned);
    }
    if owned.contains(" \n") || owned.ends_with(' ') {
        owned = strip_trailing_spaces(&owned);
    }
    let front_matter: &str = &owned;
    if front_matter.is_empty() {
        return Ok(B::m_create());
    }

    if strict {
        let mut search_from = 0usize;
        loop {
            let line_end = front_matter[search_from..]
                .find('\n')
                .map(|p| search_from + p);
            let line = &front_matter[search_from..line_end.unwrap_or(front_matter.len())];
            if has_space_before_colon(line) {
                let l = line_at(front_matter, search_from);
                return Err(LimaError::new(
                    Code::InvalidQuote,
                    l,
                    format!("Lima: space between closing quote and colon at line {l}"),
                ));
            }
            match line_end {
                Some(e) => search_from = e + 1,
                None => break,
            }
        }
    }

    let top_keys = scan_top_keys(front_matter);
    if top_keys.len() > TOP_LEVEL_KEY_LIMIT {
        return Err(LimaError::new(
            Code::ResourceLimit,
            1,
            format!("Lima: too many top-level key entries (max {TOP_LEVEL_KEY_LIMIT}) at line 1"),
        ));
    }

    let mut root: B::Mapping = B::m_create();
    let mut depth_risk = false;
    for (i, tk) in top_keys.iter().enumerate() {
        let next_start = top_keys
            .get(i + 1)
            .map(|n| n.key_start)
            .unwrap_or(front_matter.len());
        check_key_length(&tk.key, tk.line)?;
        check_duplicate_key(B::m_has_key(&root, &tk.key), &tk.key, tk.line, strict)?;

        let value = if tk.is_block {
            parse_block_range::<B>(
                front_matter,
                tk.value_start,
                next_start,
                strict,
                tk.line + 1,
                &mut depth_risk,
            )?
            .unwrap_or(B::v_null(tk.line))
        } else {
            let span_end = next_start.min(front_matter.len());
            let first_newline = front_matter[tk.value_start..span_end]
                .find('\n')
                .map(|p| p + tk.value_start);
            match first_newline {
                None => {
                    let val = &front_matter[tk.value_start..span_end];
                    let val = if val.contains('#') {
                        strip_comment(val)
                    } else {
                        val.to_string()
                    };
                    parse_flow_or_scalar_value::<B>(&val, strict, tk.line)?
                }
                Some(nl) if nl == span_end.saturating_sub(1) => {
                    let val = &front_matter[tk.value_start..nl];
                    let val = if val.contains('#') {
                        strip_comment(val)
                    } else {
                        val.to_string()
                    };
                    parse_flow_or_scalar_value::<B>(&val, strict, tk.line)?
                }
                Some(nl) => {
                    let line0 = &front_matter[tk.value_start..nl];
                    let line0_trimmed = line0.trim_matches(is_trim_whitespace);
                    if line0_trimmed != "|" {
                        let val = if line0.contains('#') {
                            strip_comment(line0)
                        } else {
                            line0.to_string()
                        };
                        parse_flow_or_scalar_value::<B>(&val, strict, tk.line)?
                    } else {
                        let body = &front_matter[nl + 1..span_end];
                        let joined = merge_block_scalar(body, &tk.key);
                        check_string_limit(&joined, tk.line)?;
                        B::v_string(joined, tk.line, false)
                    }
                }
            }
        };
        B::m_set(&mut root, tk.key.clone(), value);
    }

    // Core §9 nesting depth, over Core's own reference-inert tree. When
    // References is layered on top, it re-checks depth on the final,
    // post-substitution tree separately — substituted values can add depth
    // this check cannot see yet. `depth_risk` is a cheap conservative
    // pre-filter (block.rs's own bound on how deep it recursed) so the
    // common case never pays for a full tree walk just to find depth 0.
    if depth_risk && B::m_max_depth(&root) > NESTING_DEPTH_LIMIT as u32 {
        return Err(LimaError::new(
            Code::ResourceLimit,
            1,
            format!("Lima: nesting depth exceeds maximum of {NESTING_DEPTH_LIMIT} at line 1"),
        ));
    }

    Ok(root)
}

/// Parses Lima Core 1.0 syntax. `($key)`/`(%key)`-shaped text is never
/// recognised here — Core is reference-unaware by construction; that's
/// exclusively the References extension's concern.
pub fn parse_core(front_matter: &str, strict: bool) -> Result<LimaValue, LimaError> {
    Ok(LimaValue::Mapping(parse_core_generic::<PlainBuilder>(
        front_matter,
        strict,
    )?))
}

/// Parses Lima Core 1.0 syntax into the internal annotated value tree —
/// every node carrying its source line, string leaves additionally
/// carrying whether they came from quoted syntax. `($key)`/`(%key)` text
/// is left exactly as written; nothing here ever inspects or resolves it.
/// The primitive `references.rs` builds on.
pub fn parse_core_with_positions(
    front_matter: &str,
    strict: bool,
) -> Result<Vec<(String, PositionedValue)>, LimaError> {
    parse_core_generic::<PositionedBuilder>(front_matter, strict)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get<'a>(v: &'a LimaValue, key: &str) -> &'a LimaValue {
        let LimaValue::Mapping(entries) = v else {
            panic!("expected mapping")
        };
        &entries
            .iter()
            .find(|(k, _)| k == key)
            .unwrap_or_else(|| panic!("missing key {key:?} in {entries:?}"))
            .1
    }

    #[test]
    fn flat_document() {
        let v = parse_core("title: Hello\ncount: 3\n", false).unwrap();
        assert_eq!(get(&v, "title"), &LimaValue::String("Hello".into()));
        assert_eq!(get(&v, "count"), &LimaValue::Int(3));
    }

    #[test]
    fn nested_mapping() {
        let v = parse_core("address:\n  street: Main St\n  city: Springfield\n", false).unwrap();
        let addr = get(&v, "address");
        assert_eq!(get(addr, "street"), &LimaValue::String("Main St".into()));
        assert_eq!(get(addr, "city"), &LimaValue::String("Springfield".into()));
    }

    #[test]
    fn block_sequence() {
        let v = parse_core("tags:\n  - a\n  - b\n  - c\n", false).unwrap();
        let LimaValue::Array(items) = get(&v, "tags") else {
            panic!("expected array")
        };
        assert_eq!(
            items,
            &[
                LimaValue::String("a".into()),
                LimaValue::String("b".into()),
                LimaValue::String("c".into()),
            ]
        );
    }

    #[test]
    fn sequence_of_mappings() {
        let v = parse_core(
            "items:\n  - name: a\n    qty: 1\n  - name: b\n    qty: 2\n",
            false,
        )
        .unwrap();
        let LimaValue::Array(items) = get(&v, "items") else {
            panic!("expected array")
        };
        assert_eq!(get(&items[0], "name"), &LimaValue::String("a".into()));
        assert_eq!(get(&items[0], "qty"), &LimaValue::Int(1));
        assert_eq!(get(&items[1], "name"), &LimaValue::String("b".into()));
    }

    #[test]
    fn flow_sequence_and_mapping() {
        let v = parse_core("tags: [a, b, c]\nauthor: {name: Alice, age: 30}\n", false).unwrap();
        let LimaValue::Array(tags) = get(&v, "tags") else {
            panic!("expected array")
        };
        assert_eq!(tags.len(), 3);
        let author = get(&v, "author");
        assert_eq!(get(author, "name"), &LimaValue::String("Alice".into()));
        assert_eq!(get(author, "age"), &LimaValue::Int(30));
    }

    #[test]
    fn duplicate_key_strict_throws() {
        assert!(parse_core("title: First\ntitle: Second", true).is_err());
    }

    #[test]
    fn duplicate_key_non_strict_last_wins() {
        let v = parse_core("title: First\ntitle: Second", false).unwrap();
        assert_eq!(get(&v, "title"), &LimaValue::String("Second".into()));
    }

    #[test]
    fn comments_are_stripped() {
        let v = parse_core(
            "title: Hello # a comment\n# full line comment\ncount: 3\n",
            false,
        )
        .unwrap();
        assert_eq!(get(&v, "title"), &LimaValue::String("Hello".into()));
        assert_eq!(get(&v, "count"), &LimaValue::Int(3));
    }

    #[test]
    fn unrecognized_top_level_lines_are_skipped_even_strict() {
        let v = parse_core(
            "title: Hello\nthis is not a key line at all\ncount: 42",
            true,
        )
        .unwrap();
        assert_eq!(get(&v, "title"), &LimaValue::String("Hello".into()));
        assert_eq!(get(&v, "count"), &LimaValue::Int(42));
    }

    #[test]
    fn indented_line_is_not_a_top_level_key() {
        let v = parse_core("  bogus: value\nreal: Hello", false).unwrap();
        let LimaValue::Mapping(entries) = &v else {
            panic!()
        };
        assert_eq!(entries.len(), 1);
        assert_eq!(get(&v, "real"), &LimaValue::String("Hello".into()));
    }

    #[test]
    fn block_scalar_basic() {
        let v = parse_core("description: |\n  Line one.\n  Line two.\n", false).unwrap();
        assert_eq!(
            get(&v, "description"),
            &LimaValue::String("Line one.\nLine two.".into())
        );
    }

    #[test]
    fn block_scalar_continuation() {
        let v = parse_core(
            "description: |\n  This is long\n  ^^and continues.\n",
            false,
        )
        .unwrap();
        assert_eq!(
            get(&v, "description"),
            &LimaValue::String("This is long and continues.".into())
        );
    }

    #[test]
    fn block_scalar_trailing_blank_lines_stripped() {
        let v = parse_core("description: |\n  Line one.\n\n\nnext: value\n", false).unwrap();
        assert_eq!(
            get(&v, "description"),
            &LimaValue::String("Line one.".into())
        );
        assert_eq!(get(&v, "next"), &LimaValue::String("value".into()));
    }

    #[test]
    fn quoted_key_with_escaped_quote() {
        let v = parse_core(r#""say \"hi\"": value"#, false).unwrap();
        assert_eq!(get(&v, "say \"hi\""), &LimaValue::String("value".into()));
    }

    #[test]
    fn space_before_colon_strict_error() {
        assert!(parse_core("\"first name\" : Alice", true).is_err());
    }
}
