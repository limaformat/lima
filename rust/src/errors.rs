//! Structured internal diagnostics — mirrors `js/src/errors.ts`.
//!
//! Core §11.3 requires the public parser API to behave like a plain error
//! type with a message; `LimaError` carries the same message text plus
//! additional, non-normative fields that let a caller inspect *why* a parse
//! failed without re-parsing the message string.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LimaDiagnosticCode {
    InvalidEscape,
    InvalidQuote,
    InvalidDate,
    InvalidNumber,
    InvalidReferenceShape,
    InvalidIndentation,
    InvalidFlowSyntax,
    DuplicateKey,
    ResourceLimit,
    UnresolvedReference,
    InvalidInterpolation,
    InvalidPartial,
}

#[derive(Debug, Clone)]
pub struct LimaError {
    pub code: LimaDiagnosticCode,
    pub message: String,
    pub line: Option<u32>,
    pub key: Option<String>,
}

impl LimaError {
    pub fn new(code: LimaDiagnosticCode, line: u32, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            line: Some(line),
            key: None,
        }
    }
}

impl fmt::Display for LimaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for LimaError {}
