/**
 * @file Lima grammar for tree-sitter
 *
 * Lima Core 1.0 syntax + active References 2.0 tokens.
 *
 * The external scanner (src/scanner.c) owns:
 *   - indentation (NEWLINE / INDENT / DEDENT)
 *   - block sequence dash ("-") and block scalar marker ("|")
 *   - block scalar body fragments (block text, block newline, "^" continuation)
 *   - plain/flow text, scalar classification, and comment/hash handling
 *
 * Keys, quoted strings, escapes, flow collections, and reference leaves are
 * expressed directly in the grammar.
 */

// Keep these four definitions byte-for-byte aligned with the exported
// constants in js/src/reference-tokens2.ts.
const SEGMENT = '[a-zA-Z0-9_][a-zA-Z0-9_:-]*';
const DOC_PATH = `${SEGMENT}(?:\\.${SEGMENT})*`;
const PARTIAL_NAME = '[a-zA-Z0-9_][a-zA-Z0-9_:/-]*';
const PARTIAL_PATH = `${PARTIAL_NAME}(?:\\.${SEGMENT})*`;

const ESCAPE = '\\\\(?:\\\\|\\"|\\/|n|r|t|b|f|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|x[0-9A-Fa-f]{2})';

// comma-separated items, tolerating a trailing comma (non-strict recovery).
function comma_sep(rule) {
  return optional(seq(rule, repeat(seq(',', rule)), optional(',')));
}

module.exports = grammar({
  name: 'lima',

  externals: $ => [
    $._newline,
    $._indent,
    $._dedent,
    $._dash,
    $._unquoted_key,
    $._unrecognized_line,
    $._block_scalar_marker,
    $._block_newline,
    $._continuation,
    $._plain_text,
    $._flow_text,
    $._block_text,
    $._null,
    $._boolean,
    $._number,
    $._date,
    $.comment,
  ],

  extras: $ => [
    /[ \t]+/,
    $.comment,
  ],

  conflicts: $ => [
    [$.block_mapping, $.block_sequence],
  ],

  rules: {
    document: $ => repeat(choice($.block_mapping_entry, $._unrecognized_line)),

    // ---- block structure ----

    block_mapping_entry: $ => seq(
      field('key', $._key),
      ':',
      $._entry_value,
    ),

    block_mapping: $ => repeat1(choice($.block_mapping_entry, $._unrecognized_line)),

    block_sequence: $ => repeat1(choice($.block_sequence_item, $._unrecognized_line)),

    block_sequence_item: $ => seq(
      $._dash,
      choice(
        // simple item: "- value"
        seq(optional(field('value', $._inline_value)), $._newline),
        // object item: "- key: ..." followed by sibling keys at the key column,
        // and the lines non-strict mode skips between them (Core 1.1 §7.1)
        seq(
          field('key', $._key),
          ':',
          $._entry_value,
          seq(repeat(choice($.block_mapping_entry, $._unrecognized_line)), $._dedent),
        ),
      ),
    ),

    // value part of "key: ..." — includes the terminating newline (or indent)
    _entry_value: $ => choice(
      $.block_scalar,
      seq($._indent, $._block_value, $._dedent),
      seq(optional(field('value', $._inline_value)), $._newline),
    ),

    _block_value: $ => choice($.block_mapping, $.block_sequence),

    // ---- block scalar ----

    block_scalar: $ => seq($._block_scalar_marker, field('body', $.block_scalar_body)),

    block_scalar_body: $ => seq(
      repeat(choice(
        $._block_text,
        $._block_newline,
        $.continuation,
        $.document_reference,
        $.partial_reference,
      )),
      $._dedent,
    ),

    continuation: $ => $._continuation,

    // ---- keys ----

    _key: $ => choice($.key, $.single_quoted_key, $.double_quoted_key),
    key: $ => $._unquoted_key,
    flow_key: $ => /[a-zA-Z0-9_][a-zA-Z0-9_-]*(?::[a-zA-Z0-9_][a-zA-Z0-9_-]*)*/,
    // Core §5.2: single-quoted keys are literal — no escape processing,
    // unlike single_quoted_string values (§6.1.3) or double_quoted_key
    // (§5.2 also, but double-quoted keys decode like double-quoted values).
    single_quoted_key: $ => seq("'", /[^'\r\n]*/, "'"),
    double_quoted_key: $ => seq('"', repeat(choice(
      $.escape_sequence,
      /[^"\\\r\n]+/,
      /\\[^"\r\n]?/,
    )), '"'),

    // ---- inline values ----

    _inline_value: $ => choice(
      prec(2, $.flow_sequence),
      prec(2, $.flow_mapping),
      $.single_quoted_string,
      $.double_quoted_string,
      $.null,
      $.boolean,
      $.number,
      $.date,
      $.plain_scalar,
    ),

    plain_scalar: $ => repeat1(choice(
      $._plain_text,
      $._dollar,
      $.document_reference,
      $.partial_reference,
    )),

    _dollar: $ => '$',

    null: $ => $._null,
    boolean: $ => $._boolean,
    number: $ => $._number,
    date: $ => $._date,

    single_quoted_string: $ => seq("'", repeat(choice(/[^'\\\r\n]+/, /\\./)), "'"),
    double_quoted_string: $ => seq('"', repeat(choice(
      $.escape_sequence,
      /[^"\\\r\n]+/,
      /\\[^"\r\n]?/,
    )), '"'),

    escape_sequence: $ => token(prec(2, new RegExp(ESCAPE))),

    // ---- references (References 2.0, active contexts only) ----

    document_reference: $ => token(new RegExp(`\\$\\{${DOC_PATH}\\}`)),
    partial_reference: $ => token(new RegExp(`\\$\\(${PARTIAL_PATH}\\)`)),

    // ---- flow collections ----

    flow_sequence: $ => seq(
      '[',
      optional($._flow_item),
      repeat(seq(',', optional($._flow_item))),
      ']',
    ),
    flow_mapping: $ => seq('{', comma_sep($._flow_pair), '}'),
    _flow_item: $ => choice(
      prec(2, $.flow_mapping),
      $._flow_value,
    ),
    _flow_pair: $ => seq(
      field('key', choice($.flow_key, $.single_quoted_key, $.double_quoted_key)),
      ':',
      optional(field('value', $._flow_value)),
    ),
    _flow_value: $ => choice(
      $.single_quoted_string,
      $.double_quoted_string,
      $.null,
      $.boolean,
      $.number,
      $.date,
      $.flow_plain_scalar,
    ),
    flow_plain_scalar: $ => repeat1(choice(
      $._flow_text,
      $._dollar,
      $.document_reference,
      $.partial_reference,
    )),
  },
});
