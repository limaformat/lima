//! Mirrors `js/src/block-cursor.ts`. Positions are byte offsets into the
//! UTF-8 `&str` (the TS source uses UTF-16 code-unit offsets — the two
//! coincide for all-ASCII structural characters, which indentation and line
//! boundaries always are in practice; genuinely multi-byte indentation
//! whitespace is an edge case this port does not attempt to track at
//! code-point granularity, only byte-delta).

use crate::chars::is_trim_whitespace;

/// Allocation-free physical-line cursor over one top-level block extent.
pub struct BlockCursor<'a> {
    pub source: &'a str,
    range_end: usize,
    next_start: usize,

    pub line_start: usize,
    pub line_end: usize,
    pub content_start: usize,
    pub indent: usize,
    pub ascii_indent: usize,
    pub line_index: i64,
    pub valid: bool,
    pub max_indent: usize,
}

impl<'a> BlockCursor<'a> {
    pub fn new(source: &'a str, range_start: usize, range_end: usize) -> Self {
        Self {
            source,
            range_end,
            next_start: range_start,
            line_start: 0,
            line_end: 0,
            content_start: 0,
            indent: 0,
            ascii_indent: 0,
            line_index: -1,
            valid: false,
            max_indent: 0,
        }
    }

    pub fn next(&mut self) -> bool {
        if self.next_start >= self.range_end {
            self.valid = false;
            return false;
        }

        let start = self.next_start;
        let b = self.source.as_bytes();
        let newline = b[start..self.range_end]
            .iter()
            .position(|&c| c == b'\n')
            .map(|p| start + p);
        let end = newline.unwrap_or(self.range_end);

        let mut content = start;
        while content < end && b[content] == b' ' {
            content += 1;
        }
        let ascii_end = content;
        // After ordinary space indentation, printable ASCII starts content
        // immediately. Only ASCII control whitespace or non-ASCII code
        // points need the complete is_trim_whitespace predicate.
        if content < end {
            let code = b[content];
            if (0x09..=0x0d).contains(&code) || code > 0x7f {
                while content < end {
                    let ch = self.source[content..].chars().next().unwrap();
                    if !is_trim_whitespace(ch) {
                        break;
                    }
                    content += ch.len_utf8();
                }
            }
        }

        self.line_start = start;
        self.line_end = end;
        self.content_start = content;
        self.ascii_indent = ascii_end - start;
        self.indent = content - start;
        if self.indent > self.max_indent {
            self.max_indent = self.indent;
        }
        self.line_index += 1;
        self.valid = true;
        self.next_start = newline.map(|n| n + 1).unwrap_or(self.range_end);
        true
    }

    pub fn empty(&self) -> bool {
        self.content_start == self.line_end
    }

    /// First byte of content on this line — ASCII-only callers (`b'-'`,
    /// `b'#'`, quote characters), matching every call site in `block.rs`.
    pub fn first_byte(&self) -> u8 {
        self.source.as_bytes()[self.content_start]
    }
}
