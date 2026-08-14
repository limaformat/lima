//! Structured internal diagnostics — mirrors `js/src/errors.ts`.
//!
//! Core §11.3 requires the public parser API to behave like a plain error
//! type with a message; `LimaError` carries the same message text plus
//! additional, non-normative fields that let a caller inspect *why* a parse
//! failed without re-parsing the message string.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub message: String,
    pub line: u32,
}

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
    pub token: Option<Box<str>>,
    pub partial: Option<Box<str>>,
    pub path: Option<Box<str>>,
    pub column: Option<u32>,
}

impl LimaError {
    pub fn new(code: LimaDiagnosticCode, line: u32, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            line: Some(line),
            key: None,
            token: None,
            partial: None,
            path: None,
            column: None,
        }
    }

    pub fn diagnostic(
        code: LimaDiagnosticCode,
        message: impl Into<String>,
        line: Option<u32>,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            line,
            key: None,
            token: None,
            partial: None,
            path: None,
            column: None,
        }
    }
}

impl fmt::Display for LimaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for LimaError {}
