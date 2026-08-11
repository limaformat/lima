/**
 * Lima Parser — LIMA Is Metadata Annotation
 *
 * Public entry point. The implementation is split per Appendix B's own
 * layering:
 *   - `core.ts`       — Lima Core 1.0, reference-unaware by construction.
 *   - `references2.ts` — the References 2.0 extension layered on Core.
 *   - `references.ts`  — the frozen internal References 1.0 implementation.
 *   - `value.ts`       — the shared Lima Value Model both build on.
 *
 * `parse` is the primary References 2.0 entry point. `parseReferences` is
 * retained as its deprecated compatibility alias.
 */
export { parseCore } from './core.js';
export { parseReferences, parse } from './references2.js';
