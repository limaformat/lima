//! Core §15.8 flow collections: `[...]` sequences and `{...}` mappings.
//! Mirrors `js/src/flow.ts`. Generic over [`Builder`] — see `scalars.rs`'s
//! module doc.

use crate::chars::is_trim_whitespace;
use crate::errors::{LimaDiagnosticCode as Code, LimaError};
use crate::normalize::{check_duplicate_key, check_key_length};
use crate::scalars::{parse_quoted_or_typed, parse_scalar_value, strip_key_quotes};
use crate::value::Builder;

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
            if let Some(nested) = parse_flow_mapping::<B>(item, strict, line)? {
                items.push(nested);
                continue;
            }
        }
        items.push(parse_quoted_or_typed::<B>(item, strict, line, false)?);
    }
    Ok(Some(items))
}

/// `None` = `val` isn't `{...}`-shaped, or (non-strict only) a malformed
/// item inside it means the whole thing falls back to scalar parsing.
pub fn parse_flow_mapping<B: Builder>(
    val: &str,
    strict: bool,
    line: u32,
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
        let colon_pos = val[item_start..].find(": ").map(|p| p + item_start);
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
        let Some(colon_pos) = colon_pos else {
            return malformed();
        };
        if colon_pos >= item_end {
            return malformed();
        }

        let key_start = trim_start_at(val, item_start, colon_pos);
        let key_end = trim_end_at(val, key_start, colon_pos);
        let key = strip_key_quotes(&val[key_start..key_end]);
        check_key_length(&key, line)?;
        check_duplicate_key(B::m_has_key(&entries, &key), &key, line, strict)?;

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
        let v = parse_quoted_or_typed::<B>(raw_val, strict, line, false)?;
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
) -> Result<B::Value, LimaError> {
    match raw.as_bytes().first() {
        Some(b'[') => match parse_flow_sequence::<B>(raw, strict, line)? {
            Some(seq) => Ok(B::v_array(seq, line)),
            None => parse_scalar_value::<B>(raw, strict, line),
        },
        Some(b'{') => match parse_flow_mapping::<B>(raw, strict, line)? {
            Some(map) => Ok(map),
            None => parse_scalar_value::<B>(raw, strict, line),
        },
        _ => parse_quoted_or_typed::<B>(raw, strict, line, true),
    }
}
