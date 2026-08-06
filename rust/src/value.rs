//! Lima Value Model — mirrors `js/src/value.ts`. Unlike JS's single `number`
//! type, Rust genuinely distinguishes `i64` from `f64`, so the int/float
//! tagging carried here is not extra ceremony — it's the representation a
//! Rust port needs from the moment a scalar is recognised.

/// UTC instant, stored as seconds since the Unix epoch. Core's valid calendar
/// range is years 0001-9999 (Appendix A) — comfortably inside `i64`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Instant {
    pub epoch_seconds: i64,
}

impl Instant {
    /// Renders as `YYYY-MM-DDTHH:MM:SSZ` — the exact form the conformance
    /// corpus fixtures use for `{ "$type": "instant", "value": "..." }`.
    pub fn to_iso_string(self) -> String {
        let days = self.epoch_seconds.div_euclid(86_400);
        let secs_of_day = self.epoch_seconds.rem_euclid(86_400);
        let (year, month, day) = civil_from_days(days);
        let hour = secs_of_day / 3600;
        let minute = (secs_of_day % 3600) / 60;
        let second = secs_of_day % 60;
        format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
    }
}

/// Deliberately no `serde::Serialize`/`Deserialize` (yet). Two separable
/// pieces of future work, neither started:
///
/// 1. Making `LimaValue` itself serializable (e.g. to JSON) — mechanically
///    straightforward, similar to `serde_json::Value`'s own impl.
/// 2. Deserializing straight into a caller-defined `#[derive(Deserialize)]`
///    struct (the ergonomic win `serde_yaml` offered) — needs a real
///    `serde::Deserializer` impl over a `LimaValue` wrapper; a known,
///    well-trodden pattern, but genuine work, not a one-liner.
///
/// Both are purely additive — safe to add later behind an opt-in `serde`
/// Cargo feature without breaking anything published now. Deferred for
/// 0.1.1 pending actual demand: the JS package has no equivalent (JS is
/// dynamically typed), so there is no parity pressure driving this.
#[derive(Debug, Clone, PartialEq)]
pub enum LimaValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    String(String),
    Instant(Instant),
    Array(Vec<LimaValue>),
    /// Insertion-ordered — Core has no concept of key sorting.
    Mapping(Vec<(String, LimaValue)>),
}

impl LimaValue {
    /// Core §9: `depth(scalar) = 0`, `depth(array | mapping) = 1 +
    /// max(depth(child))` (0 for an empty collection). Mirrors
    /// `depthOfNative`.
    pub fn depth(&self) -> u32 {
        match self {
            LimaValue::Array(items) => 1 + items.iter().map(LimaValue::depth).max().unwrap_or(0),
            LimaValue::Mapping(entries) => {
                1 + entries.iter().map(|(_, v)| v.depth()).max().unwrap_or(0)
            }
            _ => 0,
        }
    }
}

/// Inserts into an insertion-ordered `Vec<(String, V)>` mapping, updating in
/// place if the key already exists — matches JS `Map.set`'s "keep original
/// position, replace value" semantics rather than moving the key to the end.
/// Generic over `V` so both [`LimaValue`] and [`PositionedValue`] mappings
/// (identically shaped, different leaf type) share one implementation.
pub fn set_mapping<V>(entries: &mut Vec<(String, V)>, key: String, value: V) {
    if let Some(slot) = entries.iter_mut().find(|(k, _)| *k == key) {
        slot.1 = value;
    } else {
        entries.push((key, value));
    }
}

/// References §5/R-112: stamped on the root of a value copied in by a
/// successful pure-reference resolution, with the source token and line
/// that caused the insertion — never set by Core itself. Powers §5's
/// global-error attribution: when a final-result limit (nesting depth,
/// total node count) is violated, the lowest-line `inserted_at` among the
/// participating nodes identifies which reference token to blame.
#[derive(Debug, Clone, PartialEq)]
pub struct InsertedAt {
    pub line: u32,
    pub token: String,
}

/// The annotated tree Core produces internally and References resolves —
/// every node carries the source line it was parsed with (needed for
/// diagnostics: `UNRESOLVED_REFERENCE`, `INVALID_INTERPOLATION`, and
/// depth/node-count limit attribution all report a *specific* node's line,
/// not just "somewhere in the document"), strings additionally carry
/// whether they came from quoted syntax (quoted strings are never
/// reference sites — Core §2.3), and every node can carry `inserted_at`
/// once References has copied it in from elsewhere. Mirrors
/// `js/src/scalars.ts`'s `PositionedValue`. `parse_core`'s public
/// `LimaValue` is the position-stripped projection of this same tree
/// (`to_plain_value`) — not a separately parsed representation, so the two
/// can't drift apart the way two independently hand-written parsers could.
#[derive(Debug, Clone, PartialEq)]
pub enum PositionedValue {
    Null {
        line: u32,
        inserted_at: Option<InsertedAt>,
    },
    Bool {
        value: bool,
        line: u32,
        inserted_at: Option<InsertedAt>,
    },
    Int {
        value: i64,
        line: u32,
        inserted_at: Option<InsertedAt>,
    },
    Float {
        value: f64,
        line: u32,
        inserted_at: Option<InsertedAt>,
    },
    String {
        value: String,
        line: u32,
        quoted: bool,
        inserted_at: Option<InsertedAt>,
    },
    Instant {
        value: Instant,
        line: u32,
        inserted_at: Option<InsertedAt>,
    },
    Array {
        items: Vec<PositionedValue>,
        line: u32,
        inserted_at: Option<InsertedAt>,
    },
    /// Insertion-ordered — Core has no concept of key sorting.
    Mapping {
        entries: Vec<(String, PositionedValue)>,
        line: u32,
        inserted_at: Option<InsertedAt>,
    },
}

impl PositionedValue {
    pub fn line(&self) -> u32 {
        match self {
            PositionedValue::Null { line, .. }
            | PositionedValue::Bool { line, .. }
            | PositionedValue::Int { line, .. }
            | PositionedValue::Float { line, .. }
            | PositionedValue::String { line, .. }
            | PositionedValue::Instant { line, .. }
            | PositionedValue::Array { line, .. }
            | PositionedValue::Mapping { line, .. } => *line,
        }
    }

    pub fn inserted_at(&self) -> Option<&InsertedAt> {
        match self {
            PositionedValue::Null { inserted_at, .. }
            | PositionedValue::Bool { inserted_at, .. }
            | PositionedValue::Int { inserted_at, .. }
            | PositionedValue::Float { inserted_at, .. }
            | PositionedValue::String { inserted_at, .. }
            | PositionedValue::Instant { inserted_at, .. }
            | PositionedValue::Array { inserted_at, .. }
            | PositionedValue::Mapping { inserted_at, .. } => inserted_at.as_ref(),
        }
    }

    /// Strips position/quoted-origin annotations, recursively — the public
    /// `parse_core()` projection. Mirrors `toPlainValue`.
    pub fn to_plain_value(&self) -> LimaValue {
        match self {
            PositionedValue::Null { .. } => LimaValue::Null,
            PositionedValue::Bool { value, .. } => LimaValue::Bool(*value),
            PositionedValue::Int { value, .. } => LimaValue::Int(*value),
            PositionedValue::Float { value, .. } => LimaValue::Float(*value),
            PositionedValue::String { value, .. } => LimaValue::String(value.clone()),
            PositionedValue::Instant { value, .. } => LimaValue::Instant(*value),
            PositionedValue::Array { items, .. } => {
                LimaValue::Array(items.iter().map(PositionedValue::to_plain_value).collect())
            }
            PositionedValue::Mapping { entries, .. } => LimaValue::Mapping(
                entries
                    .iter()
                    .map(|(k, v)| (k.clone(), v.to_plain_value()))
                    .collect(),
            ),
        }
    }

    /// [`LimaValue::depth`]'s counterpart. Mirrors `depthOfPositioned`.
    pub fn depth(&self) -> u32 {
        match self {
            PositionedValue::Array { items, .. } => {
                1 + items.iter().map(PositionedValue::depth).max().unwrap_or(0)
            }
            PositionedValue::Mapping { entries, .. } => {
                1 + entries.iter().map(|(_, v)| v.depth()).max().unwrap_or(0)
            }
            _ => 0,
        }
    }
}

/// One parsing grammar (`scalars`/`flow`/`block`/`core`), two output
/// representations — mirrors `js/src/builder.ts`'s `ValueBuilder<V, M>`.
/// `Plain` fixes this to the public [`LimaValue`] (`parse_core`'s shape,
/// no line-tracking overhead when References isn't used); `Positioned`
/// fixes it to [`PositionedValue`] (what `references.rs` resolves against).
/// Every method is a plain function of its arguments (no builder state),
/// matching the TS object literals — implemented as associated functions
/// on a zero-sized marker type rather than trait methods needing `&self`.
pub trait Builder {
    type Value: Clone;
    type Mapping;

    fn v_null(line: u32) -> Self::Value;
    fn v_bool(value: bool, line: u32) -> Self::Value;
    fn v_int(value: i64, line: u32) -> Self::Value;
    fn v_float(value: f64, line: u32) -> Self::Value;
    fn v_string(value: String, line: u32, quoted: bool) -> Self::Value;
    fn v_instant(value: Instant, line: u32) -> Self::Value;
    fn v_array(items: Vec<Self::Value>, line: u32) -> Self::Value;
    fn v_mapping(entries: Self::Mapping, line: u32) -> Self::Value;

    fn m_create() -> Self::Mapping;
    fn m_create_with(key: String, value: Self::Value) -> Self::Mapping;
    fn m_has_key(entries: &Self::Mapping, key: &str) -> bool;
    fn m_set(entries: &mut Self::Mapping, key: String, value: Self::Value);

    /// Core §9: the root mapping's own max depth over its values (the root
    /// itself does not count as a depth level). Mirrors `mappingMaxDepth`.
    fn m_max_depth(entries: &Self::Mapping) -> u32;
}

/// Produces the plain [`LimaValue`] tree — `parse_core`'s public shape.
pub struct PlainBuilder;

impl Builder for PlainBuilder {
    type Value = LimaValue;
    type Mapping = Vec<(String, LimaValue)>;

    fn v_null(_line: u32) -> LimaValue {
        LimaValue::Null
    }
    fn v_bool(value: bool, _line: u32) -> LimaValue {
        LimaValue::Bool(value)
    }
    fn v_int(value: i64, _line: u32) -> LimaValue {
        LimaValue::Int(value)
    }
    fn v_float(value: f64, _line: u32) -> LimaValue {
        LimaValue::Float(value)
    }
    fn v_string(value: String, _line: u32, _quoted: bool) -> LimaValue {
        LimaValue::String(value)
    }
    fn v_instant(value: Instant, _line: u32) -> LimaValue {
        LimaValue::Instant(value)
    }
    fn v_array(items: Vec<LimaValue>, _line: u32) -> LimaValue {
        LimaValue::Array(items)
    }
    fn v_mapping(entries: Self::Mapping, _line: u32) -> LimaValue {
        LimaValue::Mapping(entries)
    }

    fn m_create() -> Self::Mapping {
        Vec::new()
    }
    fn m_create_with(key: String, value: LimaValue) -> Self::Mapping {
        vec![(key, value)]
    }
    fn m_has_key(entries: &Self::Mapping, key: &str) -> bool {
        entries.iter().any(|(k, _)| k == key)
    }
    fn m_set(entries: &mut Self::Mapping, key: String, value: LimaValue) {
        set_mapping(entries, key, value)
    }
    fn m_max_depth(entries: &Self::Mapping) -> u32 {
        entries.iter().map(|(_, v)| v.depth()).max().unwrap_or(0)
    }
}

/// Produces the annotated [`PositionedValue`] tree — what `references.rs`
/// resolves against. `inserted_at` always starts `None`; only References'
/// own reference-copying (never Core) ever sets it.
pub struct PositionedBuilder;

impl Builder for PositionedBuilder {
    type Value = PositionedValue;
    type Mapping = Vec<(String, PositionedValue)>;

    fn v_null(line: u32) -> PositionedValue {
        PositionedValue::Null {
            line,
            inserted_at: None,
        }
    }
    fn v_bool(value: bool, line: u32) -> PositionedValue {
        PositionedValue::Bool {
            value,
            line,
            inserted_at: None,
        }
    }
    fn v_int(value: i64, line: u32) -> PositionedValue {
        PositionedValue::Int {
            value,
            line,
            inserted_at: None,
        }
    }
    fn v_float(value: f64, line: u32) -> PositionedValue {
        PositionedValue::Float {
            value,
            line,
            inserted_at: None,
        }
    }
    fn v_string(value: String, line: u32, quoted: bool) -> PositionedValue {
        PositionedValue::String {
            value,
            line,
            quoted,
            inserted_at: None,
        }
    }
    fn v_instant(value: Instant, line: u32) -> PositionedValue {
        PositionedValue::Instant {
            value,
            line,
            inserted_at: None,
        }
    }
    fn v_array(items: Vec<PositionedValue>, line: u32) -> PositionedValue {
        PositionedValue::Array {
            items,
            line,
            inserted_at: None,
        }
    }
    fn v_mapping(entries: Self::Mapping, line: u32) -> PositionedValue {
        PositionedValue::Mapping {
            entries,
            line,
            inserted_at: None,
        }
    }

    fn m_create() -> Self::Mapping {
        Vec::new()
    }
    fn m_create_with(key: String, value: PositionedValue) -> Self::Mapping {
        vec![(key, value)]
    }
    fn m_has_key(entries: &Self::Mapping, key: &str) -> bool {
        entries.iter().any(|(k, _)| k == key)
    }
    fn m_set(entries: &mut Self::Mapping, key: String, value: PositionedValue) {
        set_mapping(entries, key, value)
    }
    fn m_max_depth(entries: &Self::Mapping) -> u32 {
        entries.iter().map(|(_, v)| v.depth()).max().unwrap_or(0)
    }
}

/// Days since the Unix epoch (1970-01-01) for a proleptic-Gregorian
/// (year, month, day) — Howard Hinnant's `days_from_civil`, the standard
/// dependency-free algorithm for this conversion (correct for all years,
/// including the divisible-by-400 leap rule).
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = (m as i64 + 9) % 12; // [0, 11], Mar=0 .. Feb=11
    let doy = (153 * mp + 2) / 5 + d as i64 - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

/// Inverse of [`days_from_civil`].
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn days_from_civil_roundtrips() {
        for &(y, m, d) in &[
            (1970, 1, 1),
            (2024, 2, 29),
            (2000, 2, 29),
            (1, 1, 1),
            (9999, 12, 31),
            (1969, 12, 31),
        ] {
            let days = days_from_civil(y, m, d);
            assert_eq!(
                civil_from_days(days),
                (y, m, d),
                "roundtrip failed for {y}-{m}-{d}"
            );
        }
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(
            days_from_civil(2024, 3, 1),
            days_from_civil(2024, 2, 29) + 1
        );
    }
}
