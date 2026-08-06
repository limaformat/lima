//! Core scalar grammar — mirrors `js/src/scalars.ts`: dates, numbers/type
//! coercion, quoting/escaping, and the shared quoted-or-typed scalar parser.
//!
//! Generic over [`Builder`] (mirrors `js/src/builder.ts`'s `ValueBuilder<V, M>`)
//! so the plain `LimaValue` projection and the position-annotated
//! `PositionedValue` tree share one grammar without a second, hand-copied
//! parser. No `regex` dependency: every date/number shape below is checked
//! in hand-written scanners, matching the char-code fast paths the TS
//! source already prefers over its regexes for the same forms.

use crate::errors::{LimaDiagnosticCode as Code, LimaError};
use crate::value::{days_from_civil, Builder, Instant};

pub const SCALAR_LENGTH_LIMIT: usize = 16_384;

pub fn check_string_limit(value: &str, line: u32) -> Result<(), LimaError> {
    // Rust strings are UTF-8; `.chars().count()` is already the code-point
    // length (no UTF-16 surrogate-pair subtlety like the TS source has).
    if value.chars().count() > SCALAR_LENGTH_LIMIT {
        return Err(LimaError::new(
            Code::ResourceLimit,
            line,
            format!("Lima: scalar exceeds maximum length of {SCALAR_LENGTH_LIMIT} code points at line {line}"),
        ));
    }
    Ok(())
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const DAYS_IN_MONTH: [u32; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

fn is_leap_year(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i64, m: u32) -> u32 {
    if m == 2 && is_leap_year(y) {
        29
    } else {
        DAYS_IN_MONTH[(m - 1) as usize]
    }
}

fn is_valid_ymd_hms(y: i64, mo: u32, d: u32, h: u32, mi: u32, s: u32) -> bool {
    y >= 1
        && (1..=12).contains(&mo)
        && d >= 1
        && d <= days_in_month(y, mo)
        && h <= 23
        && mi <= 59
        && s <= 59
}

fn to_instant(y: i64, mo: u32, d: u32, h: u32, mi: u32, s: u32, offset_min: i64) -> Instant {
    let epoch_seconds =
        days_from_civil(y, mo, d) * 86_400 + h as i64 * 3600 + mi as i64 * 60 + s as i64
            - offset_min * 60;
    Instant { epoch_seconds }
}

struct DateInvalid;

/// `(year, month, day, hour, minute, second, utc_offset_minutes)`.
type DateParts = (i64, u32, u32, u32, u32, u32, i64);

/// ISO 8601 date or datetime, optionally with `Z`/`±HH:MM` offset:
/// `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM(:SS)?(Z|±HH:MM)?`.
fn try_parse_iso(s: &str) -> Option<Result<DateParts, DateInvalid>> {
    let b = s.as_bytes();
    if b.len() < 10
        || !is_digit4(&b[0..4])
        || b[4] != b'-'
        || !is_digit2(&b[5..7])
        || b[7] != b'-'
        || !is_digit2(&b[8..10])
    {
        return None;
    }
    let y = digits(&b[0..4]);
    let mo = digits(&b[5..7]) as u32;
    let d = digits(&b[8..10]) as u32;
    if b.len() == 10 {
        return Some(Ok((y, mo, d, 0, 0, 0, 0)));
    }
    if b.len() < 16
        || b[10] != b'T'
        || !is_digit2(&b[11..13])
        || b[13] != b':'
        || !is_digit2(&b[14..16])
    {
        return None;
    }
    let h = digits(&b[11..13]) as u32;
    let mi = digits(&b[14..16]) as u32;
    let mut rest = &s[16..];
    let mut sec = 0u32;
    if let Some(r) = rest.strip_prefix(':') {
        if r.len() < 2 || !is_digit2(r.as_bytes()) {
            return None;
        }
        sec = digits(r.as_bytes()[0..2].try_into().unwrap()) as u32;
        rest = &r[2..];
    }
    if rest.is_empty() {
        return Some(Ok((y, mo, d, h, mi, sec, 0)));
    }
    if rest == "Z" {
        return Some(Ok((y, mo, d, h, mi, sec, 0)));
    }
    let rb = rest.as_bytes();
    if rb.len() == 6
        && (rb[0] == b'+' || rb[0] == b'-')
        && is_digit2(&rb[1..3])
        && rb[3] == b':'
        && is_digit2(&rb[4..6])
    {
        let sign: i64 = if rb[0] == b'-' { -1 } else { 1 };
        let oh = digits(&rb[1..3]);
        let om = digits(&rb[4..6]);
        if oh > 14 || om > 59 || (oh == 14 && om != 0) {
            return Some(Err(DateInvalid));
        }
        return Some(Ok((y, mo, d, h, mi, sec, sign * (oh * 60 + om))));
    }
    None
}

/// `DD.MM.YYYY` or `DD.MM.YYYY HH:MM(:SS)?` (German style).
fn try_parse_german(s: &str) -> Option<(i64, u32, u32, u32, u32, u32)> {
    let (date_part, time_part) = split_once_space(s);
    let mut parts = date_part.split('.');
    let d = parts.next()?;
    let mo = parts.next()?;
    let y = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    if !(1..=2).contains(&d.len()) || !d.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if !(1..=2).contains(&mo.len()) || !mo.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if y.len() != 4 || !y.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let (h, mi, sec) = parse_optional_time(time_part)?;
    Some((
        y.parse().ok()?,
        mo.parse().ok()?,
        d.parse().ok()?,
        h,
        mi,
        sec,
    ))
}

/// `YYYY/MM/DD` or `YYYY/MM/DD HH:MM(:SS)?`.
fn try_parse_slash(s: &str) -> Option<(i64, u32, u32, u32, u32, u32)> {
    let (date_part, time_part) = split_once_space(s);
    let b = date_part.as_bytes();
    if b.len() != 10
        || !is_digit4(&b[0..4])
        || b[4] != b'/'
        || !is_digit2(&b[5..7])
        || b[7] != b'/'
        || !is_digit2(&b[8..10])
    {
        return None;
    }
    let (h, mi, sec) = parse_optional_time(time_part)?;
    Some((
        digits(&b[0..4]),
        digits(&b[5..7]) as u32,
        digits(&b[8..10]) as u32,
        h,
        mi,
        sec,
    ))
}

fn split_once_space(s: &str) -> (&str, Option<&str>) {
    match s.split_once(' ') {
        Some((a, b)) => (a, Some(b)),
        None => (s, None),
    }
}

/// `None` time part -> midnight. `Some("HH:MM")` / `Some("HH:MM:SS")` -> that time. Anything else is invalid.
fn parse_optional_time(time_part: Option<&str>) -> Option<(u32, u32, u32)> {
    let Some(t) = time_part else {
        return Some((0, 0, 0));
    };
    let b = t.as_bytes();
    if b.len() != 5 && b.len() != 8 {
        return None;
    }
    if !is_digit2(&b[0..2]) || b[2] != b':' || !is_digit2(&b[3..5]) {
        return None;
    }
    let h = digits(&b[0..2]) as u32;
    let mi = digits(&b[3..5]) as u32;
    if b.len() == 5 {
        return Some((h, mi, 0));
    }
    if b[5] != b':' || !is_digit2(&b[6..8]) {
        return None;
    }
    Some((h, mi, digits(&b[6..8]) as u32))
}

fn is_digit4(b: &[u8]) -> bool {
    b.len() == 4 && b.iter().all(u8::is_ascii_digit)
}
fn is_digit2(b: &[u8]) -> bool {
    b.len() >= 2 && b[0].is_ascii_digit() && b[1].is_ascii_digit()
}
fn digits(b: &[u8]) -> i64 {
    b.iter().fold(0i64, |acc, c| acc * 10 + (c - b'0') as i64)
}

/// Parses one of the three Core §6.5.1 date shapes. `strict` throws
/// `INVALID_DATE` on a syntactically date-shaped but calendrically invalid
/// value (e.g. `2024-02-30`); non-strict returns `Ok(None)` so the caller
/// falls back to a plain string.
pub fn parse_date_utc(s: &str, strict: bool, line: u32) -> Result<Option<Instant>, LimaError> {
    let invalid = || -> Result<Option<Instant>, LimaError> {
        if strict {
            Err(LimaError::new(
                Code::InvalidDate,
                line,
                format!("Lima: invalid date \"{s}\" at line {line}"),
            ))
        } else {
            Ok(None)
        }
    };

    let parsed = if let Some(r) = try_parse_iso(s) {
        match r {
            Ok(v) => Some(v),
            Err(DateInvalid) => return invalid(),
        }
    } else if let Some((y, mo, d, h, mi, sec)) = try_parse_german(s) {
        Some((y, mo, d, h, mi, sec, 0))
    } else if let Some((y, mo, d, h, mi, sec)) = try_parse_slash(s) {
        Some((y, mo, d, h, mi, sec, 0))
    } else {
        None
    };

    let Some((y, mo, d, h, mi, sec, offset_min)) = parsed else {
        return Ok(None);
    };
    if !is_valid_ymd_hms(y, mo, d, h, mi, sec) {
        return invalid();
    }
    let instant = to_instant(y, mo, d, h, mi, sec, offset_min);
    let (result_year, _, _) =
        crate::value::civil_from_days(instant.epoch_seconds.div_euclid(86_400));
    if !(1..=9999).contains(&result_year) {
        return invalid();
    }
    Ok(Some(instant))
}

// ─── Numbers ────────────────────────────────────────────────────────────────

/// Core §6.4.1 number grammar: `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`
/// or `-?\.[0-9]+(...)?`. Never `str::parse` first — Rust's float parser
/// accepts strings (`inf`, `1_000`, leading `+`) Lima does not.
fn matches_number_grammar(s: &str) -> bool {
    let b = s.as_bytes();
    let mut i = 0;
    if i < b.len() && b[i] == b'-' {
        i += 1;
    }
    let int_start = i;
    if i < b.len() && b[i] == b'0' {
        i += 1;
    } else if i < b.len() && b[i].is_ascii_digit() {
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
    } else if i < b.len() && b[i] == b'.' {
        // leading-dot form: `.5` — no integer digits required
    } else {
        return false;
    }
    if i == int_start && (i >= b.len() || b[i] != b'.') {
        return false;
    }
    if i < b.len() && b[i] == b'.' {
        i += 1;
        let frac_start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == frac_start {
            return false;
        }
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        let exp_start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == exp_start {
            return false;
        }
    }
    i == b.len() && !b.is_empty()
}

fn is_float_form(s: &str) -> bool {
    s.contains('.') || s.contains('e') || s.contains('E')
}

fn is_zero_literal(s: &str) -> bool {
    let s = s.strip_prefix('-').unwrap_or(s);
    let mantissa = s.split(['e', 'E']).next().unwrap_or(s);
    let (int_part, frac_part) = match mantissa.split_once('.') {
        Some((i, f)) => (i, f),
        None => (mantissa, ""),
    };
    !int_part.is_empty()
        && int_part.bytes().all(|c| c == b'0')
        && frac_part.bytes().all(|c| c == b'0')
}

/// A superset pre-check for whether `str` is worth running the (comparatively
/// expensive) date parsers over — must contain a digit and be at least 5
/// bytes of digits/date-ish punctuation. Mirrors `DATE_PRE_RE` in the TS
/// source; a cheap reject, not a grammar authority (`parse_date_utc` is).
fn looks_date_ish(s: &str) -> bool {
    let mut has_digit = false;
    let mut run = 0usize;
    for c in s.bytes() {
        let ok =
            c.is_ascii_digit() || matches!(c, b'-' | b':' | b'.' | b'/') || c.is_ascii_alphabetic();
        if c.is_ascii_digit() {
            has_digit = true;
        }
        if ok {
            run += 1;
            if has_digit && run >= 5 {
                return true;
            }
        } else {
            run = 0;
            has_digit = false;
        }
    }
    false
}

/// Classifies a raw token per Core §6.4.1's number grammar and §6.5.1's date
/// shapes, in that order, falling back to a plain string. Generic over
/// [`Builder`] — shared by `parse_core`'s plain result and
/// `references.rs`'s position-annotated tree, one grammar either way.
fn build_typed<B: Builder>(s: &str, strict: bool, line: u32) -> Result<B::Value, LimaError> {
    if s.is_empty() || s == "null" || s == "~" {
        return Ok(B::v_null(line));
    }
    if s == "true" {
        return Ok(B::v_bool(true, line));
    }
    if s == "false" {
        return Ok(B::v_bool(false, line));
    }

    let first = s.as_bytes()[0];
    if !(first.is_ascii_digit() || first == b'-' || first == b'.') {
        check_string_limit(s, line)?;
        return Ok(B::v_string(s.to_string(), line, false));
    }

    // Hex/octal/binary literals (0x, 0o, 0b) stay strings — YAML 1.2 compatible.
    if s.len() > 2 && s.as_bytes()[0] == b'0' {
        let c = s.as_bytes()[1] | 0x20; // lowercase
        if matches!(c, b'x' | b'o' | b'b') {
            check_string_limit(s, line)?;
            return Ok(B::v_string(s.to_string(), line, false));
        }
    }

    if matches_number_grammar(s) {
        if is_float_form(s) {
            // Order matters and mirrors the TS source's if/else-if/else
            // exactly: overflow-to-infinity is checked first, then
            // underflow-to-zero, and only then the general finite case —
            // `0.0` is finite, so checking "is finite" before "is a genuine
            // zero literal" would wrongly accept underflowed values (an
            // earlier version of this port had exactly that bug: `1e-400`
            // parsed to `0.0`, which is finite, and returned `Float(0.0)`
            // before the underflow check ever ran).
            //
            // Non-strict overflow/underflow: TS's `Number()` still returns
            // `Infinity`/`0` respectively, but the TS `if` chain has no
            // `else` that returns a float for either case — execution falls
            // out of the whole `if (NUMBER_RE.test(str))` block and the
            // function ultimately falls back to a plain string. No `return`
            // here reproduces that.
            if let Ok(n) = s.parse::<f64>() {
                if !n.is_finite() {
                    if strict {
                        return Err(LimaError::new(
                            Code::InvalidNumber, line,
                            format!("Lima: float value overflows to a non-finite value at line {line}: \"{s}\""),
                        ));
                    }
                } else if n == 0.0 && !is_zero_literal(s) {
                    if strict {
                        return Err(LimaError::new(
                            Code::InvalidNumber, line,
                            format!("Lima: non-zero float value underflows to zero at line {line}: \"{s}\""),
                        ));
                    }
                } else {
                    return Ok(B::v_float(if n == 0.0 { 0.0 } else { n }, line));
                }
            }
        } else if let Ok(n) = s.parse::<i64>() {
            if n.unsigned_abs() <= 9_007_199_254_740_991 {
                // JS's MAX_SAFE_INTEGER
                return Ok(B::v_int(n, line));
            }
        }
    }

    if !s.contains('@') && looks_date_ish(s) {
        if let Some(instant) = parse_date_utc(s, strict, line)? {
            return Ok(B::v_instant(instant, line));
        }
    }

    check_string_limit(s, line)?;
    Ok(B::v_string(s.to_string(), line, false))
}

// ─── Scalar / quoting ───────────────────────────────────────────────────────

const SINGLE_CHAR_ESCAPES: &[u8] = b"\"\\/bfnrt"; // deliberately excludes '0' — Appendix A: \0 is unknown.

fn is_valid_escape(escape: &str) -> bool {
    let b = escape.as_bytes();
    if b.len() == 1 {
        return SINGLE_CHAR_ESCAPES.contains(&b[0]);
    }
    if b[0] == b'u' && b.len() == 5 && b[1..].iter().all(u8::is_ascii_hexdigit) {
        let cp = u32::from_str_radix(&escape[1..], 16).unwrap_or(0xd800);
        return !(0xd800..=0xdfff).contains(&cp);
    }
    if b[0] == b'U' && b.len() == 9 && b[1..].iter().all(u8::is_ascii_hexdigit) {
        return u32::from_str_radix(&escape[1..], 16)
            .map(|cp| cp <= 0x10ffff)
            .unwrap_or(false);
    }
    if b[0] == b'x' && b.len() == 3 && b[1..].iter().all(u8::is_ascii_hexdigit) {
        return true;
    }
    false
}

/// Unescapes a double-quoted string body. `strict` validates every `\X`
/// sequence up front (`INVALID_ESCAPE` on the first bad one); non-strict
/// leaves unrecognised escapes untouched, byte-for-byte.
pub fn unescape_dq(s: &str, strict: bool, line: u32) -> Result<String, LimaError> {
    if !s.contains('\\') {
        return Ok(s.to_string());
    }

    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] != '\\' || i + 1 >= chars.len() {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        let (escape, consumed) = read_escape(&chars, i + 1);
        if !is_valid_escape(&escape) {
            if strict {
                return Err(LimaError::new(
                    Code::InvalidEscape,
                    line,
                    format!("Lima: unknown escape sequence \"\\{escape}\" at line {line}"),
                ));
            }
            out.push('\\');
            out.push_str(&escape);
            i += 1 + consumed;
            continue;
        }
        match escape.as_bytes()[0] {
            b'"' => out.push('"'),
            b'\\' => out.push('\\'),
            b'/' => out.push('/'),
            b'b' => out.push('\u{8}'),
            b'f' => out.push('\u{c}'),
            b'n' => out.push('\n'),
            b'r' => out.push('\r'),
            b't' => out.push('\t'),
            b'u' => out.push(
                char::from_u32(u32::from_str_radix(&escape[1..], 16).unwrap())
                    .unwrap_or('\u{fffd}'),
            ),
            b'U' => out.push(
                char::from_u32(u32::from_str_radix(&escape[1..], 16).unwrap())
                    .unwrap_or('\u{fffd}'),
            ),
            b'x' => out.push(
                char::from_u32(u32::from_str_radix(&escape[1..], 16).unwrap())
                    .unwrap_or('\u{fffd}'),
            ),
            _ => unreachable!(),
        }
        i += 1 + consumed;
    }
    Ok(out)
}

/// Strips a key's surrounding quotes (unescaping a double-quoted key), or
/// returns it unchanged. Never fails: `strict=false` disables every throwing
/// branch in `unescape_dq`.
pub fn strip_key_quotes(s: &str) -> String {
    let b = s.as_bytes();
    if b.len() >= 2 && b[0] == b'\'' && b[b.len() - 1] == b'\'' {
        return s[1..s.len() - 1].to_string();
    }
    if b.len() >= 2 && b[0] == b'"' && b[b.len() - 1] == b'"' {
        return unescape_dq(&s[1..s.len() - 1], false, 0).expect("strict=false never errors");
    }
    s.to_string()
}

/// Reads the escape token immediately after a `\` at `chars[start]` — one of
/// `"`,`\`,`/`,`b`,`f`,`n`,`r`,`t`, `u` + up to 4 hex, `U` + up to 8 hex,
/// `x` + up to 2 hex, or a single bare character. Returns the token text
/// (without the leading `\`) and how many chars it consumed.
fn read_escape(chars: &[char], start: usize) -> (String, usize) {
    if start >= chars.len() {
        return (String::new(), 0);
    }
    let kind = chars[start];
    let max_hex = match kind {
        'u' => 4,
        'U' => 8,
        'x' => 2,
        _ => return (kind.to_string(), 1),
    };
    let mut hex = String::new();
    let mut j = start + 1;
    while j < chars.len() && hex.len() < max_hex && chars[j].is_ascii_hexdigit() {
        hex.push(chars[j]);
        j += 1;
    }
    (format!("{kind}{hex}"), j - start)
}

/// Shared quoted-or-typed scalar parser — every value position (top-level
/// inline values, flow items, block-array/map scalar items) builds on this.
/// `top_level` gates two strict-only checks (unterminated quote / trailing
/// content after a closing quote) that apply only at the outermost call
/// site, not to flow items — kept as a faithful behavioral port of the TS
/// source rather than extended to flow (which doesn't exist here yet).
pub fn parse_quoted_or_typed<B: Builder>(
    raw: &str,
    strict: bool,
    line: u32,
    top_level: bool,
) -> Result<B::Value, LimaError> {
    let bytes = raw.as_bytes();
    if !bytes.is_empty() && (bytes[0] == b'"' || bytes[0] == b'\'') {
        let quote = bytes[0];
        if bytes.last() == Some(&quote) {
            let inner = &raw[1..raw.len() - 1];
            let value = if quote == b'"' {
                unescape_dq(inner, strict, line)?
            } else {
                inner.replace("\\'", "'")
            };
            check_string_limit(&value, line)?;
            // Core §2.3: text originating from closed quote syntax is
            // marked `quoted` — never a reference site for References.
            return Ok(B::v_string(value, line, true));
        }
        if top_level && strict {
            return Err(LimaError::new(
                Code::InvalidQuote,
                line,
                format!("Lima: non-whitespace content after closing quote at line {line}"),
            ));
        }
    }

    if !raw.is_empty() && raw != "null" && raw != "~" && raw != "true" && raw != "false" {
        let first = raw.as_bytes()[0];
        if !(first.is_ascii_digit() || first == b'-' || first == b'.') {
            check_string_limit(raw, line)?;
            return Ok(B::v_string(raw.to_string(), line, false));
        }
    }
    build_typed::<B>(raw, strict, line)
}

/// Strips a trailing `#` comment — mirrors `js/src/scalars.ts`'s
/// `stripComment`: quote-aware (a `#` inside `"..."`/`'...'` is not a
/// comment marker) and `\#` is an escaped literal hash, not a comment start.
pub fn strip_comment(val: &str) -> String {
    let chars: Vec<char> = val.chars().collect();
    let mut quote: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(q) = quote {
            if c == '\\' {
                i += 1;
            } else if c == q {
                quote = None;
            }
        } else if c == '"' || c == '\'' {
            quote = Some(c);
        } else if c == '\\' && chars.get(i + 1) == Some(&'#') {
            i += 1;
        } else if c == '#' {
            let cut: String = chars[..i].iter().collect();
            return cut.trim_end().replace("\\#", "#");
        }
        i += 1;
    }
    val.replace("\\#", "#")
}

/// Top-level entry: rejects an unclosed `[`/`{` in strict mode (References'
/// flow-syntax territory; Core has no flow grammar of its own to recover
/// with), otherwise delegates to [`parse_quoted_or_typed`].
pub fn parse_scalar_value<B: Builder>(
    raw: &str,
    strict: bool,
    line: u32,
) -> Result<B::Value, LimaError> {
    if strict {
        if let Some(&first) = raw.as_bytes().first() {
            if first == b'[' || first == b'{' {
                let kind = if first == b'[' { "sequence" } else { "mapping" };
                return Err(LimaError::new(
                    Code::InvalidFlowSyntax,
                    line,
                    format!("Lima: unclosed flow {kind} at line {line}"),
                ));
            }
        }
    }
    parse_quoted_or_typed::<B>(raw, strict, line, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::value::{LimaValue, PlainBuilder};

    fn v(raw: &str) -> LimaValue {
        parse_scalar_value::<PlainBuilder>(raw, false, 1).unwrap()
    }
    fn v_strict(raw: &str) -> Result<LimaValue, LimaError> {
        parse_scalar_value::<PlainBuilder>(raw, true, 1)
    }

    #[test]
    fn null_and_bool_literals() {
        assert_eq!(v(""), LimaValue::Null);
        assert_eq!(v("null"), LimaValue::Null);
        assert_eq!(v("~"), LimaValue::Null);
        assert_eq!(v("true"), LimaValue::Bool(true));
        assert_eq!(v("false"), LimaValue::Bool(false));
    }

    #[test]
    fn integers() {
        assert_eq!(v("0"), LimaValue::Int(0));
        assert_eq!(v("42"), LimaValue::Int(42));
        assert_eq!(v("-42"), LimaValue::Int(-42));
        // Leading zero is not a number (Core §6.4.1) -> string.
        assert_eq!(v("007"), LimaValue::String("007".into()));
    }

    #[test]
    fn floats() {
        assert_eq!(v("1.5"), LimaValue::Float(1.5));
        assert_eq!(v("-0.5"), LimaValue::Float(-0.5));
        assert_eq!(v("1e10"), LimaValue::Float(1e10));
        assert_eq!(v(".5"), LimaValue::Float(0.5));
    }

    #[test]
    fn norway_problem_does_not_apply() {
        // YAML 1.1's broader implicit-boolean set turns `NO`/`yes`/etc. into
        // booleans; Lima recognises only the literal tokens true/false.
        assert_eq!(v("NO"), LimaValue::String("NO".into()));
        assert_eq!(v("yes"), LimaValue::String("yes".into()));
        assert_eq!(v("off"), LimaValue::String("off".into()));
    }

    #[test]
    fn hex_octal_binary_stay_strings() {
        assert_eq!(v("0x1A"), LimaValue::String("0x1A".into()));
        assert_eq!(v("0o17"), LimaValue::String("0o17".into()));
        assert_eq!(v("0b101"), LimaValue::String("0b101".into()));
    }

    #[test]
    fn iso_dates() {
        let LimaValue::Instant(i) = v("2024-03-01") else {
            panic!("expected instant")
        };
        assert_eq!(i.to_iso_string(), "2024-03-01T00:00:00Z");
        let LimaValue::Instant(i) = v("2024-03-01T09:00:00+02:00") else {
            panic!("expected instant")
        };
        assert_eq!(i.to_iso_string(), "2024-03-01T07:00:00Z");
        let LimaValue::Instant(i) = v("2024-03-01T09:00:00Z") else {
            panic!("expected instant")
        };
        assert_eq!(i.to_iso_string(), "2024-03-01T09:00:00Z");
    }

    #[test]
    fn leap_year_and_month_lengths() {
        assert!(matches!(v("2024-02-29"), LimaValue::Instant(_))); // divisible by 4, not 100
        assert!(matches!(v("2000-02-29"), LimaValue::Instant(_))); // divisible by 400
        assert!(v_strict("1900-02-29").is_err()); // divisible by 100, not 400
        assert_eq!(v("2024-02-30"), LimaValue::String("2024-02-30".into())); // non-strict falls back
    }

    #[test]
    fn year_zero_is_out_of_range() {
        assert_eq!(v("0000-01-01"), LimaValue::String("0000-01-01".into()));
        assert!(v_strict("0000-01-01").is_err());
    }

    #[test]
    fn german_and_slash_dates() {
        let LimaValue::Instant(i) = v("1.3.2024") else {
            panic!("expected instant")
        };
        assert_eq!(i.to_iso_string(), "2024-03-01T00:00:00Z");
        let LimaValue::Instant(i) = v("2024/03/01") else {
            panic!("expected instant")
        };
        assert_eq!(i.to_iso_string(), "2024-03-01T00:00:00Z");
    }

    #[test]
    fn double_quoted_escapes() {
        assert_eq!(v("\"a\\nb\""), LimaValue::String("a\nb".into()));
        assert_eq!(v("\"caf\\u00e9\""), LimaValue::String("café".into()));
        assert!(v_strict("\"\\q\"").is_err());
        // Non-strict leaves an unknown escape untouched.
        assert_eq!(v("\"\\q\""), LimaValue::String("\\q".into()));
    }

    #[test]
    fn single_quoted_has_only_apostrophe_escape() {
        assert_eq!(v("'a\\'b'"), LimaValue::String("a'b".into()));
        assert_eq!(v("'a\\nb'"), LimaValue::String("a\\nb".into())); // no \n handling in single-quoted
    }

    #[test]
    fn plain_strings_and_urls() {
        assert_eq!(v("hello world"), LimaValue::String("hello world".into()));
        assert_eq!(
            v("https://example.com"),
            LimaValue::String("https://example.com".into())
        );
    }

    #[test]
    fn scalar_length_limit() {
        let long = "a".repeat(SCALAR_LENGTH_LIMIT + 1);
        assert!(v_strict(&long).is_err());
        let ok = "a".repeat(SCALAR_LENGTH_LIMIT);
        assert_eq!(v(&ok), LimaValue::String(ok));
    }

    #[test]
    fn strip_comment_is_quote_aware() {
        assert_eq!(strip_comment("value # comment"), "value");
        assert_eq!(strip_comment("\"a # b\" # real comment"), "\"a # b\"");
        assert_eq!(strip_comment("escaped \\# hash"), "escaped # hash");
        assert_eq!(strip_comment("no comment here"), "no comment here");
    }
}
