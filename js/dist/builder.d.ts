/**
 * Parameterizes the Core grammar (`scalars.ts`, `flow.ts`, `block.ts`) over
 * its output representation, so the same parsing control flow can produce
 * either the References-needed annotated `PositionedValue` tree or, for
 * `parseCore`, the public native result directly — without a second,
 * hand-copied parser that could drift from the first (see core.ts's
 * `nativeBuilder` and scalars.ts's `positionedBuilder`).
 *
 * `M` is the builder's own in-progress mapping accumulator type — a bare
 * `Map<string, V>` for `positionedBuilder` (later wrapped into a
 * `PositionedValue` mapping node by `mapping()`), a prototype-free
 * `Record<string, V>` for `nativeBuilder` (where the accumulator already
 * *is* the finished public shape, so `mapping()` is a no-op pass-through —
 * this is what lets `parseCore` skip building and copying an intermediate
 * `Map` for every mapping, including the top-level document root).
 *
 * Claude Code review note: an earlier version of this interface typed the
 * accumulator as `unknown`, requiring every concrete builder to `as`-cast
 * it back to its real type at every one of `createMapping`/`hasMappingKey`/
 * `setMapping`/`mappingValues`/`mapping` — full call-site type-checking on
 * `block.ts`/`flow.ts`/`scalars.ts` (they only ever go through these
 * methods, never touch `M` directly) with none of the safety lost in
 * exchange, purely by making `M` a second generic parameter instead. This
 * is compile-time-only: generics are erased, so the emitted JS — and
 * therefore performance — is identical either way, verified by benchmark.
 */
export interface ValueBuilder<V, M = Map<string, V>> {
    null(line: number): V;
    bool(value: boolean, line: number): V;
    int(value: number, line: number): V;
    float(value: number, line: number): V;
    string(value: string, line: number, quoted: boolean): V;
    instant(value: Date, line: number): V;
    array(items: V[], line: number): V;
    createMapping(): M;
    hasMappingKey(entries: M, key: string): boolean;
    setMapping(entries: M, key: string, value: V): void;
    mappingValues(entries: M): Iterable<V>;
    mapping(entries: M, line: number): V;
}
