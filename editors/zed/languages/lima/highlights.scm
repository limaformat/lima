[
  (key)
  (flow_key)
  (single_quoted_key)
  (double_quoted_key)
] @property

[
  (single_quoted_string)
  (double_quoted_string)
  (plain_scalar)
  (flow_plain_scalar)
  (block_scalar)
] @string

(escape_sequence) @string.escape
(null) @constant.builtin
(boolean) @boolean
(number) @number
(date) @constant
(document_reference) @variable
(partial_reference) @function
(continuation) @operator
(comment) @comment

["[" "]" "{" "}"] @punctuation.bracket
["," ":"] @punctuation.delimiter
