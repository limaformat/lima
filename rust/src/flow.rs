//! Core §15.8 flow collections: `[...]` sequences and `{...}` mappings.
//! Mirrors `js/src/flow.ts`. Generic over [`Builder`] — see `scalars.rs`'s
//! module doc.

use crate::chars::is_trim_whitespace;
use crate::errors::{LimaDiagnosticCode as Code, LimaError};
use crate::normalize::{check_duplicate_key, check_key_length};
use crate::scalars::{
    closing_quote_index, is_valid_key, parse_quoted_or_typed, parse_scalar_value, strip_key_quotes,
};
use crate::value::{Builder, ReferenceSource};

/// `ReferenceSource` for a flow element starting at byte `byte_start` within
/// the container `val` — the container column plus the codepoint distance to
/// the element, so References 2.0 error ordering uses real positions.
fn element_source(
    source: Option<&ReferenceSource>,
    val: &str,
    byte_start: usize,
) -> Option<ReferenceSource> {
    source.map(|s| ReferenceSource {
        raw: None,
        line: s.line,
        col: s.col + val[..byte_start].chars().count(),
        // A flow collection is one physical line, so the container's
        // leading-tab adjustment applies to every element.
        tab_adjust: s.tab_adjust.clone(),
    })
}

fn trim_start_at(source: &str, mut start: usize, end: usize) -> usize {
    while start < end {
        let ch = source[start..end].chars().next().unwrap();
        if !is_trim_whitespace(ch) {
            break;
        }
        start += ch.len_utf8();
    }
    start
}

fn trim_end_at(source: &str, start: usize, mut end: usize) -> usize {
    while end > start {
        let ch = source[start..end].chars().next_back().unwrap();
        if !is_trim_whitespace(ch) {
            break;
        }
        end -= ch.len_utf8();
    }
    end
}

/// Stateful comma-item cursor over a flow container's original string.
/// Byte-level scanning is safe here (not just for ASCII fast paths): every
/// delimiter this loop matches on (`"`, `'`, `[`, `{`, `]`, `}`, `,`, `\`)
/// is ASCII, and no continuation byte of a multi-byte UTF-8 sequence can
/// equal an ASCII byte value, so scanning raw bytes can't misfire inside
/// non-ASCII content.
struct FlowCursor<'a> {
    source: &'a str,
    end: usize,
    next_start: usize,
    item_start: usize,
    item_end: usize,
    done: bool,
}

impl<'a> FlowCursor<'a> {
    fn new(source: &'a str, start: usize, end: usize) -> Self {
        Self {
            source,
            end,
            next_start: start,
            item_start: 0,
            item_end: 0,
            done: false,
        }
    }

    fn next(&mut self) -> bool {
        if self.done {
            return false;
        }
        let b = self.source.as_bytes();
        let mut quote: u8 = 0;
        let mut depth: i32 = 0;
        let mut pos = self.next_start;
        while pos < self.end {
            let code = b[pos];
            if quote != 0 {
                if code == b'\\' {
                    pos += 1;
                } else if code == quote {
                    quote = 0;
                }
            } else if code == b'"' || code == b'\'' {
                quote = code;
            } else if code == b'[' || code == b'{' {
                depth += 1;
            } else if code == b']' || code == b'}' {
                depth -= 1;
            } else if code == b',' && depth == 0 {
                break;
            }
            pos += 1;
        }
        self.item_start = trim_start_at(self.source, self.next_start, pos);
        self.item_end = trim_end_at(self.source, self.item_start, pos);
        if pos < self.end {
            self.next_start = pos + 1;
        } else {
            self.done = true;
        }
        true
    }

    fn is_last(&self) -> bool {
        self.done
    }
}

fn is_nested_flow_construct(item: &str) -> bool {
    let b = item.as_bytes();
    matches!(
        (b.first(), b.last()),
        (Some(b'['), Some(b']')) | (Some(b'{'), Some(b'}'))
    )
}

/// `None` = `val` isn't `[...]`-shaped at all (caller falls back to scalar
/// parsing); `Some(items)` on success. Errors are always hard failures
/// (never a `None` fallback), matching the TS source exactly.
pub fn parse_flow_sequence<B: Builder>(
    val: &str,
    strict: bool,
    line: u32,
    check_duplicates: bool,
) -> Result<Option<Vec<B::Value>>, LimaError> {
    if check_duplicates {
        parse_flow_sequence_checked::<B, true>(val, strict, line, None)
    } else {
        parse_flow_sequence_checked::<B, false>(val, strict, line, None)
    }
}

/// `source` is the flow container's own physical position; each element's
/// tokens are anchored at the container column plus the element's offset
/// within it (References 2.0 §5).
pub(crate) fn parse_flow_sequence_checked<B: Builder, const CHECK_DUPLICATES: bool>(
    val: &str,
    strict: bool,
    line: u32,
    source: Option<ReferenceSource>,
) -> Result<Option<Vec<B::Value>>, LimaError> {
    let b = val.as_bytes();
    if b.first() != Some(&b'[') || b.last() != Some(&b']') {
        return Ok(None);
    }
    let inner_start = trim_start_at(val, 1, val.len() - 1);
    let inner_end = trim_end_at(val, inner_start, val.len() - 1);
    if inner_start == inner_end {
        return Ok(Some(Vec::new()));
    }

    let mut items = Vec::new();
    let mut cursor = FlowCursor::new(val, inner_start, inner_end);
    let mut item_count = 0u32;
    while cursor.next() {
        let (start, end) = (cursor.item_start, cursor.item_end);
        item_count += 1;
        if start == end && !strict && cursor.is_last() && item_count > 1 {
            break;
        }
        let item = &val[start..end];
        if item.is_empty() {
            if strict {
                return Err(LimaError::new(
                    Code::InvalidFlowSyntax,
                    line,
                    format!("Lima: empty element in flow sequence at line {line}"),
                ));
            }
            items.push(B::v_null(line));
            continue;
        }
        let ib = item.as_bytes();
        if ib[0] == b'[' && *ib.last().unwrap() == b']' {
            return Err(LimaError::new(
                Code::InvalidFlowSyntax,
                line,
                format!("Lima: nested flow sequence not permitted at line {line}: \"{item}\""),
            ));
        }
        if ib[0] == b'{' && *ib.last().unwrap() == b'}' {
            if let Some(nested) = parse_flow_mapping_checked::<B, CHECK_DUPLICATES>(
                item,
                strict,
                line,
                element_source(source.as_ref(), val, start),
            )? {
                items.push(nested);
                continue;
            }
        }
        items.push(parse_quoted_or_typed::<B>(
            item,
            strict,
            line,
            element_source(source.as_ref(), val, start),
        )?);
    }
    Ok(Some(items))
}

/// Index of the key/value `: ` separator within a flow-mapping item — the
/// first `: ` that is not inside a quoted key (§5.1). `None` when the item
/// has no separator (or its quoted key is never closed).
fn flow_item_separator(val: &str, start: usize, end: usize) -> Option<usize> {
    let b = val.as_bytes();
    let mut scan = start;
    if b.get(start) == Some(&b'"') || b.get(start) == Some(&b'\'') {
        // §5.2: a single-quoted key is literal, so its first `'` closes.
        let close = closing_quote_index(&val[start..end], false)?;
        scan = start + close + 1;
    }
    let sep = val[scan..end].find(": ").map(|p| p + scan)?;
    if sep >= end {
        None
    } else {
        Some(sep)
    }
}

/// `None` = `val` isn't `{...}`-shaped, or (non-strict only) a malformed
/// item inside it means the whole thing falls back to scalar parsing.
pub fn parse_flow_mapping<B: Builder>(
    val: &str,
    strict: bool,
    line: u32,
    check_duplicates: bool,
) -> Result<Option<B::Value>, LimaError> {
    if check_duplicates {
        parse_flow_mapping_checked::<B, true>(val, strict, line, None)
    } else {
        parse_flow_mapping_checked::<B, false>(val, strict, line, None)
    }
}

pub(crate) fn parse_flow_mapping_checked<B: Builder, const CHECK_DUPLICATES: bool>(
    val: &str,
    strict: bool,
    line: u32,
    source: Option<ReferenceSource>,
) -> Result<Option<B::Value>, LimaError> {
    let b = val.as_bytes();
    if b.first() != Some(&b'{') || b.last() != Some(&b'}') {
        return Ok(None);
    }
    let inner_start = trim_start_at(val, 1, val.len() - 1);
    let inner_end = trim_end_at(val, inner_start, val.len() - 1);
    let mut entries: B::Mapping = B::m_create();
    if inner_start == inner_end {
        return Ok(Some(B::v_mapping(entries, line)));
    }

    let mut cursor = FlowCursor::new(val, inner_start, inner_end);
    while cursor.next() {
        let (item_start, item_end) = (cursor.item_start, cursor.item_end);
        let item = &val[item_start..item_end];
        if item.is_empty() {
            if strict {
                return Err(LimaError::new(
                    Code::InvalidFlowSyntax,
                    line,
                    format!("Lima: empty element in flow mapping at line {line}"),
                ));
            }
            continue;
        }
        let malformed = || -> Result<Option<B::Value>, LimaError> {
            if strict {
                Err(LimaError::new(
                    Code::InvalidFlowSyntax, line,
                    format!("Lima: invalid flow mapping item (missing \": \") at line {line}: \"{item}\""),
                ))
            } else {
                Ok(None)
            }
        };
        let Some(colon_pos) = flow_item_separator(val, item_start, item_end) else {
            return malformed();
        };

        let key_start = trim_start_at(val, item_start, colon_pos);
        let key_end = trim_end_at(val, key_start, colon_pos);
        let key_raw = &val[key_start..key_end];
        if !is_valid_key(key_raw) {
            // §5.1: not a usable key — the item is skipped in both modes
            // (§10's strict list is closed and does not cover this),
            // the same as at the top level.
            continue;
        }
        let key = strip_key_quotes(key_raw, strict, line)?;
        check_key_length(&key, line)?;
        if CHECK_DUPLICATES {
            check_duplicate_key(B::m_has_key(&entries, &key), &key, line, strict)?;
        }

        let value_start = trim_start_at(val, colon_pos + 2, item_end);
        let value_end = trim_end_at(val, value_start, item_end);
        let raw_val = &val[value_start..value_end];
        if is_nested_flow_construct(raw_val) {
            return Err(LimaError::new(
                Code::InvalidFlowSyntax,
                line,
                format!("Lima: invalid flow nesting at line {line}: \"{raw_val}\""),
            ));
        }
        let v = parse_quoted_or_typed::<B>(
            raw_val,
            strict,
            line,
            element_source(source.as_ref(), val, value_start),
        )?;
        B::m_set(&mut entries, key, v);
    }
    Ok(Some(B::v_mapping(entries, line)))
}

/// Parses a value that may be a flow collection, without probing both flow
/// parsers for ordinary scalars.
pub fn parse_flow_or_scalar_value<B: Builder>(
    raw: &str,
    strict: bool,
    line: u32,
    check_duplicates: bool,
) -> Result<B::Value, LimaError> {
    if check_duplicates {
        parse_flow_or_scalar_value_checked::<B, true>(raw, strict, line, None)
    } else {
        parse_flow_or_scalar_value_checked::<B, false>(raw, strict, line, None)
    }
}

pub(crate) fn parse_flow_or_scalar_value_checked<B: Builder, const CHECK_DUPLICATES: bool>(
    raw: &str,
    strict: bool,
    line: u32,
    source: Option<ReferenceSource>,
) -> Result<B::Value, LimaError> {
    match raw.as_bytes().first() {
        Some(b'[') => {
            match parse_flow_sequence_checked::<B, CHECK_DUPLICATES>(
                raw,
                strict,
                line,
                source.clone(),
            )? {
                Some(seq) => Ok(B::v_array(seq, line)),
                None => parse_scalar_value::<B>(raw, strict, line, source),
            }
        }
        Some(b'{') => {
            match parse_flow_mapping_checked::<B, CHECK_DUPLICATES>(
                raw,
                strict,
                line,
                source.clone(),
            )? {
                Some(map) => Ok(map),
                None => parse_scalar_value::<B>(raw, strict, line, source),
            }
        }
        _ => parse_quoted_or_typed::<B>(raw, strict, line, source),
    }
}
