//! Core §6.1.5 literal block scalars (`|`). Shared by the top-level key
//! path (`core.rs`) and the nested block path (`block.rs`): §6.1.5 defines
//! block scalar extent generically ("indentation strictly greater than the
//! indentation of the key that introduced the scalar"), with no top-level
//! restriction, so both call sites must agree byte for byte. Mirrors
//! `js/src/block-scalar.ts`.

use crate::errors::LimaError;
use crate::scalars::check_string_limit;
use crate::value::StringSourceSpan;

/// Leading U+0020 count. "Indentation" in §6.1.5 is spaces, from column 0.
fn leading_spaces(line: &str) -> usize {
    line.bytes().take_while(|&b| b == b' ').count()
}

/// Index right after the last non-space byte.
fn trailing_space_end(line: &str) -> usize {
    let b = line.as_bytes();
    let mut end = b.len();
    while end > 0 && b[end - 1] == b' ' {
        end -= 1;
    }
    end
}

/// Builds a `|` block scalar value.
///
/// `body_lines` are the physical source lines *after* the `|` line, each in
/// its original column-0 form (trailing spaces are stripped here).
/// `key_indent` is the indentation of the introducing key (0 at the top
/// level). `pipe_line` is the 1-based line of the `|` line, so
/// `body_lines[i]` is at `pipe_line + 1 + i`.
///
/// Returns the joined value, its source spans, and how many of `body_lines`
/// the scalar consumed — a caller iterating physical lines resumes past
/// that; a caller that already sliced the range to the scalar ignores it.
pub(crate) fn build_block_scalar(
    body_lines: &[&str],
    key_indent: usize,
    pipe_line: u32,
) -> Result<(String, Vec<StringSourceSpan>, usize), LimaError> {
    // Extent (§6.1.5): a line belongs to the scalar iff its indentation is
    // strictly greater than the introducing key's. Empty lines between
    // content lines belong regardless; the first non-empty line dedented to
    // the key's column or less ends the scalar, `#` lines included.
    let mut consumed = body_lines.len();
    for (i, line) in body_lines.iter().enumerate() {
        let ind = leading_spaces(line);
        if ind == line.len() {
            continue; // empty
        }
        if ind <= key_indent {
            consumed = i;
            break;
        }
    }
    let lines = &body_lines[..consumed];

    // Content indentation (§6.1.5): the smallest number of leading spaces
    // among all non-empty content lines, measured from column 0, removed
    // uniformly from every line.
    let mut min_indent = usize::MAX;
    for line in lines {
        let ind = leading_spaces(line);
        if ind == line.len() {
            continue; // empty lines do not participate
        }
        min_indent = min_indent.min(ind);
    }
    let trim_amt = if min_indent == usize::MAX {
        0
    } else {
        min_indent
    };

    let mut merged: Vec<String> = Vec::new();
    let mut line_spans: Vec<Vec<StringSourceSpan>> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let b = line.as_bytes();
        let mut start = trim_amt.min(line.len());
        let is_continuation = b.get(start) == Some(&b'^') && b.get(start + 1) == Some(&b'^'); // ^^
        if is_continuation {
            start += 2;
        }
        let mut end = trailing_space_end(line);
        if end < start {
            end = start;
        }
        let content = &line[start..end];
        let span_line = pipe_line + 1 + i as u32;
        if is_continuation && !merged.is_empty() {
            if !content.is_empty() {
                let last = merged.last_mut().unwrap();
                let output_start = last.len() + 1;
                last.push(' ');
                last.push_str(content);
                line_spans.last_mut().unwrap().push(StringSourceSpan {
                    start: output_start,
                    line: span_line,
                    source_offset: start,
                });
            }
        } else {
            merged.push(content.to_string());
            line_spans.push(if content.is_empty() {
                Vec::new()
            } else {
                vec![StringSourceSpan {
                    start: 0,
                    line: span_line,
                    source_offset: start,
                }]
            });
        }
    }

    // Trailing content (§6.1.5): all trailing empty lines are stripped.
    while merged.last().is_some_and(String::is_empty) {
        merged.pop();
        line_spans.pop();
    }

    let mut spans = Vec::new();
    let mut output_start = 0;
    for (line, mut pieces) in merged.iter().zip(line_spans) {
        for span in &mut pieces {
            span.start += output_start;
        }
        spans.extend(pieces);
        output_start += line.len() + 1;
    }

    let joined = merged.join("\n");
    check_string_limit(&joined, pipe_line)?;
    Ok((joined, spans, consumed))
}
