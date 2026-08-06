//! Lima References 1.0 — layered strictly on top of `core.rs` (Appendix B:
//! reference resolution is exclusively this extension's concern; Core never
//! sees it). Reads the annotated [`PositionedValue`] tree Core produces and
//! performs the two-phase resolution the spec describes (§4): phase 1
//! resolves each top-level key's value in document order against a live,
//! growing snapshot (backward references); phase 2 re-resolves every key
//! against an immutable snapshot of phase 1's results (forward references).
//! Mirrors `js/src/references.ts`.
//!
//! Scoped down from the TS source for this pass:
//! - No `ingestPartialValue` host-object reflection step — Rust's type
//!   system already rules out passing a function/class-instance/accessor
//!   where a [`LimaValue`] is expected, so there's no JS-host boundary to
//!   guard here. [`validate_partial_value`] still enforces every
//!   Lima-specific limit (key length, nesting depth, scalar length,
//!   non-finite rejection) on whatever `LimaValue` partials are passed in.
//! - No reference-free memoization cache (`WeakMap` in TS) — pointer-identity
//!   caching doesn't fit an owned Rust tree the same way; recomputed instead.
//!   Same correctness-first trade-off as `block.rs`'s dropped ASCII fast paths.

use crate::core::parse_core_with_positions;
use crate::errors::{LimaDiagnosticCode as Code, LimaError};
use crate::normalize::NESTING_DEPTH_LIMIT;
use crate::scalars::SCALAR_LENGTH_LIMIT;
use crate::value::{set_mapping, InsertedAt, LimaValue, PositionedValue};

// References §6.2 partial resource limits.
pub const PARTIAL_KEY_LENGTH_LIMIT: usize = 128;
pub const PARTIAL_VALUE_DEPTH_LIMIT: u32 = 16;
pub const PARTIAL_COUNT_LIMIT: usize = 128;
pub const PARTIAL_NAME_LENGTH_LIMIT: usize = 128;
pub const PARTIAL_NODE_LIMIT: usize = 4096;
pub const RESULT_NODE_LIMIT: usize = 65536;

/// Canonical string representation for interpolation (References §3.5.1).
fn canonical_string(v: &LimaValue) -> String {
    match v {
        LimaValue::Null => String::new(),
        LimaValue::Bool(b) => if *b { "true" } else { "false" }.to_string(),
        LimaValue::Instant(i) => i.to_iso_string(),
        LimaValue::String(s) => s.clone(),
        LimaValue::Int(n) => n.to_string(),
        LimaValue::Float(n) => format_canonical_float(*n),
        _ => String::new(),
    }
}

/// ECMAScript's `Number.prototype.toString` switches to exponential
/// notation exactly when `abs(n) >= 1e21` or `0 < abs(n) < 1e-6`; Rust's
/// `Display` for `f64` never does (always fixed notation, however long).
/// Both engines otherwise already produce the same shortest-round-trip
/// digit sequence, and Rust's `{:e}` formatter already omits the `+` sign
/// and leading zeros ECMAScript's own exponent needs stripped — `1e-7`,
/// `1e21`, `1.5e21`, no further cleanup needed either way.
fn format_canonical_float(n: f64) -> String {
    let abs = n.abs();
    if abs != 0.0 && !(1e-6..1e21).contains(&abs) {
        format!("{n:e}")
    } else {
        format!("{n}")
    }
}

// ─── Reference-token grammar (§2.1/§2.2/Appendix B), hand-scanned ─────────

fn is_doc_segment_start(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}
fn is_doc_segment_cont(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b':' || c == b'-'
}
fn is_partial_key_cont(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b':' || c == b'/' || c == b'-'
}

/// Matches a `DOC_PATH` (`SEGMENT(.SEGMENT)*`) at the start of `s`, returns
/// its byte length.
fn match_doc_path(s: &[u8]) -> Option<usize> {
    if s.is_empty() || !is_doc_segment_start(s[0]) {
        return None;
    }
    let mut i = 1;
    while i < s.len() && is_doc_segment_cont(s[i]) {
        i += 1;
    }
    while i < s.len() && s[i] == b'.' && s.get(i + 1).is_some_and(|&c| is_doc_segment_start(c)) {
        i += 2;
        while i < s.len() && is_doc_segment_cont(s[i]) {
            i += 1;
        }
    }
    Some(i)
}

/// Matches a flat `PARTIAL_KEY` at the start of `s`, returns its byte length.
fn match_partial_key(s: &[u8]) -> Option<usize> {
    if s.is_empty() || !is_doc_segment_start(s[0]) {
        return None;
    }
    let mut i = 1;
    while i < s.len() && is_partial_key_cont(s[i]) {
        i += 1;
    }
    Some(i)
}

/// One matched `($path)`/`(%key)` token.
struct RefMatch {
    /// Byte range of the whole `(...)` token, including parens.
    start: usize,
    end: usize,
    is_partial: bool,
    key: String,
}

/// Tries to match a reference token starting exactly at `bytes[start]`.
fn try_match_ref_at(bytes: &[u8], start: usize) -> Option<RefMatch> {
    if bytes.get(start) != Some(&b'(') {
        return None;
    }
    let sigil = *bytes.get(start + 1)?;
    let is_partial = match sigil {
        b'$' => false,
        b'%' => true,
        _ => return None,
    };
    let body_start = start + 2;
    let body = &bytes[body_start..];
    let len = if is_partial {
        match_partial_key(body)
    } else {
        match_doc_path(body)
    }?;
    let close = body_start + len;
    if bytes.get(close) != Some(&b')') {
        return None;
    }
    Some(RefMatch {
        start,
        end: close + 1,
        is_partial,
        key: std::str::from_utf8(&bytes[body_start..close])
            .unwrap()
            .to_string(),
    })
}

/// A pure reference: the *entire* string is exactly one `($path)`/`(%key)`.
fn as_pure_ref(s: &str) -> Option<(bool, String)> {
    let m = try_match_ref_at(s.as_bytes(), 0)?;
    if m.end == s.len() {
        Some((m.is_partial, m.key))
    } else {
        None
    }
}

/// Replaces every `($path)`/`(%key)` occurrence in `s` — string
/// interpolation. `replace_one` gets `(is_partial, key, matched_text)` and
/// returns the replacement text.
fn interpolate(s: &str, mut replace_one: impl FnMut(bool, &str, &str) -> String) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'(' {
            if let Some(m) = try_match_ref_at(bytes, i) {
                let matched = &s[m.start..m.end];
                out.push_str(&replace_one(m.is_partial, &m.key, matched));
                i = m.end;
                continue;
            }
        }
        // Advance by one full character, not one byte, to stay on UTF-8
        // boundaries for non-ASCII content between reference tokens.
        let ch = s[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

// ─── PositionedValue-level helpers ─────────────────────────────────────────

fn get_nested_value_p<'a>(
    root: &'a [(String, PositionedValue)],
    path: &str,
) -> Option<&'a PositionedValue> {
    let mut parts = path.split('.');
    let first = parts.next()?;
    let mut cur = &root.iter().find(|(k, _)| k == first)?.1;
    for part in parts {
        let PositionedValue::Mapping { entries, .. } = cur else {
            return None;
        };
        cur = &entries.iter().find(|(k, _)| k == part)?.1;
    }
    Some(cur)
}

/// A reference is only resolved from a target that is itself reference-free
/// (§4). Quoted strings are always free (§2.3); partial-derived values are
/// always free too (see [`partial_to_positioned`]).
fn is_reference_free_p(v: &PositionedValue) -> bool {
    match v {
        PositionedValue::String { value, quoted, .. } => {
            *quoted || (!value.contains("($") && !value.contains("(%"))
        }
        PositionedValue::Array { items, .. } => items.iter().all(is_reference_free_p),
        PositionedValue::Mapping { entries, .. } => {
            entries.iter().all(|(_, c)| is_reference_free_p(c))
        }
        _ => true,
    }
}

/// Wraps a partial's already-validated [`LimaValue`] into the annotated
/// representation, with every string leaf marked permanently `quoted`
/// (§3.8: partial content is never traversed for references — no
/// rediscovering a reference-like substring inside it).
fn partial_to_positioned(v: &LimaValue, line: u32) -> PositionedValue {
    match v {
        LimaValue::Null => PositionedValue::Null {
            line,
            inserted_at: None,
        },
        LimaValue::Bool(b) => PositionedValue::Bool {
            value: *b,
            line,
            inserted_at: None,
        },
        LimaValue::Int(n) => PositionedValue::Int {
            value: *n,
            line,
            inserted_at: None,
        },
        LimaValue::Float(n) => PositionedValue::Float {
            value: *n,
            line,
            inserted_at: None,
        },
        LimaValue::String(s) => PositionedValue::String {
            value: s.clone(),
            line,
            quoted: true,
            inserted_at: None,
        },
        LimaValue::Instant(i) => PositionedValue::Instant {
            value: *i,
            line,
            inserted_at: None,
        },
        LimaValue::Array(items) => PositionedValue::Array {
            items: items
                .iter()
                .map(|i| partial_to_positioned(i, line))
                .collect(),
            line,
            inserted_at: None,
        },
        LimaValue::Mapping(entries) => PositionedValue::Mapping {
            entries: entries
                .iter()
                .map(|(k, c)| (k.clone(), partial_to_positioned(c, line)))
                .collect(),
            line,
            inserted_at: None,
        },
    }
}

/// References §6.2: validates a partial value against the Lima-specific
/// resource limits (key length, nesting depth, scalar length, non-finite
/// floats). Unlike TS's `ingestPartialValue`, this never converts a value —
/// callers already have a `LimaValue`, Rust's type system rules out the
/// host-reflection cases TS has to reject at runtime (functions, class
/// instances, accessor properties, cycles through untyped objects).
fn validate_partial_value(
    v: &LimaValue,
    partial_name: &str,
    path: &str,
    depth: u32,
) -> Result<(), LimaError> {
    let invalid = |reason: String| -> LimaError {
        LimaError {
            code: Code::InvalidPartial,
            line: None,
            key: None,
            message: format!(
                "Lima: invalid partial \"{partial_name}\" at path \"{path}\": {reason}"
            ),
        }
    };
    match v {
        LimaValue::Float(n) if !n.is_finite() => Err(invalid("non-finite number".to_string())),
        LimaValue::String(s) if s.chars().count() > SCALAR_LENGTH_LIMIT => Err(invalid(format!(
            "string exceeds maximum length of {SCALAR_LENGTH_LIMIT} code points"
        ))),
        LimaValue::Instant(i) => {
            let (year, _, _) = crate::value::civil_from_days(i.epoch_seconds.div_euclid(86_400));
            if !(1..=9999).contains(&year) {
                Err(invalid(format!(
                    "date year {year} outside the range 0001-9999"
                )))
            } else {
                Ok(())
            }
        }
        LimaValue::Array(items) => {
            if depth >= PARTIAL_VALUE_DEPTH_LIMIT {
                return Err(invalid(format!(
                    "nesting depth exceeds maximum of {PARTIAL_VALUE_DEPTH_LIMIT}"
                )));
            }
            for (i, item) in items.iter().enumerate() {
                if matches!(item, LimaValue::Array(_)) {
                    return Err(LimaError {
                        code: Code::InvalidPartial,
                        line: None,
                        key: None,
                        message: format!(
                            "Lima: invalid partial \"{partial_name}\" at path \"{path}[{i}]\": nested arrays are not supported"
                        ),
                    });
                }
                validate_partial_value(item, partial_name, &format!("{path}[{i}]"), depth + 1)?;
            }
            Ok(())
        }
        LimaValue::Mapping(entries) => {
            if depth >= PARTIAL_VALUE_DEPTH_LIMIT {
                return Err(invalid(format!(
                    "nesting depth exceeds maximum of {PARTIAL_VALUE_DEPTH_LIMIT}"
                )));
            }
            for (k, c) in entries {
                if k.chars().count() > PARTIAL_KEY_LENGTH_LIMIT {
                    return Err(LimaError {
                        code: Code::InvalidPartial,
                        line: None,
                        key: None,
                        message: format!(
                            "Lima: invalid partial \"{partial_name}\" at path \"{path}.{k}\": key exceeds maximum length of {PARTIAL_KEY_LENGTH_LIMIT} code points"
                        ),
                    });
                }
                validate_partial_value(c, partial_name, &format!("{path}.{k}"), depth + 1)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

/// §5: of every reference-resolution error encountered during a single
/// resolution pass, only the one at the lowest source line is ultimately
/// thrown — `<` (not `<=`) preserves "first diagnostic reported at a given
/// minimum line wins" among ties.
struct ResolutionContext {
    best: Option<LimaError>,
    /// §6.2 final scalar-length limit after interpolation — a hard error
    /// in both modes, reported through here (rather than a `Result`
    /// return) to keep `resolve_tree` infallible, matching the TS source's
    /// own "collect diagnostics, resolve unconditionally" shape.
    hard_error: Option<LimaError>,
}

impl ResolutionContext {
    fn report(&mut self, err: LimaError) {
        let line = err.line.unwrap_or(0);
        if self
            .best
            .as_ref()
            .is_none_or(|b| line < b.line.unwrap_or(0))
        {
            self.best = Some(err);
        }
    }
}

/// Recursively resolves reference-shaped string leaves in `node` against
/// `lookup` — shared by both resolution phases (§4.1's live backward pass
/// and §4.2's snapshot-based forward pass differ only in which `lookup` map
/// and source tree they're applied to, not in the resolution logic).
fn resolve_tree(
    node: &PositionedValue,
    lookup: &[(String, PositionedValue)],
    partials: &[(String, PositionedValue)],
    ctx: &mut ResolutionContext,
) -> PositionedValue {
    if !matches!(node, PositionedValue::String { .. }) && is_reference_free_p(node) {
        return node.clone();
    }

    if let PositionedValue::String {
        value: val,
        line,
        quoted,
        ..
    } = node
    {
        if *quoted {
            return node.clone();
        }
        let line = *line;

        // Pure reference: entire value is exactly one ($path) or (%key).
        if let Some((is_partial, key)) = as_pure_ref(val) {
            let inserted_at = InsertedAt {
                line,
                token: val.clone(),
            };
            if is_partial {
                if let Some(target) = partials.iter().find(|(k, _)| k == &key) {
                    return with_inserted_at(target.1.clone(), inserted_at);
                }
            } else if let Some(target) = get_nested_value_p(lookup, &key) {
                if is_reference_free_p(target) {
                    return with_inserted_at(target.clone(), inserted_at);
                }
            }
            // Unresolved (or target not yet reference-free) — leave unchanged.
        }

        // String interpolation: replace all ($path) / (%key) occurrences.
        if val.contains("($") || val.contains("(%") {
            let replaced = interpolate(val, |is_partial, key, matched| {
                let target = if is_partial {
                    partials.iter().find(|(k, _)| k == key).map(|(_, v)| v)
                } else {
                    get_nested_value_p(lookup, key).filter(|t| is_reference_free_p(t))
                };
                let Some(target) = target else {
                    return matched.to_string();
                };
                match target {
                    PositionedValue::Mapping { .. } => {
                        ctx.report(LimaError::new(
                            Code::InvalidInterpolation, line,
                            format!("Lima: invalid interpolation of \"{matched}\" at line {line}: mapping cannot be interpolated into a string"),
                        ));
                        matched.to_string()
                    }
                    PositionedValue::Array { items, .. } => {
                        if items.iter().any(|i| {
                            matches!(
                                i,
                                PositionedValue::Array { .. } | PositionedValue::Mapping { .. }
                            )
                        }) {
                            ctx.report(LimaError::new(
                                Code::InvalidInterpolation, line,
                                format!("Lima: invalid interpolation of \"{matched}\" at line {line}: array contains a nested array or mapping"),
                            ));
                            return matched.to_string();
                        }
                        items
                            .iter()
                            .map(|i| canonical_string(&i.to_plain_value()))
                            .collect::<Vec<_>>()
                            .join(", ")
                    }
                    other => canonical_string(&other.to_plain_value()),
                }
            });
            // §6.2 final scalar-length limit: interpolation can grow a
            // string past the limit even when neither the raw text nor the
            // interpolated target individually violated it — a hard error
            // in both modes, thrown immediately (never part of the ordered
            // diagnostics set) via `ctx.hard_error`, checked right after
            // resolution finishes in `parse_references`.
            if replaced.chars().count() > SCALAR_LENGTH_LIMIT && ctx.hard_error.is_none() {
                ctx.hard_error = Some(LimaError::new(
                    Code::ResourceLimit, line,
                    format!("Lima: scalar exceeds maximum length of {SCALAR_LENGTH_LIMIT} code points at line {line}"),
                ));
            }
            return PositionedValue::String {
                value: replaced,
                line,
                quoted: false,
                inserted_at: None,
            };
        }

        return node.clone();
    }

    match node {
        PositionedValue::Array { items, line, inserted_at } => PositionedValue::Array {
            line: *line,
            inserted_at: inserted_at.clone(),
            items: items
                .iter()
                .map(|item| {
                    let resolved = resolve_tree(item, lookup, partials, ctx);
                    // References Appendix: array spreading was removed; a
                    // nested array produced by reference insertion violates
                    // Core §7.2 (sequences contain scalars or mappings
                    // only) — throws in BOTH modes.
                    if matches!(item, PositionedValue::String { .. }) && matches!(resolved, PositionedValue::Array { .. }) {
                        if let PositionedValue::String { value, line, .. } = item {
                            ctx.report(LimaError::new(
                                Code::InvalidReferenceShape, *line,
                                format!("Lima: reference \"{value}\" resolves to an array, which cannot be inserted as a sequence item at line {line}"),
                            ));
                        }
                        item.clone()
                    } else {
                        resolved
                    }
                })
                .collect(),
        },
        PositionedValue::Mapping { entries, line, inserted_at } => PositionedValue::Mapping {
            line: *line,
            inserted_at: inserted_at.clone(),
            entries: entries.iter().map(|(k, c)| (k.clone(), resolve_tree(c, lookup, partials, ctx))).collect(),
        },
        other => other.clone(), // null/bool/int/float/instant — nothing to resolve
    }
}

fn with_inserted_at(mut v: PositionedValue, inserted_at: InsertedAt) -> PositionedValue {
    // R-112: stamped on the copy's root only — descendants keep whatever
    // `inserted_at` they already carried from an earlier, more deeply
    // nested resolution.
    match &mut v {
        PositionedValue::Null {
            inserted_at: ia, ..
        }
        | PositionedValue::Bool {
            inserted_at: ia, ..
        }
        | PositionedValue::Int {
            inserted_at: ia, ..
        }
        | PositionedValue::Float {
            inserted_at: ia, ..
        }
        | PositionedValue::String {
            inserted_at: ia, ..
        }
        | PositionedValue::Instant {
            inserted_at: ia, ..
        }
        | PositionedValue::Array {
            inserted_at: ia, ..
        }
        | PositionedValue::Mapping {
            inserted_at: ia, ..
        } => *ia = Some(inserted_at),
    }
    v
}

// ─── Finalization: depth, node count, native conversion in one pass ───────

struct FinalizedValue {
    native: LimaValue,
    node_count: usize,
    depth: u32,
    deepest_participants: Vec<InsertedAt>,
}

fn finalize_positioned(v: &PositionedValue) -> FinalizedValue {
    let own: Vec<InsertedAt> = v.inserted_at().cloned().into_iter().collect();
    match v {
        PositionedValue::Array { items, .. } => {
            if items.is_empty() {
                return FinalizedValue {
                    native: LimaValue::Array(vec![]),
                    node_count: 1,
                    depth: 1,
                    deepest_participants: own,
                };
            }
            let mut native = Vec::with_capacity(items.len());
            let mut node_count = 1;
            let mut max_depth: i64 = -1;
            let mut child_participants: Vec<InsertedAt> = Vec::new();
            for item in items {
                let r = finalize_positioned(item);
                native.push(r.native);
                node_count += r.node_count;
                match (r.depth as i64).cmp(&max_depth) {
                    std::cmp::Ordering::Greater => {
                        max_depth = r.depth as i64;
                        child_participants = r.deepest_participants;
                    }
                    std::cmp::Ordering::Equal => child_participants.extend(r.deepest_participants),
                    std::cmp::Ordering::Less => {}
                }
            }
            let mut participants = own;
            participants.extend(child_participants);
            FinalizedValue {
                native: LimaValue::Array(native),
                node_count,
                depth: (max_depth + 1) as u32,
                deepest_participants: participants,
            }
        }
        PositionedValue::Mapping { entries, .. } => {
            if entries.is_empty() {
                return FinalizedValue {
                    native: LimaValue::Mapping(vec![]),
                    node_count: 1,
                    depth: 1,
                    deepest_participants: own,
                };
            }
            let mut native = Vec::with_capacity(entries.len());
            let mut node_count = 1;
            let mut max_depth: i64 = -1;
            let mut child_participants: Vec<InsertedAt> = Vec::new();
            for (k, c) in entries {
                let r = finalize_positioned(c);
                native.push((k.clone(), r.native));
                node_count += r.node_count;
                match (r.depth as i64).cmp(&max_depth) {
                    std::cmp::Ordering::Greater => {
                        max_depth = r.depth as i64;
                        child_participants = r.deepest_participants;
                    }
                    std::cmp::Ordering::Equal => child_participants.extend(r.deepest_participants),
                    std::cmp::Ordering::Less => {}
                }
            }
            let mut participants = own;
            participants.extend(child_participants);
            FinalizedValue {
                native: LimaValue::Mapping(native),
                node_count,
                depth: (max_depth + 1) as u32,
                deepest_participants: participants,
            }
        }
        _ => FinalizedValue {
            native: v.to_plain_value(),
            node_count: 1,
            depth: 0,
            deepest_participants: own,
        },
    }
}

fn earliest_participant(participants: &[InsertedAt]) -> Option<&InsertedAt> {
    participants.iter().min_by_key(|p| p.line)
}

fn collect_all_participants(v: &PositionedValue, acc: &mut Vec<InsertedAt>) {
    if let Some(ia) = v.inserted_at() {
        acc.push(ia.clone());
    }
    match v {
        PositionedValue::Array { items, .. } => {
            items.iter().for_each(|i| collect_all_participants(i, acc))
        }
        PositionedValue::Mapping { entries, .. } => entries
            .iter()
            .for_each(|(_, c)| collect_all_participants(c, acc)),
        _ => {}
    }
}

// ─── Public API ─────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct ReferencesOptions {
    /// Named values available via `(%key)` references.
    pub partials: Vec<(String, LimaValue)>,
    pub strict: bool,
}

pub fn parse_references(
    front_matter: &str,
    options: ReferencesOptions,
) -> Result<LimaValue, LimaError> {
    let strict = options.strict;

    // §6.2/R-114: partials are validated and deep-copied before document
    // parsing begins — this must run even for an empty document. Partial
    // errors carry a value path, never a document line, so they throw
    // directly rather than joining the ordered diagnostics collected below.
    if options.partials.len() > PARTIAL_COUNT_LIMIT {
        return Err(LimaError {
            code: Code::InvalidPartial,
            line: None,
            key: None,
            message: format!("Lima: too many partials (max {PARTIAL_COUNT_LIMIT})"),
        });
    }
    for (name, _) in &options.partials {
        if name.chars().count() > PARTIAL_NAME_LENGTH_LIMIT {
            return Err(LimaError {
                code: Code::InvalidPartial,
                line: None,
                key: None,
                message: format!(
                    "Lima: invalid partial \"{name}\" at path \"{name}\": name exceeds maximum length of {PARTIAL_NAME_LENGTH_LIMIT} code points"
                ),
            });
        }
    }
    for (name, value) in &options.partials {
        validate_partial_value(value, name, name, 0)?;
    }
    let total_partial_nodes: usize = options
        .partials
        .iter()
        .map(|(_, v)| count_lima_nodes(v))
        .sum();
    if total_partial_nodes > PARTIAL_NODE_LIMIT {
        return Err(LimaError {
            code: Code::InvalidPartial,
            line: None,
            key: None,
            message: format!(
                "Lima: partials exceed the combined maximum of {PARTIAL_NODE_LIMIT} value nodes"
            ),
        });
    }
    let partials_positioned: Vec<(String, PositionedValue)> = options
        .partials
        .iter()
        .map(|(name, v)| (name.clone(), partial_to_positioned(v, 0)))
        .collect();

    let root = parse_core_with_positions(front_matter, strict)?;
    let mut ctx = ResolutionContext {
        best: None,
        hard_error: None,
    };

    let has_refs = front_matter.contains("($") || front_matter.contains("(%");
    let final_map: Vec<(String, PositionedValue)> = if !has_refs {
        root.clone()
    } else {
        // Phase 1 (§4.1): resolve each top-level key's value in document
        // order against a live, growing snapshot of already-processed keys.
        let mut phase1_live: Vec<(String, PositionedValue)> = Vec::new();
        // §3.7/§4 one-hop limit: a top-level key whose OWN inline value was
        // itself a pure reference token must never be usable as another
        // key's hop target via its (possibly already-resolved) live value —
        // only its original token text is a valid phase-2 lookup target.
        let mut original_pure_ref_text: Vec<(String, String)> = Vec::new();
        for (key, node) in &root {
            if let PositionedValue::String {
                value,
                quoted: false,
                ..
            } = node
            {
                if as_pure_ref(value).is_some() {
                    original_pure_ref_text.push((key.clone(), value.clone()));
                }
            }
            let resolved = resolve_tree(node, &phase1_live, &partials_positioned, &mut ctx);
            set_mapping(&mut phase1_live, key.clone(), resolved);
        }

        // Phase 2 (§4.2): re-resolve every key's phase-1 value against a
        // snapshot immutable for the whole phase — this is what catches
        // forward references.
        let phase1_snapshot: Vec<(String, PositionedValue)> = phase1_live
            .iter()
            .map(|(key, value)| {
                if let Some((_, text)) = original_pure_ref_text.iter().find(|(k, _)| k == key) {
                    let line = root.iter().find(|(k, _)| k == key).unwrap().1.line();
                    (
                        key.clone(),
                        PositionedValue::String {
                            value: text.clone(),
                            line,
                            quoted: false,
                            inserted_at: None,
                        },
                    )
                } else {
                    (key.clone(), value.clone())
                }
            })
            .collect();

        root.iter()
            .map(|(key, _)| {
                let live_value = &phase1_live.iter().find(|(k, _)| k == key).unwrap().1;
                (
                    key.clone(),
                    resolve_tree(live_value, &phase1_snapshot, &partials_positioned, &mut ctx),
                )
            })
            .collect()
    };

    // Interpolation's own scalar-length overflow is a hard error, thrown
    // immediately — takes precedence over the ordered diagnostics below.
    if let Some(e) = ctx.hard_error {
        return Err(e);
    }

    // Strict mode: collect every reference still unresolved after both
    // phases.
    if strict {
        fn scan_unresolved(v: &PositionedValue, ctx: &mut ResolutionContext) {
            match v {
                PositionedValue::String {
                    value,
                    quoted: false,
                    line,
                    ..
                } => {
                    if value.contains("($") || value.contains("(%") {
                        if let Some(m) =
                            try_match_ref_at(value.as_bytes(), value.find('(').unwrap_or(0))
                        {
                            let token = &value[m.start..m.end];
                            ctx.report(LimaError::new(
                                Code::UnresolvedReference,
                                *line,
                                format!("Lima: unresolved reference \"{token}\" at line {line}"),
                            ));
                        } else if let Some(paren) = value.find('(') {
                            // Fall back to a scan from the first '(' anywhere in
                            // the string, matching the TS source's simpler
                            // `/\(([%$])([^)]+)\)/` search (not anchored to a
                            // grammar-valid match) for the diagnostic token text.
                            if let Some(m) = try_match_ref_at(value.as_bytes(), paren) {
                                let token = &value[m.start..m.end];
                                ctx.report(LimaError::new(
                                    Code::UnresolvedReference,
                                    *line,
                                    format!(
                                        "Lima: unresolved reference \"{token}\" at line {line}"
                                    ),
                                ));
                            }
                        }
                    }
                }
                PositionedValue::Array { items, .. } => {
                    items.iter().for_each(|i| scan_unresolved(i, ctx))
                }
                PositionedValue::Mapping { entries, .. } => {
                    entries.iter().for_each(|(_, c)| scan_unresolved(c, ctx))
                }
                _ => {}
            }
        }
        for (_, v) in &final_map {
            scan_unresolved(v, &mut ctx);
        }
    }

    // §5: of every reference-resolution error collected above, the one at
    // the lowest source line is thrown; the rest are discarded.
    if let Some(e) = ctx.best {
        return Err(e);
    }

    // Depth (Core §9, re-checked on the final POST-substitution tree),
    // node count (§6.2), and the native result itself all come out of one
    // pass over `final_map`.
    let final_results: Vec<(String, FinalizedValue)> = final_map
        .iter()
        .map(|(k, v)| (k.clone(), finalize_positioned(v)))
        .collect();

    let depth = final_results
        .iter()
        .map(|(_, r)| r.depth)
        .max()
        .unwrap_or(0);
    if depth > NESTING_DEPTH_LIMIT as u32 {
        let mut participants = Vec::new();
        for (_, r) in final_results.iter().filter(|(_, r)| r.depth == depth) {
            participants.extend(r.deepest_participants.iter().cloned());
        }
        let winner = earliest_participant(&participants);
        return Err(LimaError {
            code: Code::ResourceLimit,
            line: Some(winner.map(|w| w.line).unwrap_or(1)),
            key: None,
            message: match winner {
                Some(w) => format!("Lima: nesting depth exceeds maximum of {NESTING_DEPTH_LIMIT} at line {}: \"{}\"", w.line, w.token),
                None => format!("Lima: nesting depth exceeds maximum of {NESTING_DEPTH_LIMIT} at line 1"),
            },
        });
    }

    // §6.2: total node count of the final result tree, both modes.
    let mut total_result_nodes = 1; // the root mapping itself counts as one node
    for (_, r) in &final_results {
        total_result_nodes += r.node_count;
    }
    if total_result_nodes > RESULT_NODE_LIMIT {
        let mut participants = Vec::new();
        for (_, v) in &final_map {
            collect_all_participants(v, &mut participants);
        }
        let winner = earliest_participant(&participants);
        return Err(LimaError {
            code: Code::ResourceLimit,
            line: Some(winner.map(|w| w.line).unwrap_or(1)),
            key: None,
            message: match winner {
                Some(w) => format!("Lima: result exceeds maximum size of {RESULT_NODE_LIMIT} total nodes at line {}: \"{}\"", w.line, w.token),
                None => format!("Lima: result exceeds maximum size of {RESULT_NODE_LIMIT} total nodes at line 1"),
            },
        });
    }

    Ok(LimaValue::Mapping(
        final_results
            .into_iter()
            .map(|(k, r)| (k, r.native))
            .collect(),
    ))
}

/// [`count_nodes`]'s `LimaValue` counterpart, for partial-node budgeting
/// (partials are validated before ever becoming `PositionedValue`).
fn count_lima_nodes(v: &LimaValue) -> usize {
    match v {
        LimaValue::Array(items) => 1 + items.iter().map(count_lima_nodes).sum::<usize>(),
        LimaValue::Mapping(entries) => {
            1 + entries
                .iter()
                .map(|(_, c)| count_lima_nodes(c))
                .sum::<usize>()
        }
        _ => 1,
    }
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
            .unwrap_or_else(|| panic!("missing key {key:?}"))
            .1
    }

    fn parse(input: &str) -> LimaValue {
        parse_references(input, ReferencesOptions::default()).unwrap()
    }

    #[test]
    fn document_without_references_passes_through() {
        let v = parse("title: Hello\ncount: 3\n");
        assert_eq!(get(&v, "title"), &LimaValue::String("Hello".into()));
        assert_eq!(get(&v, "count"), &LimaValue::Int(3));
    }

    #[test]
    fn backward_document_reference() {
        let v = parse("a: 1\nb: ($a)\n");
        assert_eq!(get(&v, "a"), &LimaValue::Int(1));
        assert_eq!(get(&v, "b"), &LimaValue::Int(1));
    }

    #[test]
    fn forward_document_reference() {
        let v = parse("a: ($b)\nb: 2\n");
        assert_eq!(get(&v, "a"), &LimaValue::Int(2));
        assert_eq!(get(&v, "b"), &LimaValue::Int(2));
    }

    #[test]
    fn nested_path_reference() {
        let v = parse("author:\n  name: Alice\ncredit: ($author.name)\n");
        assert_eq!(get(&v, "credit"), &LimaValue::String("Alice".into()));
    }

    #[test]
    fn string_interpolation() {
        let v = parse("name: Alice\ngreeting: Hello, ($name)!\n");
        assert_eq!(
            get(&v, "greeting"),
            &LimaValue::String("Hello, Alice!".into())
        );
    }

    #[test]
    fn quoted_strings_are_never_reference_sites() {
        let v = parse("a: 1\nb: \"($a)\"\n");
        assert_eq!(get(&v, "b"), &LimaValue::String("($a)".into()));
    }

    #[test]
    fn unresolved_reference_strict_throws() {
        let err = parse_references(
            "a: ($missing)",
            ReferencesOptions {
                strict: true,
                ..Default::default()
            },
        );
        assert!(err.is_err());
    }

    #[test]
    fn unresolved_reference_non_strict_stays_literal() {
        let v = parse("a: ($missing)\n");
        assert_eq!(get(&v, "a"), &LimaValue::String("($missing)".into()));
    }

    #[test]
    fn partial_reference() {
        let v = parse_references(
            "a: (%greeting)",
            ReferencesOptions {
                partials: vec![("greeting".to_string(), LimaValue::String("hi".into()))],
                strict: false,
            },
        )
        .unwrap();
        assert_eq!(get(&v, "a"), &LimaValue::String("hi".into()));
    }

    #[test]
    fn array_reference_into_sequence_item_throws() {
        let err = parse_references(
            "list:\n  values: [1, 2]\nitems:\n  - ($list.values)\n",
            ReferencesOptions {
                strict: true,
                ..Default::default()
            },
        );
        assert!(err.is_err());
    }
}
