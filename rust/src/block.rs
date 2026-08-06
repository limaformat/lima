//! Core §7 block collections (sequences and mappings). Mirrors
//! `js/src/block.ts`, with the same performance-motivated ASCII fast paths
//! deliberately dropped (see `scalars.rs`'s module doc) — `trim_slice` and
//! `strip_key_quotes` are called uniformly instead of branching on whether
//! a fast path applies. Generic over [`Builder`] — see `scalars.rs`'s
//! module doc.

use crate::block_cursor::BlockCursor;
use crate::chars::is_trim_whitespace;
use crate::errors::{LimaDiagnosticCode as Code, LimaError};
use crate::flow::{parse_flow_mapping, parse_flow_or_scalar_value};
use crate::normalize::{check_duplicate_key, check_key_length, NESTING_DEPTH_LIMIT};
use crate::scalars::{parse_quoted_or_typed, strip_comment, strip_key_quotes};
use crate::value::Builder;

/// Finds the key/value separator: the first unquoted `: `, or (for a
/// quoted key) the `: ` immediately after the matching closing quote.
/// Not escape-aware — mirrors `findKeySep`'s own naive same-quote scan
/// exactly; malformed quoted keys are a strict-mode error elsewhere, not
/// something this function tries to recover from.
fn find_key_sep(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let first = *b.first()?;
    if first == b'\'' || first == b'"' {
        let mut i = 1;
        while i < b.len() && b[i] != first {
            i += 1;
        }
        if b.get(i + 1) == Some(&b':') && b.get(i + 2) == Some(&b' ') {
            return Some(i + 1);
        }
        return None;
    }
    s.find(": ")
}

fn trim_slice(source: &str, start: usize, end: usize) -> &str {
    source[start..end].trim_matches(is_trim_whitespace)
}

fn cursor_content<'a>(cursor: &BlockCursor<'a>) -> &'a str {
    &cursor.source[cursor.content_start..cursor.line_end]
}

/// The text after `- ` (dash + whitespace). If the character right after
/// the dash is *not* whitespace, the whole line (dash included) is treated
/// as an ordinary scalar starting with a literal `-` — not a sequence item.
fn cursor_after_dash<'a>(cursor: &BlockCursor<'a>) -> &'a str {
    let start = cursor.content_start;
    let end = cursor.line_end;
    if start + 1 == end {
        return "";
    }
    let content = start + 1;
    let first_ch = cursor.source[content..end].chars().next().unwrap();
    if !is_trim_whitespace(first_ch) {
        return &cursor.source[start..end];
    }
    let mut content = content;
    while content < end {
        let ch = cursor.source[content..end].chars().next().unwrap();
        if !is_trim_whitespace(ch) {
            break;
        }
        content += ch.len_utf8();
    }
    &cursor.source[content..end]
}

fn is_dash_only_or_prefixed(s: &str) -> bool {
    if s == "-" {
        return true;
    }
    let Some(rest) = s.strip_prefix('-') else {
        return false;
    };
    rest.starts_with(is_trim_whitespace) && !rest.is_empty()
}

/// Shared block grammar consuming one mutable physical-line cursor.
fn parse_cursor_block<B: Builder>(
    cursor: &mut BlockCursor,
    base_indent: usize,
    strict: bool,
    base_line: u32,
) -> Result<Option<B::Value>, LimaError> {
    let mut items: Option<Vec<B::Value>> = None;
    let mut entries: Option<B::Mapping> = None;
    let mut pending_item: Option<B::Mapping> = None;
    let start_line = cursor.line_index;

    while cursor.valid {
        let line = (base_line as i64 + cursor.line_index) as u32;
        if cursor.empty() || cursor.first_byte() == b'#' {
            cursor.next();
            continue;
        }
        let indent = cursor.indent;
        if indent < base_indent {
            break;
        }

        if indent > base_indent {
            let trimmed = cursor_content(cursor);
            if let (true, Some(pending)) = (items.is_some(), pending_item.as_mut()) {
                if let Some(colon_pos) = find_key_sep(trimmed) {
                    let key = strip_key_quotes(trim_slice(trimmed, 0, colon_pos));
                    check_key_length(&key, line)?;
                    let raw = trim_slice(trimmed, colon_pos + 2, trimmed.len());
                    let raw = if raw.contains('#') {
                        strip_comment(raw)
                    } else {
                        raw.to_string()
                    };
                    let value = parse_flow_or_scalar_value::<B>(&raw, strict, line)?;
                    B::m_set(pending, key, value);
                    cursor.next();
                } else if let Some(key_part) = trimmed.strip_suffix(':') {
                    let key = strip_key_quotes(trim_slice(key_part, 0, key_part.len()));
                    check_key_length(&key, line)?;
                    cursor.next();
                    while cursor.valid && cursor.empty() {
                        cursor.next();
                    }
                    let value = if cursor.valid && cursor.indent > indent {
                        parse_cursor_block::<B>(cursor, cursor.indent, strict, base_line)?
                            .unwrap_or(B::v_null(line))
                    } else {
                        B::v_null(line)
                    };
                    B::m_set(pending, key, value);
                } else {
                    if strict {
                        return Err(LimaError::new(
                            Code::InvalidIndentation, line,
                            format!("Lima: unexpected syntax in array item continuation at line {line}: \"{trimmed}\""),
                        ));
                    }
                    cursor.next();
                }
            } else {
                if strict {
                    return Err(LimaError::new(
                        Code::InvalidIndentation,
                        line,
                        format!("Lima: unexpected indentation at line {line}: \"{trimmed}\""),
                    ));
                }
                cursor.next();
            }
            continue;
        }

        if cursor.first_byte() == b'-' {
            if let Some(p) = pending_item.take() {
                items
                    .get_or_insert_with(Vec::new)
                    .push(B::v_mapping(p, line));
            }
            let items = items.get_or_insert_with(Vec::new);
            if entries.is_some() {
                if strict {
                    return Err(LimaError::new(
                        Code::InvalidIndentation,
                        line,
                        format!(
                            "Lima: mixed array and map entries for the same key at line {line}"
                        ),
                    ));
                }
                cursor.next();
                continue;
            }

            let after_dash = cursor_after_dash(cursor);
            let after_dash = if after_dash.contains('#') {
                strip_comment(after_dash)
            } else {
                after_dash.to_string()
            };
            let first = after_dash.as_bytes().first().copied();
            if !matches!(first, Some(b'"') | Some(b'\'') | Some(b'-') | Some(b'{'))
                && !after_dash.contains(": ")
                && !after_dash.ends_with(':')
            {
                items.push(parse_quoted_or_typed::<B>(
                    &after_dash,
                    strict,
                    line,
                    false,
                )?);
                cursor.next();
                continue;
            }

            let flow_map = parse_flow_mapping::<B>(&after_dash, strict, line)?;
            let colon_pos = find_key_sep(&after_dash);
            if let Some(flow_map) = flow_map {
                items.push(flow_map);
                cursor.next();
            } else if is_dash_only_or_prefixed(&after_dash) {
                if strict {
                    let content = cursor_content(cursor).to_string();
                    return Err(LimaError::new(
                        Code::InvalidIndentation,
                        line,
                        format!("Lima: nested block sequence at line {line}: \"{content}\""),
                    ));
                }
                items.push(B::v_null(line));
                cursor.next();
                while cursor.valid {
                    if cursor.empty() || cursor.first_byte() == b'#' {
                        cursor.next();
                        continue;
                    }
                    if cursor.indent <= base_indent {
                        break;
                    }
                    cursor.next();
                }
            } else if let Some(colon_pos) = colon_pos {
                let key = strip_key_quotes(trim_slice(&after_dash, 0, colon_pos));
                check_key_length(&key, line)?;
                let value_start = colon_pos + 2;
                let raw = trim_slice(&after_dash, value_start, after_dash.len());
                let value = parse_flow_or_scalar_value::<B>(raw, strict, line)?;
                let mut item = B::m_create_with(key, value);
                cursor.next();
                while cursor.valid && cursor.indent > base_indent {
                    let continuation_line = (base_line as i64 + cursor.line_index) as u32;
                    let start = cursor.content_start;
                    let end = cursor.line_end;
                    let cfirst = cursor.source.as_bytes()[start];
                    if matches!(cfirst, b'"' | b'\'' | b'#') {
                        break;
                    }
                    let Some(sep) = cursor.source[start..end].find(": ").map(|p| p + start) else {
                        break;
                    };
                    let ckey = trim_slice(cursor.source, start, sep);
                    if ckey.is_empty() {
                        break;
                    }
                    let ckey = ckey.to_string();
                    check_key_length(&ckey, continuation_line)?;
                    let value_start = sep + 2;
                    let cvalue = trim_slice(cursor.source, value_start, end);
                    let cvalue = if cvalue.contains('#') {
                        strip_comment(cvalue)
                    } else {
                        cvalue.to_string()
                    };
                    let cvalue =
                        parse_flow_or_scalar_value::<B>(&cvalue, strict, continuation_line)?;
                    B::m_set(&mut item, ckey, cvalue);
                    cursor.next();
                }
                pending_item = Some(item);
            } else if let Some(key_part) = after_dash.strip_suffix(':') {
                let key = strip_key_quotes(trim_slice(key_part, 0, key_part.len()));
                check_key_length(&key, line)?;
                cursor.next();
                while cursor.valid && cursor.empty() {
                    cursor.next();
                }
                let value = if cursor.valid && cursor.indent > base_indent {
                    parse_cursor_block::<B>(cursor, cursor.indent, strict, base_line)?
                        .unwrap_or(B::v_null(line))
                } else {
                    B::v_null(line)
                };
                pending_item = Some(B::m_create_with(key, value));
            } else {
                let b = after_dash.as_bytes();
                if b.len() >= 2 && (b[0] == b'"' || b[0] == b'\'') && b[b.len() - 1] == b[0] {
                    let inner = &after_dash[1..after_dash.len() - 1];
                    let value = if b[0] == b'"' {
                        crate::scalars::unescape_dq(inner, strict, line)?
                    } else {
                        inner.replace("\\'", "'")
                    };
                    crate::scalars::check_string_limit(&value, line)?;
                    items.push(B::v_string(value, line, true));
                } else {
                    items.push(parse_quoted_or_typed::<B>(
                        &after_dash,
                        strict,
                        line,
                        false,
                    )?);
                }
                cursor.next();
            }
        } else {
            let trimmed = cursor_content(cursor).to_string();
            if items.is_some() {
                if strict {
                    return Err(LimaError::new(
                        Code::InvalidIndentation,
                        line,
                        format!(
                            "Lima: mixed map and array entries for the same key at line {line}"
                        ),
                    ));
                }
                cursor.next();
                continue;
            }
            if let Some(colon_pos) = find_key_sep(&trimmed) {
                let entries = entries.get_or_insert_with(B::m_create);
                let key = strip_key_quotes(trim_slice(&trimmed, 0, colon_pos));
                check_key_length(&key, line)?;
                check_duplicate_key(B::m_has_key(entries, &key), &key, line, strict)?;
                let raw = trim_slice(&trimmed, colon_pos + 2, trimmed.len());
                let raw = if raw.contains('#') {
                    strip_comment(raw)
                } else {
                    raw.to_string()
                };
                let value = parse_flow_or_scalar_value::<B>(&raw, strict, line)?;
                B::m_set(entries, key, value);
                cursor.next();
            } else if let Some(key_part) = trimmed.strip_suffix(':') {
                let key = strip_key_quotes(trim_slice(key_part, 0, key_part.len()));
                check_key_length(&key, line)?;
                {
                    let entries_ref = entries.get_or_insert_with(B::m_create);
                    check_duplicate_key(B::m_has_key(entries_ref, &key), &key, line, strict)?;
                }
                cursor.next();
                while cursor.valid && cursor.empty() {
                    cursor.next();
                }
                let value = if cursor.valid && cursor.indent > base_indent {
                    parse_cursor_block::<B>(cursor, cursor.indent, strict, base_line)?
                        .unwrap_or(B::v_null(line))
                } else {
                    B::v_null(line)
                };
                B::m_set(entries.get_or_insert_with(B::m_create), key, value);
            } else {
                if strict {
                    return Err(LimaError::new(
                        Code::InvalidIndentation, line,
                        format!("Lima: indented freetext without a block scalar marker at line {line}: \"{trimmed}\""),
                    ));
                }
                cursor.next();
            }
        }
    }

    let result_line = (base_line as i64 + start_line) as u32;
    if let Some(p) = pending_item {
        items
            .get_or_insert_with(Vec::new)
            .push(B::v_mapping(p, result_line));
    }
    Ok(if let Some(items) = items {
        Some(B::v_array(items, result_line))
    } else {
        entries.map(|e| B::v_mapping(e, result_line))
    })
}

/// Complete block grammar over one UTF-8 source range (byte offsets).
/// `depth_risk`, if set to `true`, signals that recursive block containers
/// may have exceeded `NESTING_DEPTH_LIMIT` — Core §9's nesting-depth check
/// (this port doesn't yet enforce it as a hard error, only surfaces the
/// risk flag, matching how deep the TS source's own conservative bound is
/// meant to be used by its caller).
pub fn parse_block_range<B: Builder>(
    source: &str,
    start: usize,
    end: usize,
    strict: bool,
    base_line: u32,
    depth_risk: &mut bool,
) -> Result<Option<B::Value>, LimaError> {
    let mut cursor = BlockCursor::new(source, start, end);
    if !cursor.next() {
        return Ok(None);
    }
    while cursor.valid && cursor.empty() {
        cursor.next();
    }
    if !cursor.valid {
        return Ok(None);
    }
    let base_indent = cursor.ascii_indent;
    let value = parse_cursor_block::<B>(&mut cursor, base_indent, strict, base_line)?;
    if cursor.max_indent.saturating_sub(base_indent) + 4 > NESTING_DEPTH_LIMIT {
        *depth_risk = true;
    }
    Ok(value)
}
