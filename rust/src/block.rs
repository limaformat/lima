//! Core §7 block collections (sequences and mappings). Mirrors
//! `js/src/block.ts`, with the same performance-motivated ASCII fast paths
//! deliberately dropped (see `scalars.rs`'s module doc) — `trim_slice` and
//! `strip_key_quotes` are called uniformly instead of branching on whether
//! a fast path applies. Generic over [`Builder`] — see `scalars.rs`'s
//! module doc.

use crate::block_cursor::BlockCursor;
use crate::block_scalar::build_block_scalar;
use crate::chars::is_trim_whitespace;
use crate::errors::{LimaDiagnosticCode as Code, LimaError};
use crate::flow::{parse_flow_mapping_checked, parse_flow_or_scalar_value_checked};
use crate::normalize::{check_duplicate_key, check_key_length, NESTING_DEPTH_LIMIT};
use crate::scalars::{
    closing_quote_index, is_valid_key, parse_quoted_or_typed, strip_comment, strip_key_quotes,
};
use crate::value::Builder;

/// A key's inline value text. If it is exactly `|`, consume the following
/// physical lines belonging to the Core §6.1.5 block scalar introduced by a
/// key at `key_indent` and return the scalar; the cursor is left on the
/// first line past it. Otherwise parse `raw` as an ordinary inline value
/// and advance one line. §6.1.5 places no top-level restriction on block
/// scalars, so this is the same primitive `core.rs` uses at the top level.
fn inline_or_block_scalar<'a, B: Builder, const CHECK_DUPLICATES: bool>(
    raw: &str,
    key_indent: usize,
    key_line: u32,
    cursor: &mut BlockCursor<'a>,
    strict: bool,
) -> Result<B::Value, LimaError> {
    if raw != "|" {
        let value =
            parse_flow_or_scalar_value_checked::<B, CHECK_DUPLICATES>(raw, strict, key_line)?;
        cursor.next();
        return Ok(value);
    }
    cursor.next(); // past the `key: |` line
    let mut body_lines: Vec<&'a str> = Vec::new();
    while cursor.valid {
        if !cursor.empty() && cursor.ascii_indent <= key_indent {
            break;
        }
        body_lines.push(&cursor.source[cursor.line_start..cursor.line_end]);
        cursor.next();
    }
    let (joined, spans, _) = build_block_scalar(&body_lines, key_indent, key_line)?;
    Ok(B::v_block_string(joined, key_line + 1, spans))
}

/// Finds the key/value separator: the first unquoted `: `, or (for a
/// quoted key) the `: ` immediately after the matching closing quote.
/// §5.1: the separator must sit outside the quoted key, so this scans past
/// its (escape-aware) closing quote first. Double-quoted keys honour `\"`;
/// a single-quoted key is literal (§5.2), so its first `'` closes.
fn find_key_sep(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let first = *b.first()?;
    if first == b'\'' || first == b'"' {
        let close = closing_quote_index(s, false)?;
        if b.get(close + 1) == Some(&b':') && b.get(close + 2) == Some(&b' ') {
            return Some(close + 1);
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

/// Core §4 rule 7 / §6.1.3: comment lines (first non-whitespace character
/// `#`) do not affect base indentation and are skipped — including in the
/// lookahead that decides whether a bare key (`key:` with no inline value)
/// has any nested block at all. Advancing past a comment here, not only a
/// blank line, keeps that pre-check consistent with the same skip already
/// applied once inside an established block (`parse_cursor_block`'s own
/// `cursor.empty() || cursor.first_byte() == b'#'` check at the top of its
/// loop).
fn skip_empty_and_comment_lines(cursor: &mut BlockCursor) {
    while cursor.valid && (cursor.empty() || cursor.first_byte() == b'#') {
        cursor.next();
    }
}

/// The text after `- ` (dash + whitespace). If the character right after
/// the dash is *not* whitespace, the whole line (dash included) is treated
/// as an ordinary scalar starting with a literal `-` — not a sequence item.
/// The column of the first key after `- ` on the cursor's current line —
/// the base indentation for the item's sibling keys (§7.2).
fn dash_key_column(cursor: &BlockCursor) -> usize {
    let end = cursor.line_end;
    let mut pos = cursor.content_start + 1;
    while pos < end {
        let ch = cursor.source[pos..end].chars().next().unwrap();
        if !is_trim_whitespace(ch) {
            break;
        }
        pos += ch.len_utf8();
    }
    pos - cursor.line_start
}

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
fn parse_cursor_block<B: Builder, const CHECK_DUPLICATES: bool>(
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
                let colon_pos = find_key_sep(trimmed);
                let key_raw = match colon_pos {
                    Some(c) => trim_slice(trimmed, 0, c),
                    None => match trimmed.strip_suffix(':') {
                        Some(_) => trim_slice(trimmed, 0, trimmed.len() - 1),
                        None => "",
                    },
                };
                if !key_raw.is_empty() && !is_valid_key(key_raw) {
                    // §5.1: not a usable key — skipped in both modes, as at the top level.
                    cursor.next();
                } else if let Some(colon_pos) = colon_pos {
                    let key = strip_key_quotes(key_raw, strict, line)?;
                    check_key_length(&key, line)?;
                    let raw = trim_slice(trimmed, colon_pos + 2, trimmed.len());
                    let raw = if raw != "|" && raw.contains('#') {
                        strip_comment(raw)
                    } else {
                        raw.to_string()
                    };
                    let key_indent = cursor.ascii_indent;
                    let value = inline_or_block_scalar::<B, CHECK_DUPLICATES>(
                        &raw, key_indent, line, cursor, strict,
                    )?;
                    B::m_set(pending, key, value);
                } else if trimmed.ends_with(':') {
                    let key = strip_key_quotes(key_raw, strict, line)?;
                    check_key_length(&key, line)?;
                    cursor.next();
                    skip_empty_and_comment_lines(cursor);
                    let value = if cursor.valid && cursor.indent > indent {
                        parse_cursor_block::<B, CHECK_DUPLICATES>(
                            cursor,
                            cursor.indent,
                            strict,
                            base_line,
                        )?
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
                items.push(parse_quoted_or_typed::<B>(&after_dash, strict, line)?);
                cursor.next();
                continue;
            }

            let flow_map =
                parse_flow_mapping_checked::<B, CHECK_DUPLICATES>(&after_dash, strict, line)?;
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
            } else if colon_pos.is_some_and(|c| is_valid_key(trim_slice(&after_dash, 0, c))) {
                let colon_pos = colon_pos.unwrap();
                let key = strip_key_quotes(trim_slice(&after_dash, 0, colon_pos), strict, line)?;
                check_key_length(&key, line)?;
                let value_start = colon_pos + 2;
                let raw = trim_slice(&after_dash, value_start, after_dash.len());
                // The key sits after `- `, two columns past the dash.
                let value = inline_or_block_scalar::<B, CHECK_DUPLICATES>(
                    raw,
                    base_indent + 2,
                    line,
                    cursor,
                    strict,
                )?;
                let mut item = B::m_create_with(key, value);
                while cursor.valid && cursor.indent > base_indent {
                    let continuation_line = (base_line as i64 + cursor.line_index) as u32;
                    let ckey_indent = cursor.ascii_indent;
                    let cfirst = cursor.source.as_bytes()[cursor.content_start];
                    if cfirst == b'#' {
                        break;
                    }
                    let cont_line =
                        trim_slice(cursor.source, cursor.content_start, cursor.line_end);
                    let Some(csep) = find_key_sep(cont_line) else {
                        break;
                    };
                    let ckey_raw = trim_slice(cont_line, 0, csep);
                    if !is_valid_key(ckey_raw) {
                        break;
                    }
                    let ckey = strip_key_quotes(ckey_raw, strict, continuation_line)?;
                    if ckey.is_empty() {
                        break;
                    }
                    check_key_length(&ckey, continuation_line)?;
                    let cvalue = trim_slice(cont_line, csep + 2, cont_line.len());
                    let cvalue = if cvalue != "|" && cvalue.contains('#') {
                        strip_comment(cvalue)
                    } else {
                        cvalue.to_string()
                    };
                    let cvalue = inline_or_block_scalar::<B, CHECK_DUPLICATES>(
                        &cvalue,
                        ckey_indent,
                        continuation_line,
                        cursor,
                        strict,
                    )?;
                    B::m_set(&mut item, ckey, cvalue);
                }
                pending_item = Some(item);
            } else if colon_pos.is_none() && after_dash.strip_suffix(':').is_some_and(is_valid_key)
            {
                let key_part = after_dash.strip_suffix(':').unwrap();
                let key = strip_key_quotes(trim_slice(key_part, 0, key_part.len()), strict, line)?;
                check_key_length(&key, line)?;
                // §7.1 rule 3 / §7.2: a nested block must be indented deeper
                // than the first key's column (after `- `), not merely deeper
                // than the item's dash. A line at the key's own column is the
                // next sibling key, so the bare key is null.
                let key_column = dash_key_column(cursor);
                cursor.next();
                skip_empty_and_comment_lines(cursor);
                let value = if cursor.valid && cursor.indent > key_column {
                    parse_cursor_block::<B, CHECK_DUPLICATES>(
                        cursor,
                        cursor.indent,
                        strict,
                        base_line,
                    )?
                    .unwrap_or(B::v_null(line))
                } else {
                    B::v_null(line)
                };
                pending_item = Some(B::m_create_with(key, value));
            } else {
                // A quoted-or-typed scalar item — parse_quoted_or_typed enforces
                // §10.1's unterminated / trailing-content strict checks.
                items.push(parse_quoted_or_typed::<B>(&after_dash, strict, line)?);
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
            let colon_pos = find_key_sep(&trimmed);
            let key_attempt: Option<&str> = colon_pos
                .map(|c| trim_slice(&trimmed, 0, c))
                .or_else(|| trimmed.strip_suffix(':').filter(|k| !k.is_empty()));
            if key_attempt.is_some_and(|k| !is_valid_key(k)) {
                // §5.1: not a usable key — unrecognised line, skipped in both
                // modes (§10's strict list is closed and does not cover this).
                cursor.next();
            } else if let Some(colon_pos) = colon_pos {
                let entries = entries.get_or_insert_with(B::m_create);
                let key = strip_key_quotes(trim_slice(&trimmed, 0, colon_pos), strict, line)?;
                check_key_length(&key, line)?;
                if CHECK_DUPLICATES {
                    check_duplicate_key(B::m_has_key(entries, &key), &key, line, strict)?;
                }
                let raw = trim_slice(&trimmed, colon_pos + 2, trimmed.len());
                let raw = if raw != "|" && raw.contains('#') {
                    strip_comment(raw)
                } else {
                    raw.to_string()
                };
                let value = inline_or_block_scalar::<B, CHECK_DUPLICATES>(
                    &raw,
                    base_indent,
                    line,
                    cursor,
                    strict,
                )?;
                B::m_set(entries, key, value);
            } else if let Some(key_part) = trimmed.strip_suffix(':') {
                let key = strip_key_quotes(trim_slice(key_part, 0, key_part.len()), strict, line)?;
                check_key_length(&key, line)?;
                {
                    let entries_ref = entries.get_or_insert_with(B::m_create);
                    if CHECK_DUPLICATES {
                        check_duplicate_key(B::m_has_key(entries_ref, &key), &key, line, strict)?;
                    }
                }
                cursor.next();
                skip_empty_and_comment_lines(cursor);
                let value = if cursor.valid && cursor.indent > base_indent {
                    parse_cursor_block::<B, CHECK_DUPLICATES>(
                        cursor,
                        cursor.indent,
                        strict,
                        base_line,
                    )?
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
    check_duplicates: bool,
    base_line: u32,
    depth_risk: &mut bool,
) -> Result<Option<B::Value>, LimaError> {
    if check_duplicates {
        parse_block_range_checked::<B, true>(source, start, end, strict, base_line, depth_risk)
    } else {
        parse_block_range_checked::<B, false>(source, start, end, strict, base_line, depth_risk)
    }
}

pub(crate) fn parse_block_range_checked<B: Builder, const CHECK_DUPLICATES: bool>(
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
    skip_empty_and_comment_lines(&mut cursor);
    if !cursor.valid {
        return Ok(None);
    }
    let base_indent = cursor.ascii_indent;
    let value =
        parse_cursor_block::<B, CHECK_DUPLICATES>(&mut cursor, base_indent, strict, base_line)?;
    if cursor.max_indent.saturating_sub(base_indent) + 4 > NESTING_DEPTH_LIMIT {
        *depth_risk = true;
    }
    Ok(value)
}
