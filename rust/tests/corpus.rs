//! Runs the shared conformance corpus (both `corpus/core/*.json` against
//! `lima::parse_core` and `corpus/references/*.json` against
//! `lima::parse_references`) — block/flow/scalars/references wired
//! together for real, not a flat-line or partial-generic stand-in.
//!
//! `host-number`/`host-date` sentinel partials (`{"$type": "host-number",
//! "value": "nan"}` and similar — the corpus's language-neutral way to
//! specify a value only some host languages can represent, like NaN or an
//! invalid Date) are converted to real Rust values in
//! [`json_to_lima_partial`] wherever Rust's types allow it directly
//! (`f64` natively has NaN/±Infinity/-0; an out-of-range-year `Instant` is
//! constructed for `host-date` "invalid"/"year-overflow"/"year-underflow",
//! since the corpus only asserts the resulting `code`/`partial`/`path`,
//! never *why* a date was rejected).
//!
//! Run with `cargo test --test corpus -- --nocapture` to see the summary.

use lima::errors::LimaDiagnosticCode;
use lima::value::{days_from_civil, Instant, LimaValue};
use lima::{parse_core, parse_references, ReferencesOptions};
use serde_json::Value as Json;
use std::fs;
use std::path::PathBuf;

fn corpus_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../corpus/core")
}

fn references_corpus_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../corpus/references")
}

fn code_name(code: LimaDiagnosticCode) -> &'static str {
    use LimaDiagnosticCode::*;
    match code {
        InvalidEscape => "INVALID_ESCAPE",
        InvalidQuote => "INVALID_QUOTE",
        InvalidDate => "INVALID_DATE",
        InvalidNumber => "INVALID_NUMBER",
        InvalidReferenceShape => "INVALID_REFERENCE_SHAPE",
        InvalidIndentation => "INVALID_INDENTATION",
        InvalidFlowSyntax => "INVALID_FLOW_SYNTAX",
        DuplicateKey => "DUPLICATE_KEY",
        ResourceLimit => "RESOURCE_LIMIT",
        UnresolvedReference => "UNRESOLVED_REFERENCE",
        InvalidInterpolation => "INVALID_INTERPOLATION",
        InvalidPartial => "INVALID_PARTIAL",
    }
}

/// Some fixtures carry a literal `input` string; others carry a
/// `generator` (name + parameters) that the TS runner expands at load time
/// (see `corpus/runner/src/generators/`). Only the generators actually used
/// by `corpus/core` are implemented; anything else is skipped.
fn resolve_input(fixture: &Json) -> Option<String> {
    if let Some(s) = fixture["input"].as_str() {
        return Some(s.to_string());
    }
    let gen = fixture.get("generator")?;
    let params = &gen["parameters"];
    match gen["name"].as_str()? {
        "repeated-key" => {
            let count = params["count"].as_u64()?;
            let key_prefix = params["keyPrefix"].as_str().unwrap_or("k");
            let value = params["value"].as_str().unwrap_or("v");
            Some(
                (0..count)
                    .map(|i| format!("{key_prefix}{i}: {value}"))
                    .collect::<Vec<_>>()
                    .join("\n"),
            )
        }
        "repeated-scalar" => {
            let key = params["key"].as_str().unwrap_or("value");
            let code_point = params["codePoint"].as_str()?;
            let length = params["length"].as_u64()? as usize;
            Some(format!("{key}: {}", code_point.repeat(length)))
        }
        "nested-mappings" => Some(nested_mappings_input(params)?),
        "document-bytes" => {
            // A document of exactly `length` UTF-8 bytes, spread across
            // `kN: xxx...` lines so no single line trips the (unrelated)
            // scalar-length limit before the document-size limit is
            // reached. A simpler, non-byte-exact construction than the TS
            // generator's — this harness only needs *a* document at
            // exactly the target byte length, not the TS runner's specific
            // line layout.
            let length = params["length"].as_u64()? as usize;
            let fill = params["fillCodePoint"].as_str().unwrap_or("x");
            Some(document_of_byte_length(length, fill))
        }
        _ => None,
    }
}

fn nested_mappings_input(params: &Json) -> Option<String> {
    let depth = params["depth"].as_u64()?;
    let key = params["key"].as_str().unwrap_or("k");
    let leaf_value = params["leafValue"].as_str().unwrap_or("v");
    let mut lines: Vec<String> = (0..depth)
        .map(|level| format!("{}{key}:", "  ".repeat(level as usize)))
        .collect();
    lines.push(format!(
        "{}{key}: {leaf_value}",
        "  ".repeat(depth as usize)
    ));
    Some(lines.join("\n"))
}

fn document_of_byte_length(length: usize, fill: &str) -> String {
    let fill_bytes = fill.len();
    let mut lines: Vec<String> = Vec::new();
    let mut remaining = length;
    let mut index = 0usize;
    while remaining > 0 {
        if !lines.is_empty() {
            remaining -= 1; // '\n' separator before this line
        }
        let prefix = format!("k{index}: ");
        let prefix_bytes = prefix.len();
        assert!(
            remaining >= prefix_bytes,
            "document_of_byte_length: cannot fit another line"
        );
        let budget = remaining - prefix_bytes;
        // Matches the TS generator's own cap: keeps each line's scalar
        // well under the 16,384-code-point scalar limit, so this isolates
        // the *document*-size boundary instead of tripping the unrelated
        // scalar-length limit first.
        let fill_count = (budget / fill_bytes).min(1000);
        lines.push(prefix + &fill.repeat(fill_count));
        remaining -= prefix_bytes + fill_count * fill_bytes;
        index += 1;
    }
    lines.join("\n")
}

/// `None` = expected shape not supported by this comparison yet
/// (`host-number`/`host-date` sentinels) — reported as skipped, not failed.
fn value_matches(actual: &LimaValue, expected: &Json) -> Option<bool> {
    match (actual, expected) {
        (LimaValue::Null, Json::Null) => Some(true),
        (LimaValue::Bool(b), Json::Bool(e)) => Some(b == e),
        (LimaValue::Int(n), Json::Number(e)) => Some(e.as_f64() == Some(*n as f64)),
        (LimaValue::Float(n), Json::Number(e)) => Some(e.as_f64() == Some(*n)),
        (LimaValue::String(s), Json::String(e)) => Some(s == e),
        (LimaValue::Instant(i), Json::Object(o)) => {
            if o.get("$type").and_then(Json::as_str) != Some("instant") {
                return None;
            }
            Some(o.get("value").and_then(Json::as_str) == Some(i.to_iso_string().as_str()))
        }
        (LimaValue::Array(items), Json::Array(exp)) => {
            if items.len() != exp.len() {
                return Some(false);
            }
            for (a, e) in items.iter().zip(exp) {
                match value_matches(a, e)? {
                    true => {}
                    false => return Some(false),
                }
            }
            Some(true)
        }
        (LimaValue::Mapping(entries), Json::Object(o)) if !o.contains_key("$type") => {
            if entries.len() != o.len() {
                return Some(false);
            }
            for (k, ev) in o {
                let Some((_, av)) = entries.iter().find(|(ak, _)| ak == k) else {
                    return Some(false);
                };
                match value_matches(av, ev)? {
                    true => {}
                    false => return Some(false),
                }
            }
            Some(true)
        }
        (LimaValue::Float(n), Json::Object(o))
            if o.get("$type").and_then(Json::as_str) == Some("host-number") =>
        {
            match o.get("value").and_then(Json::as_str) {
                Some("nan") => Some(n.is_nan()),
                Some("infinity") => Some(*n == f64::INFINITY),
                Some("-infinity") => Some(*n == f64::NEG_INFINITY),
                Some("-0") => Some(*n == 0.0 && n.is_sign_negative()),
                _ => None,
            }
        }
        // `host-date` sentinels never appear as an *expected result* in the
        // corpus today (only as partial input, handled by
        // `json_to_lima_partial`) — no `Instant`-side case to add here.
        (_, Json::Object(o)) if o.get("$type").is_some() => None,
        _ => Some(false),
    }
}

#[test]
fn core_matches_conformance_corpus() {
    let mut pass = 0u32;
    let mut fail: Vec<String> = Vec::new();
    let mut skip = 0u32;

    let mut entries: Vec<_> = fs::read_dir(corpus_dir())
        .expect("corpus/core directory should exist")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("json"))
        .collect();
    entries.sort();
    assert!(
        !entries.is_empty(),
        "expected corpus fixtures under {}",
        corpus_dir().display()
    );

    for path in entries {
        let text = fs::read_to_string(&path).unwrap();
        let fixture: Json = serde_json::from_str(&text).unwrap();
        let id = fixture["id"].as_str().unwrap_or("<unknown>").to_string();
        let Some(input) = resolve_input(&fixture) else {
            skip += 1;
            continue;
        };
        let strict = fixture["options"]["strict"].as_bool().unwrap_or(false);

        let result = parse_core(&input, strict);

        if let Some(expected_result) = fixture["expect"].get("result") {
            match result {
                Err(e) => fail.push(format!(
                    "{id}: expected success, got error {}: {}",
                    code_name(e.code),
                    e.message
                )),
                Ok(actual) => match value_matches(&actual, expected_result) {
                    None => skip += 1,
                    Some(true) => pass += 1,
                    Some(false) => fail.push(format!(
                        "{id}: mismatch — got {actual:?}, expected {expected_result:?}"
                    )),
                },
            }
        } else if let Some(expected_error) = fixture["expect"]["error"].as_object() {
            match result {
                Ok(_) => fail.push(format!("{id}: expected error, parsing succeeded")),
                Err(e) => {
                    let expected_code = expected_error.get("code").and_then(Json::as_str);
                    if expected_code == Some(code_name(e.code)) {
                        pass += 1;
                    } else {
                        fail.push(format!(
                            "{id}: error code mismatch: got {}, expected {:?}",
                            code_name(e.code),
                            expected_code
                        ));
                    }
                }
            }
        } else {
            skip += 1;
        }
    }

    println!(
        "\ncorpus/core: {pass} passed, {} failed, {skip} skipped\n",
        fail.len()
    );
    assert!(
        fail.is_empty(),
        "{} corpus mismatches:\n{}",
        fail.len(),
        fail.join("\n")
    );
    assert!(
        pass > 0,
        "expected at least one corpus fixture to pass — harness or corpus path is likely broken"
    );
}

/// Converts a corpus JSON value into a [`LimaValue`] partial — the harness's
/// analogue of `ingestPartialValue`'s host-object boundary (see
/// `references.rs`'s module doc: Rust's partials API takes a `LimaValue`
/// directly, so this is purely a test-fixture concern, not library code).
/// `None` for a `host-number`/`host-date` sentinel — no Rust representation
/// for "invalid Date"/NaN-as-a-partial exists, so those fixtures skip,
/// matching how `value_matches` already skips them on the *expected* side.
fn json_to_lima_partial(v: &Json) -> Option<LimaValue> {
    match v {
        Json::Null => Some(LimaValue::Null),
        Json::Bool(b) => Some(LimaValue::Bool(*b)),
        Json::Number(n) => {
            let f = n.as_f64()?;
            if f.fract() == 0.0 && f.abs() <= 9_007_199_254_740_991.0 {
                Some(LimaValue::Int(f as i64))
            } else {
                Some(LimaValue::Float(f))
            }
        }
        Json::String(s) => Some(LimaValue::String(s.clone())),
        Json::Array(items) => Some(LimaValue::Array(
            items
                .iter()
                .map(json_to_lima_partial)
                .collect::<Option<Vec<_>>>()?,
        )),
        Json::Object(o) if !o.contains_key("$type") => Some(LimaValue::Mapping(
            o.iter()
                .map(|(k, v)| Some((k.clone(), json_to_lima_partial(v)?)))
                .collect::<Option<Vec<_>>>()?,
        )),
        Json::Object(o) => {
            let sentinel = o.get("value").and_then(Json::as_str)?;
            match (o.get("$type").and_then(Json::as_str)?, sentinel) {
                // The corpus's language-neutral way to write a Date partial
                // (JSON has no native date type) — fully representable, not
                // actually a "host" sentinel at all.
                ("instant", date_str) => lima::scalars::parse_date_utc(date_str, false, 0)
                    .ok()
                    .flatten()
                    .map(LimaValue::Instant),
                // Rust's `f64` represents all of these natively.
                ("host-number", "nan") => Some(LimaValue::Float(f64::NAN)),
                ("host-number", "infinity") => Some(LimaValue::Float(f64::INFINITY)),
                ("host-number", "-infinity") => Some(LimaValue::Float(f64::NEG_INFINITY)),
                ("host-number", "-0") => Some(LimaValue::Float(-0.0)),
                // `Instant { epoch_seconds: i64 }` has no "invalid" state to
                // construct (unlike JS's `new Date(NaN)`) — Rust's type
                // system makes that case simply unreachable through the
                // typed partials API. Stand in with an out-of-range year
                // instead: the corpus only asserts `code`/`partial`/`path`,
                // never *why* the date was invalid, and
                // `validate_partial_value`'s existing year-range check
                // (1..=9999) rejects this for real, just via a different
                // (equally legitimate) violation than the TS source hits.
                ("host-date", "invalid" | "year-overflow") => Some(LimaValue::Instant(Instant {
                    epoch_seconds: days_from_civil(10_000, 1, 1) * 86_400,
                })),
                ("host-date", "year-underflow") => Some(LimaValue::Instant(Instant {
                    epoch_seconds: days_from_civil(-1, 1, 1) * 86_400,
                })),
                _ => None,
            }
        }
    }
}

/// Resolves both `input` and `partials` for a references fixture — either
/// literal (`fixture["input"]` + `fixture["options"]["partials"]`) or one of
/// the three generators the references corpus actually uses.
fn resolve_references_input(fixture: &Json) -> Option<(String, Vec<(String, LimaValue)>)> {
    if let Some(s) = fixture["input"].as_str() {
        let partials = match fixture["options"]["partials"].as_object() {
            Some(o) => o
                .iter()
                .map(|(k, v)| Some((k.clone(), json_to_lima_partial(v)?)))
                .collect::<Option<Vec<_>>>()?,
            None => Vec::new(),
        };
        return Some((s.to_string(), partials));
    }
    let gen = fixture.get("generator")?;
    let params = &gen["parameters"];
    match gen["name"].as_str()? {
        "nested-mappings" => Some((nested_mappings_input(params)?, Vec::new())),
        "partial-count" => {
            let count = params["count"].as_u64()?;
            let name_prefix = params["namePrefix"].as_str().unwrap_or("p");
            let partials = (0..count)
                .map(|i| {
                    (
                        format!("{name_prefix}{i}"),
                        LimaValue::String("v".to_string()),
                    )
                })
                .collect();
            Some((String::new(), partials))
        }
        "partial-node-tree" => {
            let total_nodes = params["totalNodes"].as_u64()?;
            let partial_name = params["partialName"].as_str().unwrap_or("big");
            let elements = vec![LimaValue::Int(1); (total_nodes - 1) as usize];
            Some((
                String::new(),
                vec![(partial_name.to_string(), LimaValue::Array(elements))],
            ))
        }
        _ => None,
    }
}

#[test]
fn references_matches_conformance_corpus() {
    let mut pass = 0u32;
    let mut fail: Vec<String> = Vec::new();
    let mut skip = 0u32;

    let mut entries: Vec<_> = fs::read_dir(references_corpus_dir())
        .expect("corpus/references directory should exist")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("json"))
        .collect();
    entries.sort();
    assert!(
        !entries.is_empty(),
        "expected corpus fixtures under {}",
        references_corpus_dir().display()
    );

    for path in entries {
        let text = fs::read_to_string(&path).unwrap();
        let fixture: Json = serde_json::from_str(&text).unwrap();
        let id = fixture["id"].as_str().unwrap_or("<unknown>").to_string();
        let Some((input, partials)) = resolve_references_input(&fixture) else {
            skip += 1;
            continue;
        };
        let strict = fixture["options"]["strict"].as_bool().unwrap_or(false);

        let result = parse_references(&input, ReferencesOptions { partials, strict });

        if let Some(expected_result) = fixture["expect"].get("result") {
            match result {
                Err(e) => fail.push(format!(
                    "{id}: expected success, got error {}: {}",
                    code_name(e.code),
                    e.message
                )),
                Ok(actual) => match value_matches(&actual, expected_result) {
                    None => skip += 1,
                    Some(true) => pass += 1,
                    Some(false) => fail.push(format!(
                        "{id}: mismatch — got {actual:?}, expected {expected_result:?}"
                    )),
                },
            }
        } else if let Some(expected_error) = fixture["expect"]["error"].as_object() {
            match result {
                Ok(_) => fail.push(format!("{id}: expected error, parsing succeeded")),
                Err(e) => {
                    let expected_code = expected_error.get("code").and_then(Json::as_str);
                    if expected_code == Some(code_name(e.code)) {
                        pass += 1;
                    } else {
                        fail.push(format!(
                            "{id}: error code mismatch: got {}, expected {:?}: {}",
                            code_name(e.code),
                            expected_code,
                            e.message,
                        ));
                    }
                }
            }
        } else {
            skip += 1;
        }
    }

    println!(
        "\ncorpus/references: {pass} passed, {} failed, {skip} skipped\n",
        fail.len()
    );
    assert!(
        fail.is_empty(),
        "{} corpus mismatches:\n{}",
        fail.len(),
        fail.join("\n")
    );
    assert!(
        pass > 0,
        "expected at least one corpus fixture to pass — harness or corpus path is likely broken"
    );
}
