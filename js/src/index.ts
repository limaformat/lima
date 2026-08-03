/**
 * LIMA Parser — LIMA Is Metadata Annotation
 *
 * Public entry point. The implementation is split per Appendix B's own
 * layering:
 *   - `core.ts`       — LIMA Core 1.0, reference-unaware by construction.
 *   - `references.ts` — the optional References 1.0 extension, layered on
 *                        top of Core's internal annotated value tree.
 *   - `value.ts`       — the shared Lima Value Model both build on.
 *
 * `parse` (the historical default export) resolves references — it is
 * `parseReferences` under a name kept for backward compatibility.
 */

export { parseCore, type CoreOptions } from './core'
export { parseReferences, parse, type ReferencesOptions, type ParseOptions } from './references'
