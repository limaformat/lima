//! Lima Core 1.3: what it reads otherwise than Core 1.2, its errata, and the
//! defects it touches. Mirrors `js/src/core-1.3.test.ts` and
//! `go/core13_test.go`; each test fails on the Core 1.2 implementation.

use lima::errors::{LimaDiagnosticCode as Code, LimaError};
use lima::value::LimaValue;
use lima::{parse, parse_core, ParseOptions};
use serde_json::{json, Value as Json};

/// A Lima value as JSON, numbers by value, for comparison with `json!`.
fn to_json(value: &LimaValue) -> Json {
    match value {
        LimaValue::Null => Json::Null,
        LimaValue::Bool(b) => json!(b),
        LimaValue::Int(i) => json!(i),
        LimaValue::Float(f) => json!(f),
        LimaValue::String(s) => json!(s),
        LimaValue::Instant(i) => json!(i.epoch_seconds),
        LimaValue::Array(items) => Json::Array(items.iter().map(to_json).collect()),
        LimaValue::Mapping(entries) => Json::Object(
            entries
                .iter()
                .map(|(key, value)| (key.clone(), to_json(value)))
                .collect(),
        ),
    }
}

fn value(input: &str, strict: bool) -> Json {
    to_json(&parse_core(input, strict).unwrap())
}

fn references(input: &str, strict: bool) -> Json {
    let options = ParseOptions {
        strict,
        ..ParseOptions::default()
    };
    to_json(&parse(input, options).unwrap())
}

fn references_error(input: &str) -> LimaError {
    let options = ParseOptions {
        strict: true,
        ..ParseOptions::default()
    };
    parse(input, options).unwrap_err()
}

/// Parses `input` in strict mode and checks the error's code and line.
fn expect_error(input: &str, code: Code, line: u32) -> LimaError {
    let error = parse_core(input, true).unwrap_err();
    assert_eq!((error.code, error.line), (code, Some(line)), "{input:?}");
    error
}

/// As [`expect_error`], and the message ends with ` ` and `hint`.
fn expect_error_with_hint(input: &str, code: Code, line: u32, hint: &str) {
    let error = expect_error(input, code, line);
    assert!(
        error.message.ends_with(&format!(" {hint}")),
        "{}",
        error.message
    );
}

/// Core 1.3 §4: a `#` begins a comment only at the start of a value or after whitespace.
#[test]
fn hash_after_text_is_text() {
    for strict in [false, true] {
        assert_eq!(
            value("link: https://example.org/x#top\nlang: C#", strict),
            json!({"link": "https://example.org/x#top", "lang": "C#"}),
        );
    }
    assert_eq!(
        value("k: x\u{a0}#c\nj: x\u{feff}#c", false),
        json!({"k": "x", "j": "x"}),
    );
    assert_eq!(value("k: x\u{85}#c", false), json!({"k": "x\u{85}#c"}));
    assert_eq!(
        value("k: [a,#x]\nj: [#x]", false),
        json!({"k": ["a", "#x"], "j": ["#x"]}),
    );
    assert_eq!(value("k: [a, #x]", false), json!({"k": "[a,"}));
    expect_error("k: [a, #x]", Code::InvalidFlowSyntax, 1);
    assert_eq!(value("k: {a: x#y}", false), json!({"k": {"a": "x#y"}}));
    assert_eq!(
        value("k: \\#x\nj: \\\\#x\nq: '#x'\n'#': x", false),
        json!({"k": "#x", "j": "\\#x", "q": "#x", "#": "x"}),
    );
}

/// Core 1.2 assumed every `#` in a decoded flow value came from `\#`.
#[test]
fn flow_hash_maps_to_its_source_for_references() {
    assert_eq!(
        references("a: 42\nb: [a#b,${a}]", false),
        json!({"a": 42, "b": ["a#b", 42]}),
    );
    assert_eq!(
        references("a: 42\nb: [\\#x,${a}]", false),
        json!({"a": 42, "b": ["#x", 42]}),
    );
    let error = references_error("b: [a#b, ${missing}]");
    assert_eq!((error.line, error.column), (Some(1), Some(10)));
    assert_eq!(
        references("a: 42\nb: ${a}#x", false),
        json!({"a": 42, "b": "42#x"}),
    );
    assert_eq!(
        references("a: 42\nb: v#${a}", false),
        json!({"a": 42, "b": "v#42"}),
    );
    assert_eq!(
        references("a: 42\nb: ${a} #x", false),
        json!({"a": 42, "b": 42}),
    );
    assert_eq!(
        references("a: 42\nb: #${a}", false),
        json!({"a": 42, "b": null}),
    );
}

/// Core 1.3 §4, §7.1: an entry whose value is only a comment is a bare key.
#[test]
fn comment_only_value_is_bare_key() {
    assert_eq!(value("k: # c\n  a: 1", true), json!({"k": {"a": 1}}));
    assert_eq!(value("k: #c\n- x", true), json!({"k": ["x"]}));
    assert_eq!(
        value("m:\n  k: # c\n    a: 1\n  j: #c\n  - x", true),
        json!({"m": {"k": {"a": 1}, "j": ["x"]}}),
    );
    assert_eq!(
        value("k:\n  - a: x\n    b: #c\n      c: 1", true),
        json!({"k": [{"a": "x", "b": {"c": 1}}]}),
    );
    assert_eq!(
        value("k:\n- a: 1\n  b: # c\n    c: 2\n  d: 3", true),
        json!({"k": [{"a": 1, "b": {"c": 2}, "d": 3}]}),
    );
    assert_eq!(
        value("k:\n  - b: # c\n      c: 1", true),
        json!({"k": [{"b": {"c": 1}}]}),
    );
    assert_eq!(value("k: # c\nj: 1", true), json!({"k": null, "j": 1}));
    // `- # note` is a null item that opens no block
    assert_eq!(value("k:\n  - #c\n    a: 1", false), json!({"k": [null]}));
    expect_error("k:\n  - #c\n    a: 1", Code::InvalidIndentation, 3);
    // `k: null` and `k: ''` are no bare keys
    assert_eq!(
        value("k: null\n  a: 1\nj: ''\n  a: 1", false),
        json!({"k": null, "j": ""}),
    );
    expect_error("k: null\n  a: 1", Code::InvalidIndentation, 2);
    expect_error("m:\n  k: ''\n    a: 1", Code::InvalidIndentation, 3);
}

/// Core 1.3 §5.1: a tab after the colon separates as a space does.
#[test]
fn tab_separates() {
    assert_eq!(
        value("k:\t1\n'q':\t2\na:b:\t3\nf: {a:\t1}", true),
        json!({"k": 1, "q": 2, "a:b": 3, "f": {"a": 1}}),
    );
    assert_eq!(
        value("m:\n  n:\t4\ns:\n  - o:\t5\n    p:\t6", true),
        json!({"m": {"n": 4}, "s": [{"o": 5, "p": 6}]}),
    );
    assert_eq!(value("k:\t", true), json!({"k": null}));
    assert_eq!(value("k:\t\n  a: 1", true), json!({"k": {"a": 1}}));
    assert_eq!(value("k:\u{a0}x", false), json!({}));
    expect_error("k:\u{a0}x", Code::UnrecognizedLine, 1);
}

/// Core 1.3 §6.1.1: a value that starts with `&`, `*` or `!` throws in strict mode.
#[test]
fn anchor_alias_tag_is_strict_error() {
    expect_error("k: &x", Code::UnsupportedYaml, 1);
    expect_error("k:\n- *x", Code::UnsupportedYaml, 2);
    expect_error("k: [!x]", Code::UnsupportedYaml, 1);
    expect_error("k: {a: &x}", Code::UnsupportedYaml, 1);
    expect_error("m:\n  k: !!str 1", Code::UnsupportedYaml, 2);
    assert_eq!(
        value("k: &x\nl: [!x]\nm: {a: &x}", false),
        json!({"k": "&x", "l": ["!x"], "m": {"a": "&x"}}),
    );
    assert_eq!(
        value("k: '&x'\nl: |\n  &x", true),
        json!({"k": "&x", "l": "&x"}),
    );
    let message = concat!(
        "Lima: unquoted value starting with \"*\" at line 1 (YAML reads it as an alias; ",
        "Lima has no anchors, aliases or tags: quote the value)"
    );
    assert_eq!(parse_core("k: *new*", true).unwrap_err().message, message);
}

/// Core 1.3 §6.1.6: a YAML block scalar header other than `|` throws in strict mode, at its line.
#[test]
fn block_scalar_header_is_strict_error_at_its_line() {
    for header in [">", "|-", "|+", "|2", ">2-", ">-9", ">+"] {
        expect_error(&format!("k: {header}"), Code::UnsupportedYaml, 1);
        expect_error(&format!("k: {header}\n  text"), Code::UnsupportedYaml, 1);
    }
    expect_error("k: [>]", Code::UnsupportedYaml, 1);
    expect_error("k: > #c", Code::UnsupportedYaml, 1);
    assert_eq!(value("k: > #c", false), json!({"k": ">"}));
    assert_eq!(
        value("a: >#c\nb: > text\nc: >0", true),
        json!({"a": ">#c", "b": "> text", "c": ">0"}),
    );
    assert_eq!(
        value("d: >10\ne: |--\nf: >word", true),
        json!({"d": ">10", "e": "|--", "f": ">word"}),
    );
    assert_eq!(
        value("m:\n  a: | # c\n    text", false),
        json!({"m": {"a": "|"}}),
    );
    expect_error("m:\n  a: | # c\n    text", Code::InvalidIndentation, 3);
    assert_eq!(value("k: |\n  #x\n  ^^y", true), json!({"k": "#x y"}));
    assert_eq!(
        value("k: >\n  text\nj: 1", false),
        json!({"k": ">", "j": 1}),
    );
}

/// Core 1.3 §7.5: the flow mapping separator is found before the item is trimmed.
#[test]
fn flow_mapping_separator_before_trimming() {
    for strict in [false, true] {
        assert_eq!(
            value("a: {k: }\nb: {k:\t}\nc: {x: 1, k: }", strict),
            json!({"a": {"k": null}, "b": {"k": null}, "c": {"x": 1, "k": null}}),
        );
    }
    assert_eq!(value("a: {k:}", false), json!({"a": "{k:}"}));
    expect_error("a: {k:}", Code::InvalidFlowSyntax, 1);
}

/// Errata to Core 1.2: §1 whitespace when trimming, leading tabs only, Appendix D.
#[test]
fn core_1_2_errata() {
    assert_eq!(
        value("draft: false\u{a0}\nn: 1\u{3000} # c", true),
        json!({"draft": false, "n": 1}),
    );
    assert_eq!(
        value("k: a\u{2028}\tb", false),
        json!({"k": "a\u{2028}\tb"}),
    );
    assert_eq!(value("k: |\n  \u{a0}\tx", false), json!({"k": "\u{a0}\tx"}));
    assert_eq!(
        value("x: 1 \nk: a \u{2028}b", false),
        json!({"x": 1, "k": "a \u{2028}b"}),
    );
    let error = references_error("x: a\u{2028}\tb\ny:\n\t\tc: ${nope}");
    assert_eq!((error.line, error.column), (Some(3), Some(6)));
    assert_eq!(value("'a\\'b': x", false), json!({}));
    expect_error("'a\\'b': x", Code::UnrecognizedLine, 1);
}

/// Core 1.3 §10.2, Appendix E: a message names what Lima writes instead of a YAML form.
#[test]
fn messages_name_the_lima_form() {
    expect_error_with_hint(
        "k: 'It''s'",
        Code::InvalidQuote,
        1,
        "(YAML doubles the quote; Lima writes 'It\\'s' or \"It's\")",
    );
    expect_error_with_hint(
        "k: >\n  a\n  b",
        Code::UnsupportedYaml,
        1,
        "(Lima writes \"|\", and \"^^\" to join lines)",
    );
    expect_error_with_hint(
        "<<: *base",
        Code::UnrecognizedLine,
        1,
        "(a YAML merge key; Lima has no merge keys)",
    );
    expect_error_with_hint(
        "m:\n  <<: *base",
        Code::UnrecognizedLine,
        2,
        "(a YAML merge key; Lima has no merge keys)",
    );
    expect_error_with_hint(
        "%YAML 1.2",
        Code::UnrecognizedLine,
        1,
        "(a YAML directive; Lima has no directives)",
    );
    expect_error_with_hint(
        "---",
        Code::UnrecognizedLine,
        1,
        "and the caller strips the front matter's own \"---\")",
    );
    expect_error_with_hint(
        "my key:\n  a: 1",
        Code::UnrecognizedLine,
        1,
        "(quote a key that holds spaces: 'my key':)",
    );
    expect_error_with_hint(
        "seo.title: Hello",
        Code::UnrecognizedLine,
        1,
        "(Lima nests by indentation: \"seo:\", and \"title:\" below it)",
    );
    expect_error_with_hint(
        "k: a\n  b",
        Code::InvalidIndentation,
        2,
        "(a value spans lines only after \"|\")",
    );
    expect_error_with_hint(
        "m:\n  k: a\n    b",
        Code::InvalidIndentation,
        3,
        "(a value spans lines only after \"|\")",
    );
    expect_error_with_hint(
        "k: \"a\n  b\"",
        Code::InvalidQuote,
        1,
        "(a quoted value ends on its line; write \"|\" for a value of several lines)",
    );
    expect_error_with_hint(
        "k: [a,\n  b]",
        Code::InvalidFlowSyntax,
        1,
        "(a flow sequence ends on its line; write a block sequence with \"- \")",
    );
}
