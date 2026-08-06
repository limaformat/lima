//! Shared, domain-agnostic parsing primitives — mirrors `js/src/normalize.ts`.

use crate::errors::{LimaDiagnosticCode as Code, LimaError};

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

/// `onWarning` (the non-strict "report but don't fail" channel from the TS
/// source) isn't wired up in this port yet — non-strict duplicates are
/// simply allowed through silently, matching the "no `onWarning` callback
/// provided" case in `js/src/normalize.ts`, which is itself required to
/// discard silently rather than fall back to any implicit output channel
/// (Core §11.2).
pub fn check_duplicate_key(
    exists: bool,
    key: &str,
    line: u32,
    strict: bool,
) -> Result<(), LimaError> {
    if !exists || !strict {
        return Ok(());
    }
    Err(LimaError::new(
        Code::DuplicateKey,
        line,
        format!("Lima: duplicate key \"{key}\" at line {line} — last value wins"),
    ))
}
