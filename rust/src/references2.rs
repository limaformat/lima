//! Lima References 2.0 resolver. The frozen 1.0 implementation remains in
//! `references.rs` solely for its conformance tests.

use crate::core::{parse_core, parse_core_with_positions_options, CoreOptions};
use crate::errors::{Diagnostic, LimaDiagnosticCode as Code, LimaError};
use crate::normalize::{begin_warning_collection, finish_warning_collection, NESTING_DEPTH_LIMIT};
use crate::scalars::SCALAR_LENGTH_LIMIT;
use crate::value::{InsertedAt, LimaValue, PositionedValue, StringSourceSpan};
use std::collections::{HashMap, HashSet};

const MAX_EDGES: u8 = 3;
const PARTIAL_KEY_LENGTH_LIMIT: usize = 128;
const PARTIAL_VALUE_DEPTH_LIMIT: u32 = 16;
const PARTIAL_COUNT_LIMIT: usize = 128;
const PARTIAL_NAME_LENGTH_LIMIT: usize = 128;
const PARTIAL_NODE_LIMIT: usize = 4096;
const RESULT_NODE_LIMIT: usize = 65536;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ParseMode {
    #[default]
    References,
    Core,
}

#[derive(Default)]
pub struct ParseOptions {
    pub mode: ParseMode,
    /// `None` means omitted. `Some(vec![])` is deliberately distinguishable
    /// so core mode can reject even an explicitly empty partials option.
    pub partials: Option<Vec<(String, LimaValue)>>,
    pub strict: bool,
    pub on_warning: Option<Box<dyn FnMut(Diagnostic)>>,
}

#[derive(Debug, Clone)]
struct Token {
    text: String,
    start: usize,
    line: u32,
    offset: usize,
    document_path: Option<String>,
    partial_path: Option<String>,
}

fn initial(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}
fn segment_char(c: u8) -> bool {
    initial(c) || c == b':' || c == b'-'
}
fn partial_char(c: u8) -> bool {
    segment_char(c) || c == b'/'
}

fn scan_component(bytes: &[u8], mut i: usize, partial: bool) -> Option<usize> {
    if !bytes.get(i).is_some_and(|c| initial(*c)) {
        return None;
    }
    i += 1;
    while bytes.get(i).is_some_and(|c| {
        if partial {
            partial_char(*c)
        } else {
            segment_char(*c)
        }
    }) {
        i += 1;
    }
    Some(i)
}

fn scan_path(bytes: &[u8], mut i: usize, partial: bool) -> Option<usize> {
    i = scan_component(bytes, i, partial)?;
    while bytes.get(i) == Some(&b'.') {
        let next = scan_component(bytes, i + 1, false)?;
        i = next;
    }
    Some(i)
}

fn scan_tokens(
    value: &str,
    first_line: u32,
    source_spans: Option<&[StringSourceSpan]>,
) -> Vec<Token> {
    let bytes = value.as_bytes();
    let mut result = Vec::new();
    let mut i = 0;
    let mut line = first_line;
    let mut line_start = 0;
    while i < bytes.len() {
        if bytes[i] == b'\n' {
            line += 1;
            line_start = i + 1;
            i += 1;
            continue;
        }
        let (body, close, partial) = if bytes.get(i..i + 2) == Some(b"${") {
            (i + 2, b'}', false)
        } else if bytes.get(i..i + 2) == Some(b"$(") {
            (i + 2, b')', true)
        } else {
            i += value[i..].chars().next().unwrap().len_utf8();
            continue;
        };
        if let Some(end) = scan_path(bytes, body, partial) {
            if bytes.get(end) == Some(&close) {
                let path = value[body..end].to_string();
                let text = value[i..=end].to_string();
                let source =
                    source_spans.and_then(|spans| spans.iter().rev().find(|span| span.start <= i));
                result.push(Token {
                    text,
                    start: i,
                    line: source.map_or(line, |s| s.line),
                    offset: source.map_or_else(
                        || value[line_start..i].chars().count(),
                        |s| s.source_offset + value[s.start..i].chars().count(),
                    ),
                    document_path: (!partial).then_some(path.clone()),
                    partial_path: partial.then_some(path),
                });
                i = end + 1;
                continue;
            }
        }
        i += 1;
    }
    result
}

fn get_mapping<'a>(
    entries: &'a [(String, PositionedValue)],
    key: &str,
) -> Option<&'a PositionedValue> {
    entries.iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

fn lookup_path<'a>(
    mut current: Option<&'a PositionedValue>,
    segments: &[&str],
) -> Option<&'a PositionedValue> {
    for segment in segments {
        let PositionedValue::Mapping { entries, .. } = current? else {
            return None;
        };
        current = get_mapping(entries, segment);
    }
    current
}

fn document_target<'a>(
    document: &'a [(String, PositionedValue)],
    path: &'a str,
) -> Option<(&'a PositionedValue, Vec<&'a str>)> {
    let segments: Vec<&str> = path.split('.').collect();
    let mut current = get_mapping(document, segments[0])?;
    let mut index = 1;
    while index < segments.len() {
        let PositionedValue::Mapping { entries, .. } = current else {
            break;
        };
        let child = get_mapping(entries, segments[index])?;
        current = child;
        index += 1;
    }
    Some((current, segments[index..].to_vec()))
}

fn lookup_partial<'a>(
    partials: &'a [(String, PositionedValue)],
    path: &str,
) -> Option<&'a PositionedValue> {
    let (name, tail) = path
        .split_once('.')
        .map_or((path, None), |(a, b)| (a, Some(b)));
    let root = partials.iter().find(|(k, _)| k == name).map(|(_, v)| v)?;
    tail.map_or(Some(root), |p| {
        lookup_path(Some(root), &p.split('.').collect::<Vec<_>>())
    })
}

fn canonical_float(n: f64) -> String {
    let abs = n.abs();
    if abs != 0.0 && !(1e-6..1e21).contains(&abs) {
        format!("{n:e}")
    } else {
        format!("{n}")
    }
}

fn canonical(value: &PositionedValue) -> String {
    match value {
        PositionedValue::Null { .. } => String::new(),
        PositionedValue::Bool { value, .. } => value.to_string(),
        PositionedValue::Int { value, .. } => value.to_string(),
        PositionedValue::Float { value, .. } => canonical_float(*value),
        PositionedValue::String { value, .. } => value.clone(),
        PositionedValue::Instant { value, .. } => value.to_iso_string(),
        _ => String::new(),
    }
}

fn copied_with_insertion(value: &PositionedValue, token: &Token) -> PositionedValue {
    let mut copy = value.clone();
    let mark = Some(InsertedAt {
        line: token.line,
        offset: token.offset,
        token: token.text.clone(),
    });
    match &mut copy {
        PositionedValue::Null { inserted_at, .. }
        | PositionedValue::Bool { inserted_at, .. }
        | PositionedValue::Int { inserted_at, .. }
        | PositionedValue::Float { inserted_at, .. }
        | PositionedValue::String { inserted_at, .. }
        | PositionedValue::Instant { inserted_at, .. }
        | PositionedValue::Array { inserted_at, .. }
        | PositionedValue::Mapping { inserted_at, .. } => *inserted_at = mark,
    }
    copy
}

#[derive(Clone)]
struct Resolution {
    value: PositionedValue,
    complete: bool,
    unresolved: Vec<Token>,
}

struct Context {
    diagnostics: Vec<(u32, usize, LimaError)>,
    cache: HashMap<(usize, u8), Resolution>,
}

fn token_error(code: Code, token: &Token, message: String) -> LimaError {
    let mut error = LimaError::diagnostic(code, message, Some(token.line));
    error.token = Some(token.text.clone().into_boxed_str());
    error.column = Some(token.offset as u32 + 1);
    error
}

fn add_error(ctx: &mut Context, token: &Token, code: Code, detail: &str) {
    let message = match code {
        Code::UnresolvedReference => format!(
            "Lima: unresolved reference \"{}\" at line {}",
            token.text, token.line
        ),
        Code::InvalidInterpolation => format!(
            "Lima: invalid interpolation of \"{}\" at line {}: {detail}",
            token.text, token.line
        ),
        Code::InvalidReferenceShape => format!(
            "Lima: reference \"{}\" has invalid shape at line {}: {detail}",
            token.text, token.line
        ),
        Code::ResourceLimit => format!("Lima: {detail} at line {}", token.line),
        _ => format!("Lima: {detail} at line {}", token.line),
    };
    ctx.diagnostics
        .push((token.line, token.offset, token_error(code, token, message)));
}

fn scalar_text(value: &PositionedValue, token: &Token, ctx: &mut Context) -> Option<String> {
    match value {
        PositionedValue::Mapping { .. } => {
            add_error(
                ctx,
                token,
                Code::InvalidInterpolation,
                "mapping cannot be interpolated into a string",
            );
            None
        }
        PositionedValue::Array { items, .. } => {
            if items.iter().any(|v| {
                matches!(
                    v,
                    PositionedValue::Array { .. } | PositionedValue::Mapping { .. }
                )
            }) {
                add_error(
                    ctx,
                    token,
                    Code::InvalidInterpolation,
                    "array contains a nested array or mapping",
                );
                None
            } else {
                Some(items.iter().map(canonical).collect::<Vec<_>>().join(", "))
            }
        }
        _ => Some(canonical(value)),
    }
}

fn target<'a>(
    token: &'a Token,
    document: &'a [(String, PositionedValue)],
    partials: &'a [(String, PositionedValue)],
) -> Option<(&'a PositionedValue, Vec<&'a str>)> {
    if let Some(path) = &token.document_path {
        document_target(document, path)
    } else {
        lookup_partial(partials, token.partial_path.as_ref().unwrap()).map(|v| (v, Vec::new()))
    }
}

fn resolve_node(
    node: &PositionedValue,
    document: &[(String, PositionedValue)],
    partials: &[(String, PositionedValue)],
    remaining: u8,
    stack: &mut HashSet<usize>,
    ctx: &mut Context,
) -> Resolution {
    let identity = node as *const PositionedValue as usize;
    if stack.len() > 1 {
        if let Some(cached) = ctx.cache.get(&(identity, remaining)) {
            return cached.clone();
        }
    }
    let result = match node {
        PositionedValue::Array {
            items,
            line,
            inserted_at,
        } => {
            let mut complete = true;
            let mut unresolved = Vec::new();
            let mut output = Vec::with_capacity(items.len());
            for item in items {
                let Resolution {
                    value,
                    complete: item_complete,
                    unresolved: item_unresolved,
                } = resolve_node(item, document, partials, remaining, stack, ctx);
                complete &= item_complete;
                unresolved.extend(item_unresolved);
                if matches!(item, PositionedValue::String { quoted: false, .. })
                    && matches!(value, PositionedValue::Array { .. })
                {
                    let token = if let PositionedValue::String { value, line, .. } = item {
                        scan_tokens(value, *line, None).into_iter().next()
                    } else {
                        None
                    };
                    if let Some(t) = token {
                        add_error(
                            ctx,
                            &t,
                            Code::InvalidReferenceShape,
                            "array cannot be inserted as a sequence item",
                        );
                    }
                    output.push(item.clone());
                } else {
                    output.push(value);
                }
            }
            Resolution {
                value: PositionedValue::Array {
                    items: output,
                    line: *line,
                    inserted_at: inserted_at.clone(),
                },
                complete,
                unresolved,
            }
        }
        PositionedValue::Mapping {
            entries,
            line,
            inserted_at,
        } => {
            let mut complete = true;
            let mut unresolved = Vec::new();
            let entries = entries
                .iter()
                .map(|(k, v)| {
                    let r = resolve_node(v, document, partials, remaining, stack, ctx);
                    complete &= r.complete;
                    unresolved.extend(r.unresolved);
                    (k.clone(), r.value)
                })
                .collect();
            Resolution {
                value: PositionedValue::Mapping {
                    entries,
                    line: *line,
                    inserted_at: inserted_at.clone(),
                },
                complete,
                unresolved,
            }
        }
        PositionedValue::String {
            value,
            line,
            quoted: false,
            source_spans,
            inserted_at,
        } => {
            let tokens = scan_tokens(value, *line, source_spans.as_deref());
            let pure =
                tokens.len() == 1 && tokens[0].start == 0 && tokens[0].text.len() == value.len();
            if pure {
                let token = &tokens[0];
                let selected = target(token, document, partials);
                if remaining == 0 {
                    Resolution {
                        value: node.clone(),
                        complete: false,
                        unresolved: vec![token.clone()],
                    }
                } else if let Some((selected, tail)) = selected {
                    let sid = selected as *const PositionedValue as usize;
                    if stack.contains(&sid) {
                        Resolution {
                            value: node.clone(),
                            complete: false,
                            unresolved: vec![token.clone()],
                        }
                    } else if token.partial_path.is_some() {
                        Resolution {
                            value: copied_with_insertion(selected, token),
                            complete: true,
                            unresolved: Vec::new(),
                        }
                    } else {
                        stack.insert(sid);
                        let r =
                            resolve_node(selected, document, partials, remaining - 1, stack, ctx);
                        stack.remove(&sid);
                        let selected = if r.complete {
                            lookup_path(Some(&r.value), &tail)
                        } else {
                            None
                        };
                        if let Some(selected) = selected {
                            Resolution {
                                value: copied_with_insertion(selected, token),
                                complete: true,
                                unresolved: Vec::new(),
                            }
                        } else {
                            Resolution {
                                value: node.clone(),
                                complete: false,
                                unresolved: vec![token.clone()],
                            }
                        }
                    }
                } else {
                    Resolution {
                        value: node.clone(),
                        complete: false,
                        unresolved: vec![token.clone()],
                    }
                }
            } else if tokens.is_empty() {
                Resolution {
                    value: node.clone(),
                    complete: true,
                    unresolved: Vec::new(),
                }
            } else {
                let mut output = String::new();
                let mut cursor = 0;
                let mut complete = true;
                let mut unresolved = Vec::new();
                for token in &tokens {
                    output.push_str(&value[cursor..token.start]);
                    let selected = target(token, document, partials);
                    let replacement = if remaining == 0 {
                        None
                    } else if let Some((selected, tail)) = selected {
                        let sid = selected as *const PositionedValue as usize;
                        if stack.contains(&sid) {
                            None
                        } else if token.partial_path.is_some() {
                            scalar_text(selected, token, ctx)
                        } else {
                            stack.insert(sid);
                            let r = resolve_node(
                                selected,
                                document,
                                partials,
                                remaining - 1,
                                stack,
                                ctx,
                            );
                            stack.remove(&sid);
                            let selected = if r.complete {
                                lookup_path(Some(&r.value), &tail)
                            } else {
                                None
                            };
                            selected.and_then(|v| scalar_text(v, token, ctx))
                        }
                    } else {
                        None
                    };
                    if let Some(text) = replacement {
                        output.push_str(&text);
                    } else {
                        complete = false;
                        unresolved.push(token.clone());
                        output.push_str(&token.text);
                    }
                    cursor = token.start + token.text.len();
                }
                output.push_str(&value[cursor..]);
                if output.chars().count() > SCALAR_LENGTH_LIMIT {
                    add_error(
                        ctx,
                        &tokens[0],
                        Code::ResourceLimit,
                        &format!(
                            "scalar exceeds maximum length of {SCALAR_LENGTH_LIMIT} code points"
                        ),
                    );
                }
                Resolution {
                    value: PositionedValue::String {
                        value: output,
                        line: *line,
                        quoted: false,
                        source_spans: source_spans.clone(),
                        inserted_at: inserted_at.clone(),
                    },
                    complete,
                    unresolved,
                }
            }
        }
        _ => Resolution {
            value: node.clone(),
            complete: true,
            unresolved: Vec::new(),
        },
    };
    if stack.len() > 1 {
        ctx.cache.insert((identity, remaining), result.clone());
    }
    result
}

fn valid_partial_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    !bytes.is_empty() && initial(bytes[0]) && bytes[1..].iter().all(|c| partial_char(*c))
}

fn count_nodes(v: &LimaValue) -> usize {
    match v {
        LimaValue::Array(v) => 1 + v.iter().map(count_nodes).sum::<usize>(),
        LimaValue::Mapping(v) => 1 + v.iter().map(|(_, v)| count_nodes(v)).sum::<usize>(),
        _ => 1,
    }
}

fn invalid_partial(name: &str, path: Option<&str>, detail: &str) -> LimaError {
    let message = path.map_or_else(
        || format!("Lima: invalid partial name \"{name}\": {detail}"),
        |p| format!("Lima: invalid partial \"{name}\" at path \"{p}\": {detail}"),
    );
    let mut e = LimaError::diagnostic(Code::InvalidPartial, message, None);
    e.partial = Some(name.into());
    e.path = path.map(Into::into);
    e
}

fn ingest_partial(
    v: &LimaValue,
    name: &str,
    path: &str,
    depth: u32,
) -> Result<LimaValue, LimaError> {
    match v {
        LimaValue::Null | LimaValue::Bool(_) | LimaValue::String(_) | LimaValue::Instant(_) => {}
        LimaValue::Int(_) | LimaValue::Float(_) => {}
        LimaValue::Array(_) | LimaValue::Mapping(_) if depth >= PARTIAL_VALUE_DEPTH_LIMIT => {
            return Err(invalid_partial(
                name,
                Some(path),
                "nesting depth exceeds maximum of 16",
            ));
        }
        _ => {}
    }
    match v {
        LimaValue::Null => Ok(LimaValue::Null),
        LimaValue::Bool(v) => Ok(LimaValue::Bool(*v)),
        LimaValue::Int(v) => {
            let n = *v as f64;
            if n.is_finite() {
                Ok(LimaValue::Float(if n == 0.0 { 0.0 } else { n }))
            } else {
                Err(invalid_partial(name, Some(path), "non-finite number"))
            }
        }
        LimaValue::Float(v) if v.is_finite() => {
            Ok(LimaValue::Float(if *v == 0.0 { 0.0 } else { *v }))
        }
        LimaValue::Float(_) => Err(invalid_partial(name, Some(path), "non-finite number")),
        LimaValue::String(v) if v.chars().count() <= SCALAR_LENGTH_LIMIT => {
            Ok(LimaValue::String(v.clone()))
        }
        LimaValue::String(_) => Err(invalid_partial(
            name,
            Some(path),
            "string exceeds maximum length of 16384 code points",
        )),
        LimaValue::Instant(v) => {
            let iso = v.to_iso_string();
            if iso.len() == 20 && iso.as_bytes().get(4) == Some(&b'-') {
                Ok(LimaValue::Instant(*v))
            } else {
                Err(invalid_partial(
                    name,
                    Some(path),
                    "date year outside the range 0001-9999",
                ))
            }
        }
        LimaValue::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for (i, item) in items.iter().enumerate() {
                if matches!(item, LimaValue::Array(_)) {
                    return Err(invalid_partial(
                        name,
                        Some(&format!("{path}[{i}]")),
                        "nested arrays are not supported",
                    ));
                }
                out.push(ingest_partial(
                    item,
                    name,
                    &format!("{path}[{i}]"),
                    depth + 1,
                )?);
            }
            Ok(LimaValue::Array(out))
        }
        LimaValue::Mapping(entries) => {
            let mut out = Vec::with_capacity(entries.len());
            for (key, value) in entries {
                if key.chars().count() > PARTIAL_KEY_LENGTH_LIMIT {
                    return Err(invalid_partial(
                        name,
                        Some(&format!("{path}.{key}")),
                        "key exceeds maximum length of 128 code points",
                    ));
                }
                out.push((
                    key.clone(),
                    ingest_partial(value, name, &format!("{path}.{key}"), depth + 1)?,
                ));
            }
            Ok(LimaValue::Mapping(out))
        }
    }
}

fn positioned(v: &LimaValue) -> PositionedValue {
    match v {
        LimaValue::Null => PositionedValue::Null {
            line: 0,
            inserted_at: None,
        },
        LimaValue::Bool(value) => PositionedValue::Bool {
            value: *value,
            line: 0,
            inserted_at: None,
        },
        LimaValue::Int(value) => PositionedValue::Int {
            value: *value,
            line: 0,
            inserted_at: None,
        },
        LimaValue::Float(value) => PositionedValue::Float {
            value: *value,
            line: 0,
            inserted_at: None,
        },
        LimaValue::String(value) => PositionedValue::String {
            value: value.clone(),
            line: 0,
            quoted: true,
            source_spans: None,
            inserted_at: None,
        },
        LimaValue::Instant(value) => PositionedValue::Instant {
            value: *value,
            line: 0,
            inserted_at: None,
        },
        LimaValue::Array(items) => PositionedValue::Array {
            items: items.iter().map(positioned).collect(),
            line: 0,
            inserted_at: None,
        },
        LimaValue::Mapping(entries) => PositionedValue::Mapping {
            entries: entries
                .iter()
                .map(|(k, v)| (k.clone(), positioned(v)))
                .collect(),
            line: 0,
            inserted_at: None,
        },
    }
}

fn validate_partials(
    raw: &[(String, LimaValue)],
) -> Result<Vec<(String, PositionedValue)>, LimaError> {
    if raw.len() > PARTIAL_COUNT_LIMIT {
        return Err(LimaError::diagnostic(
            Code::InvalidPartial,
            format!("Lima: too many partials (max {PARTIAL_COUNT_LIMIT})"),
            None,
        ));
    }
    for (name, _) in raw {
        if !valid_partial_name(name) {
            return Err(invalid_partial(name, None, "invalid partial name"));
        }
        if name.chars().count() > PARTIAL_NAME_LENGTH_LIMIT {
            return Err(invalid_partial(
                name,
                None,
                "exceeds maximum length of 128 code points",
            ));
        }
    }
    let mut ingested = Vec::with_capacity(raw.len());
    for (name, value) in raw {
        ingested.push((name.clone(), ingest_partial(value, name, name, 0)?));
    }
    if ingested.iter().map(|(_, v)| count_nodes(v)).sum::<usize>() > PARTIAL_NODE_LIMIT {
        return Err(LimaError::diagnostic(
            Code::InvalidPartial,
            format!(
                "Lima: partials exceed the combined maximum of {PARTIAL_NODE_LIMIT} value nodes"
            ),
            None,
        ));
    }
    Ok(ingested
        .iter()
        .map(|(k, v)| (k.clone(), positioned(v)))
        .collect())
}

fn final_validate(v: &PositionedValue) -> Result<(usize, u32), LimaError> {
    match v {
        PositionedValue::String {
            value,
            line,
            inserted_at,
            ..
        } if value.chars().count() > SCALAR_LENGTH_LIMIT => {
            let at = inserted_at.as_ref();
            let l = at.map_or(*line, |x| x.line);
            let mut e = LimaError::diagnostic(Code::ResourceLimit, format!("Lima: scalar exceeds maximum length of {SCALAR_LENGTH_LIMIT} code points at line {l}"), Some(l));
            e.token = at.map(|x| x.token.clone().into_boxed_str());
            Err(e)
        }
        PositionedValue::Array {
            items,
            line,
            inserted_at,
        } => {
            if let Some(child) = items
                .iter()
                .find(|v| matches!(v, PositionedValue::Array { .. }))
            {
                let mut participants = Vec::new();
                collect_all_participants(child, &mut participants);
                let winner = earliest_participant(&participants).or(inserted_at.as_ref());
                let l = winner.map_or(*line, |x| x.line);
                let mut e = LimaError::diagnostic(
                    Code::InvalidReferenceShape,
                    format!("Lima: nested arrays are not supported at line {l}"),
                    Some(l),
                );
                e.token = winner.map(|x| x.token.clone().into_boxed_str());
                e.column = winner.map(|x| x.offset as u32 + 1);
                return Err(e);
            }
            let mut nodes = 1;
            let mut depth = 0;
            for item in items {
                let (n, d) = final_validate(item)?;
                nodes += n;
                depth = depth.max(d);
            }
            Ok((nodes, 1 + depth))
        }
        PositionedValue::Mapping { entries, .. } => {
            let mut nodes = 1;
            let mut depth = 0;
            for (_, item) in entries {
                let (n, d) = final_validate(item)?;
                nodes += n;
                depth = depth.max(d);
            }
            Ok((nodes, 1 + depth))
        }
        _ => Ok((1, 0)),
    }
}

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
            let mut native = Vec::with_capacity(items.len());
            let mut node_count = 1;
            let mut max_depth = 0;
            let mut deepest = Vec::new();
            for item in items {
                let r = finalize_positioned(item);
                native.push(r.native);
                node_count += r.node_count;
                match r.depth.cmp(&max_depth) {
                    std::cmp::Ordering::Greater => {
                        max_depth = r.depth;
                        deepest = r.deepest_participants;
                    }
                    std::cmp::Ordering::Equal => deepest.extend(r.deepest_participants),
                    std::cmp::Ordering::Less => {}
                }
            }
            let mut participants = own;
            participants.extend(deepest);
            FinalizedValue {
                native: LimaValue::Array(native),
                node_count,
                depth: 1 + max_depth,
                deepest_participants: participants,
            }
        }
        PositionedValue::Mapping { entries, .. } => {
            let mut native = Vec::with_capacity(entries.len());
            let mut node_count = 1;
            let mut max_depth = 0;
            let mut deepest = Vec::new();
            for (key, item) in entries {
                let r = finalize_positioned(item);
                native.push((key.clone(), r.native));
                node_count += r.node_count;
                match r.depth.cmp(&max_depth) {
                    std::cmp::Ordering::Greater => {
                        max_depth = r.depth;
                        deepest = r.deepest_participants;
                    }
                    std::cmp::Ordering::Equal => deepest.extend(r.deepest_participants),
                    std::cmp::Ordering::Less => {}
                }
            }
            let mut participants = own;
            participants.extend(deepest);
            FinalizedValue {
                native: LimaValue::Mapping(native),
                node_count,
                depth: 1 + max_depth,
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
    participants.iter().min_by_key(|p| (p.line, p.offset))
}

fn collect_all_participants(v: &PositionedValue, acc: &mut Vec<InsertedAt>) {
    if let Some(at) = v.inserted_at() {
        acc.push(at.clone());
    }
    match v {
        PositionedValue::Array { items, .. } => {
            items.iter().for_each(|v| collect_all_participants(v, acc));
        }
        PositionedValue::Mapping { entries, .. } => {
            entries
                .iter()
                .for_each(|(_, v)| collect_all_participants(v, acc));
        }
        _ => {}
    }
}

pub fn parse(front_matter: &str, mut options: ParseOptions) -> Result<LimaValue, LimaError> {
    if options.mode == ParseMode::Core {
        if options.partials.is_some() {
            return Err(LimaError::diagnostic(
                Code::InvalidPartial,
                "Lima: partials cannot be supplied in core mode",
                None,
            ));
        }
        return parse_core(
            front_matter,
            CoreOptions {
                strict: options.strict,
                on_warning: options.on_warning,
            },
        );
    }
    let partials = validate_partials(options.partials.as_deref().unwrap_or(&[]))?;
    if !front_matter.contains("${") && !front_matter.contains("$(") {
        return parse_core(
            front_matter,
            CoreOptions {
                strict: options.strict,
                on_warning: options.on_warning,
            },
        );
    }
    let collect_warnings = options.on_warning.is_some();
    if collect_warnings {
        begin_warning_collection(true);
    }
    let parsed = parse_core_with_positions_options(front_matter, options.strict, collect_warnings);
    let warnings = if collect_warnings {
        finish_warning_collection()
    } else {
        Vec::new()
    };
    if let Some(callback) = options.on_warning.as_mut() {
        for warning in warnings {
            callback(warning);
        }
    }
    let document = parsed?;
    let mut ctx = Context {
        diagnostics: Vec::new(),
        cache: HashMap::new(),
    };
    let mut resolved = Vec::with_capacity(document.len());
    let mut unresolved = Vec::new();
    for (key, value) in &document {
        let id = value as *const PositionedValue as usize;
        let mut stack = HashSet::from([id]);
        let resolution = resolve_node(value, &document, &partials, MAX_EDGES, &mut stack, &mut ctx);
        unresolved.extend(resolution.unresolved);
        resolved.push((key.clone(), resolution.value));
    }
    if options.strict {
        for token in unresolved {
            add_error(&mut ctx, &token, Code::UnresolvedReference, "");
        }
    }
    if !ctx.diagnostics.is_empty() {
        ctx.diagnostics
            .sort_by_key(|(line, offset, _)| (*line, *offset));
        return Err(ctx.diagnostics.remove(0).2);
    }
    let mut total = 1usize;
    let mut max_depth = 0u32;
    let mut deepest_participants = Vec::new();
    let mut native = Vec::with_capacity(resolved.len());
    for (_, value) in &resolved {
        final_validate(value)?;
    }
    for (key, value) in &resolved {
        let finalized = finalize_positioned(value);
        total += finalized.node_count;
        native.push((key.clone(), finalized.native));
        match finalized.depth.cmp(&max_depth) {
            std::cmp::Ordering::Greater => {
                max_depth = finalized.depth;
                deepest_participants = finalized.deepest_participants;
            }
            std::cmp::Ordering::Equal => {
                deepest_participants.extend(finalized.deepest_participants)
            }
            std::cmp::Ordering::Less => {}
        }
    }
    if max_depth > NESTING_DEPTH_LIMIT as u32 {
        let winner = earliest_participant(&deepest_participants);
        let line = winner.map_or(1, |at| at.line);
        let mut error = LimaError::new(
            Code::ResourceLimit,
            line,
            format!("Lima: nesting depth exceeds maximum of {NESTING_DEPTH_LIMIT} at line {line}"),
        );
        error.token = winner.map(|at| at.token.clone().into_boxed_str());
        error.column = winner.map(|at| at.offset as u32 + 1);
        return Err(error);
    }
    if total > RESULT_NODE_LIMIT {
        let mut participants = Vec::new();
        for (_, value) in &resolved {
            collect_all_participants(value, &mut participants);
        }
        let winner = earliest_participant(&participants);
        let line = winner.map_or(1, |at| at.line);
        let mut error = LimaError::new(Code::ResourceLimit, line, format!("Lima: result exceeds maximum size of {RESULT_NODE_LIMIT} total nodes at line {line}"));
        error.token = winner.map(|at| at.token.clone().into_boxed_str());
        error.column = winner.map(|at| at.offset as u32 + 1);
        return Err(error);
    }
    Ok(LimaValue::Mapping(native))
}

#[deprecated(note = "use parse")]
pub fn parse_references(front_matter: &str, options: ParseOptions) -> Result<LimaValue, LimaError> {
    parse(front_matter, options)
}

#[deprecated(note = "use ParseOptions")]
pub type ReferencesOptions = ParseOptions;

#[cfg(test)]
mod tests {
    use super::*;

    fn strict_error(input: &str) -> LimaError {
        parse(
            input,
            ParseOptions {
                strict: true,
                ..ParseOptions::default()
            },
        )
        .unwrap_err()
    }

    #[test]
    fn strict_position_survives_earlier_interpolation_length_change() {
        let error = strict_error("a: 12345\nx: value ${a} then ${missing}");
        assert_eq!(error.line, Some(2));
        assert_eq!(error.column, Some(17));
        assert_eq!(error.token.as_deref(), Some("${missing}"));
    }

    #[test]
    fn token_columns_count_unicode_code_points() {
        let error = strict_error("x: café ${missing}");
        assert_eq!(error.column, Some(6));
        assert_eq!(error.token.as_deref(), Some("${missing}"));
    }

    #[test]
    fn depth_limit_is_attributed_only_to_the_deepest_structure() {
        let mut deep = LimaValue::String("leaf".into());
        for _ in 0..16 {
            deep = LimaValue::Mapping(vec![("k".into(), deep)]);
        }
        let error = parse(
            "early: ${x}\nx: 1\nouter:\n  inner: $(deep)",
            ParseOptions {
                partials: Some(vec![("deep".into(), deep)]),
                ..ParseOptions::default()
            },
        )
        .unwrap_err();
        assert_eq!(error.line, Some(4));
        assert_eq!(error.token.as_deref(), Some("$(deep)"));
    }
}
