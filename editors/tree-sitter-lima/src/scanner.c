#include "tree_sitter/parser.h"
#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include "unicode_key_table.h"

enum TokenType {
  NEWLINE,
  INDENT,
  DEDENT,
  DASH,
  KEY,
  UNRECOGNIZED_LINE,
  BLOCK_SCALAR_MARKER,
  BLOCK_NEWLINE,
  CONTINUATION,
  PLAIN_TEXT,
  FLOW_TEXT,
  BLOCK_TEXT,
  NULL_TOKEN,
  BOOLEAN_TOKEN,
  NUMBER_TOKEN,
  DATE_TOKEN,
  COMMENT,
};

#define INDENT_STACK_MAX 64

typedef struct {
  uint16_t inds[INDENT_STACK_MAX];
  uint16_t ind_len;
  bool in_bs;
  bool bs_need_enter;
  bool bs_line_start;
  uint16_t bs_key_indent;
  bool pending_obj;
  uint16_t obj_indent;
  bool line_start;
} Scanner;

static bool is_ws(int32_t c) { return c == ' ' || c == '\t'; }
static bool is_nl(int32_t c) { return c == '\n' || c == '\r'; }
static bool is_trim_ws(int32_t c) {
  return c == 0x0009 || (c >= 0x000a && c <= 0x000d) || c == 0x0020 || c == 0x00a0 ||
         c == 0x1680 || (c >= 0x2000 && c <= 0x200a) || c == 0x2028 || c == 0x2029 ||
         c == 0x202f || c == 0x205f || c == 0x3000 || c == 0xfeff;
}

static uint16_t top_ind(Scanner *s) {
  return s->ind_len == 0 ? 0 : s->inds[s->ind_len - 1];
}

static void push_ind(Scanner *s, uint16_t v) {
  if (s->ind_len < INDENT_STACK_MAX) s->inds[s->ind_len++] = v;
}

static void pop_ind(Scanner *s) {
  if (s->ind_len > 1) s->ind_len--;
}

static void skip_hws(TSLexer *lexer) {
  while (is_ws(lexer->lookahead)) lexer->advance(lexer, true);
}

static uint32_t unicode_key_category(int32_t c) {
  uint32_t low = 0;
  uint32_t high = lima_unicode_key_ranges_len / 3;
  while (low < high) {
    uint32_t mid = (low + high) >> 1;
    uint32_t offset = mid * 3;
    if ((uint32_t)c < lima_unicode_key_ranges[offset]) high = mid;
    else if ((uint32_t)c > lima_unicode_key_ranges[offset + 1]) low = mid + 1;
    else return lima_unicode_key_ranges[offset + 2];
  }
  return 0;
}

static bool is_key_initial(int32_t c) {
  if (c <= 0x7f) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') ||
           (c >= 'A' && c <= 'Z') || c == '_';
  }
  return (unicode_key_category(c) & 5) != 0;
}

static bool is_key_character(int32_t c) {
  if (c <= 0x7f) return is_key_initial(c) || c == ':' || c == '-' || c == '*';
  return c == 0xb7 || unicode_key_category(c) != 0;
}

static bool is_key_start(int32_t c) {
  return is_key_initial(c) || c == '"' || c == '\'';
}

// ---- lifecycle ----

void *tree_sitter_lima_external_scanner_create(void) {
  Scanner *s = (Scanner *)calloc(1, sizeof(Scanner));
  s->inds[0] = 0;
  s->ind_len = 1;
  s->line_start = true;
  return s;
}

void tree_sitter_lima_external_scanner_destroy(void *p) { free(p); }

unsigned tree_sitter_lima_external_scanner_serialize(void *p, char *buffer) {
  Scanner *s = (Scanner *)p;
  unsigned size = 0;
  buffer[size++] = (char)s->ind_len;
  for (uint16_t i = 1; i < s->ind_len; i++) {
    buffer[size++] = (char)(s->inds[i] & 0xff);
    buffer[size++] = (char)(s->inds[i] >> 8);
  }
  buffer[size++] = s->in_bs ? 1 : 0;
  buffer[size++] = s->bs_need_enter ? 1 : 0;
  buffer[size++] = s->bs_line_start ? 1 : 0;
  buffer[size++] = (char)(s->bs_key_indent & 0xff);
  buffer[size++] = (char)(s->bs_key_indent >> 8);
  buffer[size++] = s->pending_obj ? 1 : 0;
  buffer[size++] = (char)(s->obj_indent & 0xff);
  buffer[size++] = (char)(s->obj_indent >> 8);
  buffer[size++] = s->line_start ? 1 : 0;
  return size;
}

void tree_sitter_lima_external_scanner_deserialize(void *p, const char *buffer, unsigned length) {
  Scanner *s = (Scanner *)p;
  s->inds[0] = 0;
  s->ind_len = 1;
  s->in_bs = false;
  s->bs_need_enter = false;
  s->bs_line_start = false;
  s->bs_key_indent = 0;
  s->pending_obj = false;
  s->obj_indent = 0;
  s->line_start = true;
  if (length == 0) return;
  unsigned size = 0;
  uint16_t n = (unsigned char)buffer[size++];
  if (n > INDENT_STACK_MAX) n = INDENT_STACK_MAX;
  for (uint16_t i = 1; i < n && size + 1 < length; i++) {
    uint16_t v = (unsigned char)buffer[size++];
    v |= (unsigned char)buffer[size++] << 8;
    s->inds[s->ind_len++] = v;
  }
  if (size < length) s->in_bs = buffer[size++] != 0;
  if (size < length) s->bs_need_enter = buffer[size++] != 0;
  if (size < length) s->bs_line_start = buffer[size++] != 0;
  if (size + 1 < length) {
    s->bs_key_indent = (unsigned char)buffer[size++];
    s->bs_key_indent |= (unsigned char)buffer[size++] << 8;
  }
  if (size < length) s->pending_obj = buffer[size++] != 0;
  if (size + 1 < length) {
    s->obj_indent = (unsigned char)buffer[size++];
    s->obj_indent |= (unsigned char)buffer[size++] << 8;
  }
  if (size < length) s->line_start = buffer[size++] != 0;
}

// ---- block scalar marker ----

static bool scan_block_scalar_marker(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
  if (lexer->lookahead != '|') return false;
  lexer->advance(lexer, false);
  // Not skipped: a `|` that is no marker stays the start of the value's token.
  lexer->mark_end(lexer);
  bool spaced = false;
  while (is_ws(lexer->lookahead)) {
    lexer->advance(lexer, false);
    spaced = true;
  }
  // `| # c` is the string `|` and a comment: the marker stands alone (§6.1.5).
  if (spaced && lexer->lookahead == '#' && valid_symbols[PLAIN_TEXT]) {
    lexer->result_symbol = PLAIN_TEXT;
    return true;
  }
  if (lexer->lookahead != '\n' && lexer->lookahead != '\r' && lexer->lookahead != 0) {
    return false;
  }
  lexer->mark_end(lexer);
  if (lexer->lookahead == '\r') {
    lexer->advance(lexer, true);
    if (lexer->lookahead == '\n') lexer->advance(lexer, true);
  } else if (lexer->lookahead == '\n') {
    lexer->advance(lexer, true);
  }
  s->in_bs = true;
  s->bs_need_enter = false;
  s->bs_line_start = true;
  s->bs_key_indent = top_ind(s);
  lexer->result_symbol = BLOCK_SCALAR_MARKER;
  return true;
}

// ---- dash ----

static bool scan_dash(Scanner *s, TSLexer *lexer) {
  if (lexer->lookahead != '-') return false;
  uint32_t dash_col = lexer->get_column(lexer);
  lexer->advance(lexer, false);
  if (!is_trim_ws(lexer->lookahead) && lexer->lookahead != 0) return false;
  lexer->mark_end(lexer);
  bool object_item = false;
  skip_hws(lexer);
  if (is_key_start(lexer->lookahead)) {
    bool quoted = lexer->lookahead == '"' || lexer->lookahead == '\'';
    int32_t quote = quoted ? lexer->lookahead : 0;
    bool escaped = false;
    bool valid_key = true;
    bool first = true;
    for (;;) {
      int32_t c = lexer->lookahead;
      if (c == '\n' || c == '\r' || c == 0) break;
      lexer->advance(lexer, true);
      if (quoted) {
        if (escaped) escaped = false;
        else if (quote == '"' && c == '\\') escaped = true;
        else if (c == quote) quoted = false;
        continue;
      }
      if (c == ':' && !quoted) {
        int32_t d = lexer->lookahead;
        if (d == ' ' || d == '\n' || d == '\r' || d == 0) {
          object_item = valid_key;
          break;
        }
        // ':' followed by a key char is part of the key; keep scanning
      } else if (!quote && !(first ? is_key_initial(c) : is_key_character(c))) {
        valid_key = false;
      }
      first = false;
    }
  }
  if (object_item) {
    s->pending_obj = true;
    s->obj_indent = (uint16_t)(dash_col + 2);
  }
  lexer->result_symbol = DASH;
  return true;
}

// ---- unquoted key ----

// ---- unrecognized line (non-strict §4 skip recovery) ----

static bool scan_unrecognized_line(TSLexer *lexer) {
  int32_t c = lexer->lookahead;
  if (c == '\n' || c == '\r' || c == 0) return false;
  if (c == '#') return false;
  bool consumed = false;
  while (c != '\n' && c != '\r' && c != 0) {
    lexer->advance(lexer, false);
    consumed = true;
    c = lexer->lookahead;
  }
  if (!consumed) return false;
  if (c == '\n' || c == '\r') {
    lexer->advance(lexer, false);
  }
  lexer->mark_end(lexer);
  lexer->result_symbol = UNRECOGNIZED_LINE;
  return true;
}

// ---- block scalar body ----

static bool scan_block_text(TSLexer *lexer) {
  bool started = false;
  for (;;) {
    int32_t c = lexer->lookahead;
    if (c == '\n' || c == '\r' || c == 0) break;
    if (c == '$') break;
    lexer->advance(lexer, false);
    started = true;
  }
  if (!started) return false;
  lexer->mark_end(lexer);
  lexer->result_symbol = BLOCK_TEXT;
  return true;
}

static bool scan_bs_body(Scanner *s, TSLexer *lexer) {
  if (s->bs_need_enter) {
    while (is_nl(lexer->lookahead)) lexer->advance(lexer, true);
    s->bs_need_enter = false;
    s->bs_line_start = true;
  }

  // At the start of a body line: skip indentation and dispatch on the content.
  if (s->bs_line_start) {
    uint32_t indent = 0;
    while (is_ws(lexer->lookahead)) {
      indent++;
      lexer->advance(lexer, true);
    }

    int32_t c = lexer->lookahead;

    if (is_nl(c)) {
      // blank line (content)
      lexer->advance(lexer, false);
      lexer->mark_end(lexer);
      lexer->result_symbol = BLOCK_NEWLINE;
      return true;
    }

    if (c == 0) {
      s->in_bs = false;
      lexer->mark_end(lexer);
      lexer->result_symbol = DEDENT;
      return true;
    }

    if (indent <= s->bs_key_indent) {
      s->in_bs = false;
      lexer->mark_end(lexer);
      lexer->result_symbol = DEDENT;
      return true;
    }
    if (c == '^') {
      lexer->advance(lexer, false);
      if (lexer->lookahead == '^') {
        lexer->advance(lexer, false);
        lexer->mark_end(lexer);
        lexer->result_symbol = CONTINUATION;
        s->bs_line_start = false;
        return true;
      }
    }

    s->bs_line_start = false;
  }

  // Mid-line content: scan block text until a newline or '$'.
  if (scan_block_text(lexer)) {
    return true;
  }

  // A line terminator reached mid-line.
  if (is_nl(lexer->lookahead)) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    lexer->result_symbol = BLOCK_NEWLINE;
    s->bs_line_start = true;
    return true;
  }

  return false;
}

// ---- plain / flow text + scalar classification ----

static bool is_digit(int32_t c) { return c >= '0' && c <= '9'; }

static bool match_null(const char *s) {
  return strcmp(s, "null") == 0 || strcmp(s, "~") == 0;
}

static bool match_bool(const char *s) {
  return strcmp(s, "true") == 0 || strcmp(s, "false") == 0;
}

static bool all_digits(const char *s, int i, int j) {
  if (i >= j) return false;
  for (; i < j; i++) if (!is_digit(s[i])) return false;
  return true;
}

static bool match_number(const char *s, int n) {
  int i = 0;
  if (i < n && s[i] == '-') i++;
  if (i < n && s[i] == '.') {
    // leading decimal: "." digits+
    i++;
    int j = i;
    while (j < n && is_digit(s[j])) j++;
    if (j == i) return false;
    i = j;
  } else if (i < n && s[i] == '0') {
    i++;
    if (i < n && is_digit(s[i])) return false; // leading zero
    if (i < n && s[i] == '.') {
      i++;
      int j = i;
      while (j < n && is_digit(s[j])) j++;
      if (j == i) return false;
      i = j;
    }
  } else if (i < n && s[i] >= '1' && s[i] <= '9') {
    i++;
    while (i < n && is_digit(s[i])) i++;
    if (i < n && s[i] == '.') {
      i++;
      int j = i;
      while (j < n && is_digit(s[j])) j++;
      if (j == i) return false;
      i = j;
    }
  } else {
    return false;
  }
  if (i < n && (s[i] == 'e' || s[i] == 'E')) {
    i++;
    if (i < n && (s[i] == '+' || s[i] == '-')) i++;
    int j = i;
    while (j < n && is_digit(s[j])) j++;
    if (j == i) return false;
    i = j;
  }
  return i == n;
}

// Match "HH:MM[:SS]" at s[i..n), returning new index or -1.
static int match_time(const char *s, int n, int i) {
  if (i + 5 > n) return -1;
  if (!is_digit(s[i]) || !is_digit(s[i + 1])) return -1;
  if (s[i + 2] != ':') return -1;
  if (!is_digit(s[i + 3]) || !is_digit(s[i + 4])) return -1;
  int j = i + 5;
  if (j + 2 <= n && s[j] == ':') {
    if (!is_digit(s[j + 1]) || !is_digit(s[j + 2])) return -1;
    j += 3;
  }
  return j;
}

static bool match_date(const char *s, int n) {
  int i = 0;

  // ISO date: YYYY-MM-DD [ T time [offset] ]
  if (n >= 10 && all_digits(s, 0, 4) && s[4] == '-' && all_digits(s, 5, 7) && s[7] == '-' &&
      all_digits(s, 8, 10)) {
    i = 10;
    if (i < n && s[i] == 'T') {
      i = match_time(s, n, i + 1);
      if (i < 0) return false;
      // offset: Z or ±HH:MM
      if (i < n) {
        if (s[i] == 'Z') {
          i++;
        } else if ((s[i] == '+' || s[i] == '-') && i + 6 <= n && all_digits(s, i + 1, i + 3) &&
                   s[i + 3] == ':' && all_digits(s, i + 4, i + 6)) {
          i += 6;
        } else {
          return false;
        }
      }
    }
    return i == n;
  }

  // German date: D[.D]? . D[.D]? . YYYY [ space time ]
  {
    i = 0;
    int day = 0;
    while (i < n && is_digit(s[i]) && day < 2) { i++; day++; }
    if (day == 0 || i >= n || s[i] != '.') goto slash;
    i++;
    int month = 0;
    while (i < n && is_digit(s[i]) && month < 2) { i++; month++; }
    if (month == 0 || i >= n || s[i] != '.') goto slash;
    i++;
    if (i + 4 > n || !all_digits(s, i, i + 4)) goto slash;
    i += 4;
    if (i < n) {
      if (s[i] != ' ') return false;
      i = match_time(s, n, i + 1);
      if (i < 0) return false;
    }
    return i == n;
  }

slash:
  // Slash date: YYYY/MM/DD [ space time ]
  if (n >= 10 && all_digits(s, 0, 4) && s[4] == '/' && all_digits(s, 5, 7) && s[7] == '/' &&
      all_digits(s, 8, 10)) {
    i = 10;
    if (i < n) {
      if (s[i] != ' ') return false;
      i = match_time(s, n, i + 1);
      if (i < 0) return false;
    }
    return i == n;
  }

  return false;
}

static bool scan_quoted_fallback(TSLexer *lexer, const bool *valid_symbols) {
  int32_t quote = lexer->lookahead;
  if (quote != '\'' && quote != '"') return false;

  bool escaped = false;
  bool closed = false;
  bool trailing = false;
  lexer->advance(lexer, false);
  for (;;) {
    int32_t c = lexer->lookahead;
    if (c == '\n' || c == '\r' || c == 0) break;
    lexer->advance(lexer, false);
    if (closed) {
      if (c == ':' && valid_symbols[KEY]) return false;
      if (c != ' ' && c != '\t' && c != '#') trailing = true;
      if (c == '#') {
        while (lexer->lookahead != '\n' && lexer->lookahead != '\r' && lexer->lookahead != 0) {
          lexer->advance(lexer, false);
        }
        break;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
    } else if (c == '\\') {
      escaped = true;
    } else if (c == quote) {
      closed = true;
    }
  }

  if (valid_symbols[PLAIN_TEXT] && (!closed || trailing)) {
    lexer->mark_end(lexer);
    lexer->result_symbol = PLAIN_TEXT;
    return true;
  }

  if (!closed && valid_symbols[UNRECOGNIZED_LINE]) {
    if (lexer->lookahead == '\r') {
      lexer->advance(lexer, false);
      if (lexer->lookahead == '\n') lexer->advance(lexer, false);
    } else if (lexer->lookahead == '\n') {
      lexer->advance(lexer, false);
    }
    lexer->mark_end(lexer);
    lexer->result_symbol = UNRECOGNIZED_LINE;
    return true;
  }

  return false;
}

static bool scan_flow_fallback(TSLexer *lexer, const bool *valid_symbols) {
  if (!valid_symbols[PLAIN_TEXT]) return false;
  int32_t opening = lexer->lookahead;
  if (opening != '[' && opening != '{') return false;

  int depth = 0;
  int32_t quote = 0;
  bool escaped = false;
  bool invalid_mapping_item = false;
  bool item_content = false;
  bool item_colon = false;
  bool key_space = false;

  for (;;) {
    int32_t c = lexer->lookahead;
    if (c == '\n' || c == '\r' || c == 0) break;
    lexer->advance(lexer, false);
    if (quote) {
      if (escaped) escaped = false;
      else if (c == '\\') escaped = true;
      else if (c == quote) quote = 0;
      continue;
    }
    if (c == '\'' || c == '"') {
      quote = c;
      item_content = true;
      continue;
    }
    if (c == '[' || c == '{') {
      depth++;
      if (depth > 1) item_content = true;
      continue;
    }
    if (c == ']' || c == '}') {
      depth--;
      if (depth == 0) {
        if (opening == '{' && item_content && !item_colon) invalid_mapping_item = true;
        break;
      }
      continue;
    }
    if (depth == 1 && opening == '{') {
      if (c == ':') item_colon = true;
      else if (c == ',') {
        if (!item_content || !item_colon) invalid_mapping_item = true;
        item_content = false;
        item_colon = false;
        key_space = false;
      } else if (!item_colon && (c == ' ' || c == '\t')) {
        if (item_content) key_space = true;
      } else if (!item_colon) {
        bool key_char = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                        (c >= '0' && c <= '9') || c == '_' || c == '-';
        if (!key_char || key_space) invalid_mapping_item = true;
        item_content = true;
      } else if (c != ' ' && c != '\t') {
        item_content = true;
      }
    }
  }

  if (depth == 0 && !invalid_mapping_item) return false;
  while (lexer->lookahead != '\n' && lexer->lookahead != '\r' && lexer->lookahead != 0) {
    lexer->advance(lexer, false);
  }
  lexer->mark_end(lexer);
  lexer->result_symbol = PLAIN_TEXT;
  return true;
}

static bool scan_value(Scanner *s, TSLexer *lexer, bool flow, const bool *valid_symbols) {
  int32_t c = lexer->lookahead;
  bool can_key = valid_symbols[KEY];
  bool can_unrec = valid_symbols[UNRECOGNIZED_LINE];
  uint32_t start_column = lexer->get_column(lexer);
  bool key_position = start_column >= top_ind(s) ||
                      (s->pending_obj && start_column == s->obj_indent);

  if (c == '#' || c == '\n' || c == '\r' || c == 0) return false;
  if (c == '$' && !(can_key && key_position)) return false;
  if (c == '"' || c == '\'') return false;
  if (c == '[' || c == '{') return false;

  char buf[80];
  int len = 0;
  bool dollar = false;
  unsigned backslashes = 0;
  bool started = false;
  bool valid_key = true;
  bool first_key_character = true;

  lexer->mark_end(lexer);

  for (;;) {
    c = lexer->lookahead;
    if (c == '\n' || c == '\r' || c == 0) break;
    if (c == '$') {
      if (can_unrec || (can_key && key_position)) {
        if (can_key && key_position) {
          valid_key = false;
          first_key_character = false;
        }
        if (len < 79) buf[len++] = (char)c;
        lexer->advance(lexer, false);
        backslashes = 0;
        started = true;
        continue;
      }
      dollar = true;
      break;
    }
    if (flow && (c == ',' || c == ']' || c == '}')) break;
    if (c == '#') {
      if (backslashes % 2 == 1) {
        if (len < 79) buf[len++] = (char)c;
        lexer->advance(lexer, false);
        backslashes = 0;
        started = true;
        continue;
      }
      break;
    }
    if (c == ':') {
      lexer->mark_end(lexer);
      lexer->advance(lexer, false);
      int32_t d = lexer->lookahead;
      if (d == ' ' || d == '\n' || d == '\r' || d == 0) {
        // ':' separator → this is a key
        if (can_key && key_position && valid_key) {
          lexer->result_symbol = KEY;
          return true;
        }
        // In a scalar, colon-space is ordinary content (for example
        // "label: Value: ${name}").
        if (len < 79) buf[len++] = ':';
        backslashes = 0;
        started = true;
        continue;
      }
      // ':' followed by a non-space char is part of the key/value
      if (len < 79) buf[len++] = ':';
      backslashes = 0;
      started = true;
      continue;
    }
    if (can_key && key_position &&
        !(first_key_character ? is_key_initial(c) : is_key_character(c))) {
      valid_key = false;
    }
    first_key_character = false;
    if (len < 79) buf[len++] = (char)c;
    if (c == '\\') backslashes++;
    else backslashes = 0;
    lexer->advance(lexer, false);
    started = true;
  }

  if (!started) return false;

  if (dollar) {
    if (valid_symbols[PLAIN_TEXT] || valid_symbols[FLOW_TEXT]) {
      lexer->mark_end(lexer);
      lexer->result_symbol = flow ? FLOW_TEXT : PLAIN_TEXT;
      return true;
    }
    return false;
  }

  if (can_unrec) {
    while (c != '\n' && c != '\r' && c != 0) {
      lexer->advance(lexer, false);
      c = lexer->lookahead;
    }
    if (c == '\n' || c == '\r') lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    lexer->result_symbol = UNRECOGNIZED_LINE;
    return true;
  }

  if (len > 0 && len < 79) {
    buf[len] = 0;
    if (valid_symbols[NULL_TOKEN] && match_null(buf)) {
      lexer->mark_end(lexer);
      lexer->result_symbol = NULL_TOKEN;
      return true;
    }
    if (valid_symbols[BOOLEAN_TOKEN] && match_bool(buf)) {
      lexer->mark_end(lexer);
      lexer->result_symbol = BOOLEAN_TOKEN;
      return true;
    }
    if (valid_symbols[NUMBER_TOKEN] && match_number(buf, len)) {
      lexer->mark_end(lexer);
      lexer->result_symbol = NUMBER_TOKEN;
      return true;
    }
    if (valid_symbols[DATE_TOKEN] && match_date(buf, len)) {
      lexer->mark_end(lexer);
      lexer->result_symbol = DATE_TOKEN;
      return true;
    }
  }

  if (valid_symbols[PLAIN_TEXT] || valid_symbols[FLOW_TEXT]) {
    lexer->mark_end(lexer);
    lexer->result_symbol = flow ? FLOW_TEXT : PLAIN_TEXT;
    return true;
  }

  return false;
}

// ---- newline / indent / dedent ----

static bool scan_structural(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
  lexer->mark_end(lexer);

  if (s->pending_obj) {
    push_ind(s, s->obj_indent);
    s->pending_obj = false;
  }

  uint16_t indent_length = 0;
  bool found_eol = false;

  for (;;) {
    int32_t c = lexer->lookahead;
    if (c == '\n') {
      found_eol = true;
      indent_length = 0;
      lexer->advance(lexer, true);
    } else if (c == ' ') {
      indent_length++;
      lexer->advance(lexer, true);
    } else if (c == '\t') {
      indent_length += 2;
      lexer->advance(lexer, true);
    } else if (c == '\r') {
      found_eol = true;
      indent_length = 0;
      lexer->advance(lexer, true);
      if (lexer->lookahead == '\n') {
        lexer->advance(lexer, true);
      }
    } else if (c == '#') {
      break;
    } else if (c == 0) {
      found_eol = true;
      indent_length = 0;
      break;
    } else {
      break;
    }
  }

  if (!found_eol) return false;

  uint16_t cur = top_ind(s);

  // Core §7.1 rule 7: a comment line does not affect indentation. The token ends before the comment, which follows
  // as its own node; the indentation that decides is the next content line's, found by looking past comment and
  // blank lines (EOF: 0).
  bool peeked = false;
  if (lexer->lookahead == '#') {
    lexer->mark_end(lexer);
    peeked = true;
    for (;;) {
      while (lexer->lookahead != '\n' && lexer->lookahead != '\r' && lexer->lookahead != 0) {
        lexer->advance(lexer, false);
      }
      if (lexer->lookahead == 0) {
        indent_length = 0;
        break;
      }
      if (lexer->lookahead == '\r') lexer->advance(lexer, false);
      if (lexer->lookahead == '\n') lexer->advance(lexer, false);
      indent_length = 0;
      while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
        indent_length += lexer->lookahead == '\t' ? 2 : 1;
        lexer->advance(lexer, false);
      }
      int32_t next = lexer->lookahead;
      if (next == 0) {
        indent_length = 0;
        break;
      }
      if (next != '#' && next != '\n' && next != '\r') break;
    }
  }

  // Core 1.1 §7.2: a bare key may open a compact sequence in its own
  // column. A duplicate indentation-stack value represents that synthetic
  // block until the first same-column line that is not an item.
  bool item = false;
  bool item_peeked = false;
  if (lexer->lookahead == '-') {
    lexer->mark_end(lexer);
    lexer->advance(lexer, false);
    item_peeked = true;
    item = is_trim_ws(lexer->lookahead) || lexer->lookahead == 0;
  }
  bool compact = s->ind_len > 1 && s->inds[s->ind_len - 1] == s->inds[s->ind_len - 2];
  if (valid_symbols[INDENT] && indent_length == cur && item) {
    push_ind(s, cur);
    lexer->result_symbol = INDENT;
    s->line_start = true;
    return true;
  }
  if (valid_symbols[DEDENT] && compact && indent_length == cur && !item) {
    pop_ind(s);
    lexer->result_symbol = DEDENT;
    s->line_start = true;
    return true;
  }

  if (valid_symbols[INDENT] && indent_length > cur) {
    push_ind(s, indent_length);
    if (!peeked && !item_peeked) lexer->mark_end(lexer);
    lexer->result_symbol = INDENT;
    s->line_start = true;
    return true;
  }

  if (valid_symbols[DEDENT] && indent_length < cur) {
    pop_ind(s);
    if (!peeked && !item_peeked) lexer->mark_end(lexer);
    lexer->result_symbol = DEDENT;
    s->line_start = true;
    return true;
  }

  if (valid_symbols[NEWLINE]) {
    if (!peeked && !item_peeked) lexer->mark_end(lexer);
    lexer->result_symbol = NEWLINE;
    s->line_start = true;
    return true;
  }

  return false;
}

// ---- main scan ----

bool tree_sitter_lima_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  Scanner *s = (Scanner *)payload;

  if (s->in_bs && (valid_symbols[BLOCK_TEXT] || valid_symbols[BLOCK_NEWLINE] ||
                   valid_symbols[CONTINUATION] || valid_symbols[DEDENT])) {
    return scan_bs_body(s, lexer);
  }

  bool starts_at_line_start = s->line_start || lexer->get_column(lexer) == 0;
  skip_hws(lexer);

  int32_t c = lexer->lookahead;

  // Core §7.1 rule 6: a blank line at the start of a line, where no structural token is wanted (after a comment line,
  // which takes its own newline), is skipped like whitespace.
  while (starts_at_line_start && (c == '\n' || c == '\r') &&
         !(valid_symbols[NEWLINE] || valid_symbols[INDENT] || valid_symbols[DEDENT])) {
    lexer->advance(lexer, true);
    skip_hws(lexer);
    c = lexer->lookahead;
  }

  // Comment (external + extra): emit a comment node for a '#' at any position.
  if (c == '#' && valid_symbols[COMMENT]) {
    while (c != '\n' && c != '\r' && c != 0) {
      lexer->advance(lexer, false);
      c = lexer->lookahead;
    }
    if (starts_at_line_start && c == '\r') {
      lexer->advance(lexer, false);
      if (lexer->lookahead == '\n') lexer->advance(lexer, false);
    } else if (starts_at_line_start && c == '\n') {
      lexer->advance(lexer, false);
    }
    lexer->mark_end(lexer);
    lexer->result_symbol = COMMENT;
    s->line_start = starts_at_line_start;
    return true;
  }

  if ((c == '\n' || c == '\r' || c == 0) &&
      (valid_symbols[NEWLINE] || valid_symbols[INDENT] || valid_symbols[DEDENT])) {
    return scan_structural(s, lexer, valid_symbols);
  }

  // Dedent detected at a content position: the previous line's newline was
  // consumed by an entry's own _newline token, and the following content is
  // now at a shallower indentation than the current block.
  bool compact = s->ind_len > 1 && s->inds[s->ind_len - 1] == s->inds[s->ind_len - 2];
  if (valid_symbols[DEDENT] && compact && c != '-' &&
      lexer->get_column(lexer) == top_ind(s)) {
    pop_ind(s);
    lexer->mark_end(lexer);
    lexer->result_symbol = DEDENT;
    s->line_start = true;
    return true;
  }
  if (valid_symbols[DEDENT] && c != '\n' && c != '\r' && c != 0 &&
      lexer->get_column(lexer) < top_ind(s)) {
    pop_ind(s);
    lexer->mark_end(lexer);
    lexer->result_symbol = DEDENT;
    s->line_start = true;
    return true;
  }

  if (c == '|' && valid_symbols[BLOCK_SCALAR_MARKER]) {
    if (scan_block_scalar_marker(s, lexer, valid_symbols)) {
      s->line_start = false;
      return true;
    }
  }

  if (c == '-' && valid_symbols[DASH]) {
    bool scanned = scan_dash(s, lexer);
    if (scanned) s->line_start = false;
    return scanned;
  }

  if (c == '\'' || c == '"') {
    bool scanned = scan_quoted_fallback(lexer, valid_symbols);
    if (scanned) s->line_start = valid_symbols[UNRECOGNIZED_LINE];
    return scanned;
  }

  if ((c == '[' || c == '{') && scan_flow_fallback(lexer, valid_symbols)) {
    s->line_start = false;
    return true;
  }

  if (valid_symbols[PLAIN_TEXT] || valid_symbols[FLOW_TEXT] || valid_symbols[NULL_TOKEN] ||
      valid_symbols[BOOLEAN_TOKEN] || valid_symbols[NUMBER_TOKEN] || valid_symbols[DATE_TOKEN] ||
      valid_symbols[KEY]) {
    if (scan_value(s, lexer, valid_symbols[FLOW_TEXT], valid_symbols)) {
      s->line_start = false;
      return true;
    }
  }

  if (valid_symbols[UNRECOGNIZED_LINE]) {
    bool scanned = scan_unrecognized_line(lexer);
    if (scanned) s->line_start = true;
    return scanned;
  }

  return false;
}
