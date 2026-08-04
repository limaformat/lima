/**
 * Parameterizes the Core grammar (`scalars.ts`, `flow.ts`, `block.ts`) over
 * its output representation, so the same parsing control flow can produce
 * either the References-needed annotated `PositionedValue` tree or, for
 * `parseCore`, the public native result directly — without a second,
 * hand-copied parser that could drift from the first (see core.ts's
 * `nativeBuilder` and scalars.ts's `positionedBuilder`).
 */
export interface ValueBuilder<V> {
	null(line: number): V
	bool(value: boolean, line: number): V
	int(value: number, line: number): V
	float(value: number, line: number): V
	string(value: string, line: number, quoted: boolean): V
	instant(value: Date, line: number): V
	array(items: V[], line: number): V
	mapping(entries: Map<string, V>, line: number): V
}
