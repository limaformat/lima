//! The Rust side of the differential test (`corpus/runner/src/differential.ts`):
//! reads a JSON array of documents from stdin and writes, for each, the
//! non-strict and the strict `parse_core` outcome as JSON — the value (a date
//! as `{"$date": …}`) with the lines of its warnings, or the error's code and
//! line.

use lima::value::LimaValue;
use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::io::Read;
use std::rc::Rc;

fn encode(v: &LimaValue) -> Value {
    match v {
        LimaValue::Null => Value::Null,
        LimaValue::Bool(b) => json!(b),
        LimaValue::Int(i) => json!(i),
        LimaValue::Float(f) => json!(f),
        LimaValue::String(s) => json!(s),
        LimaValue::Instant(i) => json!({ "$date": i.to_iso_string() }),
        LimaValue::Array(a) => Value::Array(a.iter().map(encode).collect()),
        LimaValue::Mapping(m) => Value::Object(
            m.iter()
                .map(|(k, v)| (k.clone(), encode(v)))
                .collect::<Map<_, _>>(),
        ),
    }
}

/// `InvalidIndentation` → `INVALID_INDENTATION`, the code as the other implementations name it.
fn code_name(debug: &str) -> String {
    let mut out = String::new();
    for (i, c) in debug.chars().enumerate() {
        if c.is_ascii_uppercase() && i > 0 {
            out.push('_');
        }
        out.push(c.to_ascii_uppercase());
    }
    out
}

fn main() {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .expect("stdin is readable");
    let documents: Vec<String> =
        serde_json::from_str(&input).expect("stdin is a JSON array of strings");
    let mut out = Vec::with_capacity(documents.len() * 2);
    for document in &documents {
        for strict in [false, true] {
            let warnings = Rc::new(RefCell::new(Vec::new()));
            let sink = Rc::clone(&warnings);
            let options = lima::CoreOptions {
                strict,
                on_warning: Some(Box::new(move |d| sink.borrow_mut().push(d.line))),
            };
            out.push(match lima::parse_core(document, options) {
                Ok(v) => json!({ "value": encode(&v), "warnings": *warnings.borrow() }),
                Err(e) => json!({ "error": code_name(&format!("{:?}", e.code)), "line": e.line }),
            });
        }
    }
    println!("{}", Value::Array(out));
}
