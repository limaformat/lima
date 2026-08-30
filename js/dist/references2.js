/** Lima References 2.0 resolver. References 1.0 remains isolated in references.ts. */
import { canonicalString, codepointLength, countNodes, ingestPartialValue, PARTIAL_COUNT_LIMIT, PARTIAL_NAME_LENGTH_LIMIT, PARTIAL_NODE_LIMIT, RESULT_NODE_LIMIT, SCALAR_LENGTH_LIMIT, } from './value.js';
import { NESTING_DEPTH_LIMIT, parseCore, parseCoreWithPositions, toPlainValue, } from './core.js';
import { hasActiveReferences2 } from './scalars.js';
import { LimaError } from './errors.js';
import { collectAllParticipants, deepCopyPositioned, earliestParticipant, emptyMapping, finalizePositioned, partialToPositioned, } from './positioned-tree.js';
const PARTIAL_NAME = '[a-zA-Z0-9_][a-zA-Z0-9_:/-]*';
const PARTIAL_NAME_RE = new RegExp(`^${PARTIAL_NAME}$`);
const MAX_EDGES = 3;
/** Copies a pure-reference target and stamps the new insertion without
 * discarding provenance already attached to the copied root (R-112). */
const copyWithInsertion = (target, insertedAt) => {
    const copy = deepCopyPositioned(target);
    const priorInsertions = copy.insertedAt === undefined
        ? copy.priorInsertions
        : [...(copy.priorInsertions ?? []), copy.insertedAt];
    return { ...copy, insertedAt, priorInsertions };
};
const addDiagnostic = (ctx, diagnostic, offset = 0) => {
    ctx.diagnostics.push({ ...diagnostic, offset });
};
const tokenMatches = (node) => node.references2 ?? [];
const lookupPath = (root, segments) => {
    let current = root;
    for (const segment of segments) {
        if (current?.kind !== 'mapping')
            return undefined;
        current = current.entries.get(segment);
    }
    return current;
};
const documentTarget = (root, path) => {
    const segments = path.split('.');
    let value = root.get(segments[0]);
    if (value === undefined)
        return undefined;
    let index = 1;
    while (index < segments.length && value.kind === 'mapping') {
        const child = value.entries.get(segments[index]);
        if (child === undefined)
            return undefined;
        value = child;
        index++;
    }
    return { root: value, tail: segments.slice(index) };
};
const lookupPartial = (partials, path) => {
    const dot = path.indexOf('.');
    if (dot < 0)
        return partials.get(path);
    return lookupPath(partials.get(path.slice(0, dot)), path.slice(dot + 1).split('.'));
};
const isActiveString = (node) => node.kind === 'string' && !node.quoted;
const scalarText = (value, token, line, offset, ctx) => {
    if (value.kind === 'mapping') {
        addDiagnostic(ctx, {
            code: 'INVALID_INTERPOLATION', line, token,
            message: `Lima: invalid interpolation of "${token}" at line ${line}: mapping cannot be interpolated into a string`,
        }, offset);
        return null;
    }
    if (value.kind === 'array') {
        if (value.items.some((item) => item.kind === 'array' || item.kind === 'mapping')) {
            addDiagnostic(ctx, {
                code: 'INVALID_INTERPOLATION', line, token,
                message: `Lima: invalid interpolation of "${token}" at line ${line}: array contains a nested array or mapping`,
            }, offset);
            return null;
        }
        return value.items.map((item) => canonicalString(toPlainValue(item))).join(', ');
    }
    return canonicalString(toPlainValue(value));
};
const resolveNodeUncached = (node, document, partials, ctx, remainingEdges, stack) => {
    if (node.kind === 'array') {
        if (!hasActiveReferences2(node))
            return { value: node, complete: true };
        let complete = true;
        const items = node.items.map((item) => {
            const result = resolveNode(item, document, partials, ctx, remainingEdges, stack);
            complete &&= result.complete;
            if (isActiveString(item) && result.value.kind === 'array') {
                const match = tokenMatches(item)[0];
                const token = match?.token ?? item.value;
                addDiagnostic(ctx, {
                    code: 'INVALID_REFERENCE_SHAPE', line: match?.line ?? item.line, token,
                    message: `Lima: reference "${token}" resolves to an array, which cannot be inserted as a sequence item at line ${match?.line ?? item.line}`,
                }, match?.offset ?? 0);
                return item;
            }
            return result.value;
        });
        return {
            value: { ...node, items, references2Active: items.some(hasActiveReferences2) || undefined },
            complete,
        };
    }
    if (node.kind === 'mapping') {
        if (!hasActiveReferences2(node))
            return { value: node, complete: true };
        let complete = true;
        const entries = new Map();
        for (const [key, child] of node.entries) {
            const result = resolveNode(child, document, partials, ctx, remainingEdges, stack);
            complete &&= result.complete;
            entries.set(key, result.value);
        }
        let references2Active = false;
        for (const value of entries.values()) {
            if (hasActiveReferences2(value)) {
                references2Active = true;
                break;
            }
        }
        return { value: { ...node, entries, references2Active: references2Active || undefined }, complete };
    }
    if (!isActiveString(node))
        return { value: node, complete: true };
    const recorded = tokenMatches(node);
    const pure = recorded.length === 1 && recorded[0].index === 0 && recorded[0].token.length === node.value.length
        ? recorded[0]
        : undefined;
    if (pure) {
        if (remainingEdges === 0)
            return { value: node, complete: false };
        const documentLookup = pure.documentPath !== undefined ? documentTarget(document, pure.documentPath) : undefined;
        const target = pure.documentPath !== undefined ? documentLookup?.root : lookupPartial(partials, pure.partialPath);
        if (target === undefined || stack.has(target))
            return { value: node, complete: false };
        if (pure.partialPath !== undefined) {
            // `partialToPositioned` never annotates partial targets: partials are
            // inert and have no source token before this document insertion.
            return {
                value: copyWithInsertion(target, { line: pure.line, offset: pure.offset, token: pure.token }),
                complete: true,
            };
        }
        stack.add(target);
        const result = resolveNode(target, document, partials, ctx, remainingEdges - 1, stack);
        stack.delete(target);
        if (!result.complete)
            return { value: node, complete: false };
        const selected = lookupPath(result.value, documentLookup?.tail ?? []);
        if (selected === undefined)
            return { value: node, complete: false };
        return {
            // `selected` may itself be the root inserted by an earlier reference;
            // both it and this outer copy participate in final-structure errors.
            value: copyWithInsertion(selected, { line: pure.line, offset: pure.offset, token: pure.token }),
            complete: true,
        };
    }
    const matches = recorded;
    if (matches.length === 0)
        return { value: node, complete: true };
    let complete = true;
    let cursor = 0;
    let output = '';
    const unresolvedTokens = [];
    for (const match of matches) {
        const offset = match.index;
        output += node.value.slice(cursor, offset);
        const documentLookup = match.documentPath !== undefined ? documentTarget(document, match.documentPath) : undefined;
        const target = match.documentPath !== undefined ? documentLookup?.root : lookupPartial(partials, match.partialPath);
        let replacement = null;
        if (remainingEdges > 0 && target !== undefined && !stack.has(target)) {
            if (match.partialPath !== undefined)
                replacement = scalarText(target, match.token, match.line, match.offset, ctx);
            else {
                stack.add(target);
                const result = resolveNode(target, document, partials, ctx, remainingEdges - 1, stack);
                stack.delete(target);
                const selected = result.complete ? lookupPath(result.value, documentLookup?.tail ?? []) : undefined;
                if (selected !== undefined)
                    replacement = scalarText(selected, match.token, match.line, match.offset, ctx);
            }
        }
        if (replacement === null) {
            complete = false;
            unresolvedTokens.push({ ...match, index: output.length });
            output += match.token;
        }
        else
            output += replacement;
        cursor = offset + match.token.length;
    }
    output += node.value.slice(cursor);
    if (codepointLength(output) > SCALAR_LENGTH_LIMIT) {
        const first = matches[0];
        addDiagnostic(ctx, {
            code: 'RESOURCE_LIMIT', line: first.line, token: first.token,
            message: `Lima: scalar exceeds maximum length of ${SCALAR_LENGTH_LIMIT} code points at line ${first.line}`,
        }, first.offset);
    }
    return { value: { ...node, value: output, references2: unresolvedTokens }, complete };
};
/** Successful and failed dependency results are immutable and budget-specific. */
const resolveNode = (node, document, partials, ctx, remainingEdges, stack) => {
    const cacheable = stack.size > 1 && (node.kind === 'array' || node.kind === 'mapping' ||
        (isActiveString(node) && tokenMatches(node).length > 0));
    if (!cacheable)
        return resolveNodeUncached(node, document, partials, ctx, remainingEdges, stack);
    const byBudget = ctx.cache.get(node);
    const cached = byBudget?.get(remainingEdges);
    if (cached !== undefined)
        return cached;
    const result = resolveNodeUncached(node, document, partials, ctx, remainingEdges, stack);
    if (byBudget !== undefined)
        byBudget.set(remainingEdges, result);
    else
        ctx.cache.set(node, new Map([[remainingEdges, result]]));
    return result;
};
const validatePartials = (raw) => {
    const names = Object.keys(raw);
    if (names.length > PARTIAL_COUNT_LIMIT) {
        throw new LimaError({ code: 'INVALID_PARTIAL', message: `Lima: too many partials (max ${PARTIAL_COUNT_LIMIT})` });
    }
    for (const name of names) {
        if (!PARTIAL_NAME_RE.test(name)) {
            throw new LimaError({ code: 'INVALID_PARTIAL', partial: name, message: `Lima: invalid partial name "${name}"` });
        }
        if (codepointLength(name) > PARTIAL_NAME_LENGTH_LIMIT) {
            throw new LimaError({ code: 'INVALID_PARTIAL', partial: name, message: `Lima: invalid partial name "${name}": exceeds maximum length of ${PARTIAL_NAME_LENGTH_LIMIT} code points` });
        }
    }
    const ingested = new Map();
    for (const name of names)
        ingested.set(name, ingestPartialValue(raw[name], name, name));
    let nodes = 0;
    for (const value of ingested.values())
        nodes += countNodes(value);
    if (nodes > PARTIAL_NODE_LIMIT) {
        throw new LimaError({ code: 'INVALID_PARTIAL', message: `Lima: partials exceed the combined maximum of ${PARTIAL_NODE_LIMIT} value nodes` });
    }
    const result = new Map();
    for (const [name, value] of ingested)
        result.set(name, partialToPositioned(value, 0));
    return result;
};
const scanUnresolved = (node, ctx) => {
    if (isActiveString(node)) {
        for (const match of tokenMatches(node)) {
            addDiagnostic(ctx, {
                code: 'UNRESOLVED_REFERENCE', line: match.line, token: match.token,
                message: `Lima: unresolved reference "${match.token}" at line ${match.line}`,
            }, match.offset);
        }
        return;
    }
    if (node.kind === 'array')
        for (const item of node.items)
            scanUnresolved(item, ctx);
    if (node.kind === 'mapping')
        for (const child of node.entries.values())
            scanUnresolved(child, ctx);
};
export const parse = (frontMatter, options) => {
    if (options?.mode !== undefined && options.mode !== 'core' && options.mode !== 'references') {
        throw new TypeError(`Lima: invalid parse mode "${String(options.mode)}"`);
    }
    if (options?.mode === 'core') {
        if (Object.prototype.hasOwnProperty.call(options, 'partials')) {
            throw new TypeError('Lima: partials cannot be supplied in core mode');
        }
        // Core ignores the additional `mode` property. Passing the same object
        // avoids allocating a projected options object on this hot dispatch path.
        return parseCore(frontMatter, options);
    }
    const partials = validatePartials(options?.partials ?? {});
    if (!frontMatter.includes('${') && !frontMatter.includes('$(')) {
        return parseCore(frontMatter, options);
    }
    const document = parseCoreWithPositions(frontMatter, { strict: options?.strict ?? false, onWarning: options?.onWarning });
    const ctx = { diagnostics: [], cache: new WeakMap() };
    const resolved = new Map();
    for (const [key, value] of document) {
        const stack = new Set([value]);
        resolved.set(key, resolveNode(value, document, partials, ctx, MAX_EDGES, stack).value);
    }
    if (options?.strict)
        for (const value of resolved.values())
            scanUnresolved(value, ctx);
    if (ctx.diagnostics.length > 0) {
        ctx.diagnostics.sort((a, b) => a.line - b.line || a.offset - b.offset);
        const winner = ctx.diagnostics[0];
        // §2.4: expose the token's physical position (1-based) — Rust and Go
        // already do; `offset` was internal-only here.
        throw new LimaError({ ...winner, column: winner.offset + 1 });
    }
    const finalized = [...resolved].map(([key, value]) => [key, finalizePositioned(value)]);
    const depth = finalized.length === 0 ? 0 : Math.max(...finalized.map(([, value]) => value.depth));
    if (depth > NESTING_DEPTH_LIMIT) {
        const participants = finalized.filter(([, value]) => value.depth === depth).flatMap(([, value]) => value.deepestParticipants);
        const winner = earliestParticipant(participants);
        throw new LimaError({
            code: 'RESOURCE_LIMIT', line: winner?.line ?? 1, token: winner?.token,
            ...(winner?.offset !== undefined ? { column: winner.offset + 1 } : {}),
            message: `Lima: nesting depth exceeds maximum of ${NESTING_DEPTH_LIMIT} at line ${winner?.line ?? 1}`,
        });
    }
    let nodeCount = 1;
    for (const [, value] of finalized)
        nodeCount += value.nodeCount;
    if (nodeCount > RESULT_NODE_LIMIT) {
        const participants = [];
        for (const value of resolved.values())
            collectAllParticipants(value, participants);
        const winner = earliestParticipant(participants);
        throw new LimaError({
            code: 'RESOURCE_LIMIT', line: winner?.line ?? 1, token: winner?.token,
            ...(winner?.offset !== undefined ? { column: winner.offset + 1 } : {}),
            message: `Lima: result exceeds maximum size of ${RESULT_NODE_LIMIT} total nodes at line ${winner?.line ?? 1}`,
        });
    }
    const out = emptyMapping();
    for (const [key, value] of finalized)
        out[key] = value.native;
    return out;
};
/** @deprecated Use parse(). */
export const parseReferences = parse;
