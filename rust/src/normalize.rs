//! Shared, domain-agnostic parsing primitives — mirrors `js/src/normalize.ts`.

use crate::errors::{Diagnostic, LimaDiagnosticCode as Code, LimaError};
use std::cell::RefCell;

thread_local! {
    static WARNINGS: RefCell<Option<Vec<Diagnostic>>> = const { RefCell::new(None) };
}

pub(crate) fn begin_warning_collection(enabled: bool) {
    WARNINGS.with(|slot| *slot.borrow_mut() = enabled.then(Vec::new));
}

pub(crate) fn finish_warning_collection() -> Vec<Diagnostic> {
    WARNINGS.with(|slot| slot.borrow_mut().take().unwrap_or_default())
}

// Core §9 resource limits. All are hard errors in both modes.
pub const DOCUMENT_SIZE_LIMIT: usize = 65_536;
pub const KEY_LENGTH_LIMIT: usize = 128;
pub const TOP_LEVEL_KEY_LIMIT: usize = 128;
pub const NESTING_DEPTH_LIMIT: usize = 16;

pub fn check_key_length(key: &str, line: u32) -> Result<(), LimaError> {
    if key.chars().count() > KEY_LENGTH_LIMIT {
        return Err(LimaError::new(
            Code::ResourceLimit,
            line,
            format!("Lima: key \"{key}\" exceeds maximum length of {KEY_LENGTH_LIMIT} code points at line {line}"),
        ));
    }
    Ok(())
}

pub fn check_duplicate_key(
    exists: bool,
    key: &str,
    line: u32,
    strict: bool,
) -> Result<(), LimaError> {
    if !exists {
        return Ok(());
    }
    let message = format!("Lima: duplicate key \"{key}\" at line {line} — last value wins");
    if !strict {
        WARNINGS.with(|slot| {
            if let Some(warnings) = slot.borrow_mut().as_mut() {
                warnings.push(Diagnostic { message, line });
            }
        });
        return Ok(());
    }
    Err(LimaError::new(Code::DuplicateKey, line, message))
}
