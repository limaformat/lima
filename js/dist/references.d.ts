/**
 * Lima References 1.0 — layered strictly on top of `core.ts` (Appendix B:
 * reference resolution is exclusively this extension's concern; Core never
 * sees it). Reads the annotated `PositionedValue` tree Core produces and
 * performs the two-phase resolution the spec describes (§4), keeping every
 * intermediate result in the SAME annotated representation instead of a
 * separate raw-value tree with a bolted-on marker for "inert":
 *
 *   - A string's `quoted` flag (set once, by Core, from actual quote syntax)
 *     is the single source of truth for "never treat this as a reference
 *     site" — §2.3 (quoted tokens) and §3.8 (partial content) are the same
 *     rule applied to two different origins, so partial values are wrapped
 *     into this same representation with every string leaf pre-marked
 *     `quoted: true` before insertion (`partialToPositioned`), rather than
 *     needing a second, unrelated mechanism.
 *   - Every node keeps the source `line` it was parsed with, even after
 *     being deep-copied into a new position — diagnostics read it directly
 *     off the node instead of falling back to a coarser key-level lookup.
 *
 * There is no module-level mutable state: diagnostics are collected in a
 * `ResolutionContext` created fresh per call and threaded explicitly.
 */
import { type Diagnostic } from './core.js';
type Meta = Record<string, unknown>;
export type ReferencesOptions = {
    /** Named values available via `(%key)` references. */
    partials?: Meta;
    strict?: boolean;
    /** Core §11.2 (inherited): callback for non-strict warnings (e.g. duplicate keys). Discarded if omitted. */
    onWarning?: (diagnostic: Diagnostic) => void;
};
export declare const parseReferences: <T extends Record<string, unknown> = Meta>(frontMatter: string, options?: ReferencesOptions) => T;
/** Backward-compatible primary entry point — References layered on Core. */
export declare const parse: typeof parseReferences;
export type ParseOptions = ReferencesOptions;
export {};
