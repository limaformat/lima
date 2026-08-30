package lima

import (
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"
)

const maxReferenceEdges = 3

// ParseMode selects the reference-aware or Core-only parser path.
type ParseMode string

const (
	ModeReferences ParseMode = "references"
	ModeCore       ParseMode = "core"
)

// Diagnostic is a non-fatal parser warning.
type Diagnostic struct {
	Message string
	Line    int
}

// ParseOptions configures Parse and ParseReferences.
type ParseOptions struct {
	Mode      ParseMode
	Partials  map[string]Value
	Strict    bool
	OnWarning func(Diagnostic)
}

// ReferencesOptions is retained for source compatibility.
type ReferencesOptions = ParseOptions

func referenceInitial(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_'
}
func referenceChar(c byte) bool { return referenceInitial(c) || c == ':' || c == '-' }
func partialChar(c byte) bool   { return referenceChar(c) || c == '/' }
func scanComponent2(s string, i int, partial bool) (int, bool) {
	if i >= len(s) || !referenceInitial(s[i]) {
		return i, false
	}
	i++
	for i < len(s) && ((partial && partialChar(s[i])) || (!partial && referenceChar(s[i]))) {
		i++
	}
	return i, true
}
func scanPath2(s string, i int, partial bool) (int, bool) {
	var ok bool
	i, ok = scanComponent2(s, i, partial)
	if !ok {
		return i, false
	}
	for i < len(s) && s[i] == '.' {
		var next int
		next, ok = scanComponent2(s, i+1, false)
		if !ok {
			return i, false
		}
		i = next
	}
	return i, true
}

// referenceSource is where a scalar begins in the source: physical 1-based
// line and 0-based codepoint column of its first character. A token's
// position is this anchor plus its codepoint offset within the value
// (References 2.0 §2.4). raw is set only for a block scalar (the original
// body lines joined with "\n"), so a token's line is read from there and
// not from the ^^-merged string; "" means "use value". Mirrors
// js/src/reference-tokens2.ts.
type referenceSource struct {
	raw       string
	line, col int
	// tabAdjust[i] = columns Core §3 added to physical line line+i by
	// leading-tab expansion; subtracted so the reported column is the
	// original-source column (§2.4).
	tabAdjust []int
}

type rawMatch struct {
	start   int
	text    string
	path    string
	partial bool
}

func scanMatches2(s string) []rawMatch {
	var out []rawMatch
	for i := 0; i < len(s); {
		partial, close, body := false, byte('}'), i+2
		if strings.HasPrefix(s[i:], "$(") {
			partial, close = true, ')'
		} else if !strings.HasPrefix(s[i:], "${") {
			_, size := utf8.DecodeRuneInString(s[i:])
			i += size
			continue
		}
		end, ok := scanPath2(s, body, partial)
		if !ok || end >= len(s) || s[end] != close {
			i++
			continue
		}
		out = append(out, rawMatch{start: i, text: s[i : end+1], path: s[body:end], partial: partial})
		i = end + 1
	}
	return out
}

func scanReferenceTokens2(value string, firstLine int, source *referenceSource) []referenceToken2 {
	if !strings.Contains(value, "${") && !strings.Contains(value, "$(") {
		return nil
	}
	decoded := scanMatches2(value)
	if len(decoded) == 0 {
		return nil
	}
	raw, line, col := value, firstLine, 0
	var tabAdjust []int
	if source != nil {
		line, col, tabAdjust = source.line, source.col, source.tabAdjust
		if source.raw != "" {
			raw = source.raw
		}
	}
	physical := scanMatches2(raw)
	// Internal invariant — the raw and decoded scans see the same tokens in
	// the same order (\# collapse and ^^ merge never add or remove a
	// ${…} / $(…)). A hard check: a mismatch would silently misreport.
	if len(physical) != len(decoded) {
		panic("Lima internal: raw and decoded reference-token scans disagree")
	}
	out := make([]referenceToken2, len(decoded))
	scanned := 0
	lineIndex := 0
	for k, m := range physical {
		for _, r := range raw[scanned:m.start] {
			if r == '\n' {
				line++
				col = 0
				lineIndex++
			} else {
				col++
			}
		}
		scanned = m.start
		adj := 0
		if lineIndex < len(tabAdjust) {
			adj = tabAdjust[lineIndex]
		}
		off := col - adj
		if off < 0 {
			off = 0
		}
		d := decoded[k]
		t := referenceToken2{token: d.text, index: d.start, line: line, offset: off}
		if d.partial {
			t.partialPath = d.path
		} else {
			t.documentPath = d.path
		}
		out[k] = t
	}
	return out
}

type sourceDiagnostic struct {
	line, offset int
	err          *LimaError
}
type resolution2 struct {
	value    *pvalue
	complete bool
}
type resolveContext2 struct {
	diagnostics []sourceDiagnostic
	cache       map[*pvalue]map[int]resolution2
	document    map[string]*pvalue
}

func referenceTokensOf2(v *pvalue) []referenceToken2 {
	if v == nil || v.references2 == nil {
		return nil
	}
	return *v.references2
}
func setReferenceTokens2(v *pvalue, tokens []referenceToken2) {
	if len(tokens) == 0 {
		v.references2 = nil
		return
	}
	copy := referenceTokens2(tokens)
	v.references2 = &copy
}

func addRefDiagnostic(ctx *resolveContext2, token referenceToken2, code LimaDiagnosticCode, detail string) {
	message := detail
	switch code {
	case UnresolvedReference:
		message = fmt.Sprintf("Lima: unresolved reference %q at line %d", token.token, token.line)
	case InvalidInterpolation:
		message = fmt.Sprintf("Lima: invalid interpolation of %q at line %d: %s", token.token, token.line, detail)
	case InvalidReferenceShape:
		message = fmt.Sprintf("Lima: reference %q has invalid shape at line %d: %s", token.token, token.line, detail)
	case ResourceLimit:
		message = fmt.Sprintf("Lima: %s at line %d", detail, token.line)
	}
	err := &LimaError{Code: code, Message: message, Line: token.line, Column: token.offset + 1, Token: token.token}
	ctx.diagnostics = append(ctx.diagnostics, sourceDiagnostic{token.line, token.offset, err})
}

func clonePositioned2(v *pvalue) *pvalue {
	if v == nil {
		return nil
	}
	out := &pvalue{value: v.value, line: v.line, quoted: v.quoted, inserted: v.inserted,
		priorInsertions: append([]insertedAt(nil), v.priorInsertions...)}
	setReferenceTokens2(out, append([]referenceToken2(nil), referenceTokensOf2(v)...))
	if v.array != nil {
		out.array = make([]*pvalue, len(v.array))
		for i, item := range v.array {
			out.array[i] = clonePositioned2(item)
		}
	}
	if v.mapping != nil {
		out.mapping = make([]pentry, len(v.mapping))
		for i, entry := range v.mapping {
			out.mapping[i] = pentry{entry.key, clonePositioned2(entry.value)}
		}
	}
	return out
}

func copyWithInsertion2(target *pvalue, token referenceToken2) *pvalue {
	copy := clonePositioned2(target)
	if copy.inserted != nil {
		copy.priorInsertions = append(copy.priorInsertions, *copy.inserted)
	}
	copy.inserted = &insertedAt{line: token.line, offset: token.offset, token: token.token}
	return copy
}

func mappingChild2(v *pvalue, key string) *pvalue {
	if v == nil || v.mapping == nil {
		return nil
	}
	for _, entry := range v.mapping {
		if entry.key == key {
			return entry.value
		}
	}
	return nil
}
func lookupPath2(v *pvalue, parts []string) *pvalue {
	for _, part := range parts {
		v = mappingChild2(v, part)
		if v == nil {
			return nil
		}
	}
	return v
}
func documentTarget2(document map[string]*pvalue, path string) (*pvalue, []string) {
	parts := strings.Split(path, ".")
	current := document[parts[0]]
	if current == nil {
		return nil, nil
	}
	i := 1
	for i < len(parts) && current.mapping != nil {
		next := mappingChild2(current, parts[i])
		if next == nil {
			return nil, nil
		}
		current = next
		i++
	}
	return current, parts[i:]
}
func partialTarget2(partials []pentry, path string) *pvalue {
	name, tail, found := strings.Cut(path, ".")
	var root *pvalue
	for _, entry := range partials {
		if entry.key == name {
			root = entry.value
			break
		}
	}
	if !found {
		return root
	}
	return lookupPath2(root, strings.Split(tail, "."))
}

func scalarText2(v *pvalue, token referenceToken2, ctx *resolveContext2) (string, bool) {
	if v.mapping != nil {
		addRefDiagnostic(ctx, token, InvalidInterpolation, "mapping cannot be interpolated into a string")
		return "", false
	}
	if v.array != nil {
		parts := make([]string, len(v.array))
		for i, item := range v.array {
			if item.array != nil || item.mapping != nil {
				addRefDiagnostic(ctx, token, InvalidInterpolation, "array contains a nested array or mapping")
				return "", false
			}
			parts[i] = canonical(item.plain())
		}
		return strings.Join(parts, ", "), true
	}
	return canonical(v.plain()), true
}

func tokenTarget2(token referenceToken2, partials []pentry, ctx *resolveContext2) (*pvalue, []string) {
	if token.documentPath != "" {
		return documentTarget2(ctx.document, token.documentPath)
	}
	return partialTarget2(partials, token.partialPath), nil
}

func resolveNode2(node *pvalue, document, partials []pentry, remaining int, stack map[*pvalue]bool, ctx *resolveContext2) resolution2 {
	cacheable := len(stack) > 1 && (node.array != nil || node.mapping != nil || len(referenceTokensOf2(node)) > 0)
	if cacheable {
		if byBudget := ctx.cache[node]; byBudget != nil {
			if cached, ok := byBudget[remaining]; ok {
				return cached
			}
		}
	}
	result := resolveNodeUncached2(node, document, partials, remaining, stack, ctx)
	if cacheable {
		if ctx.cache[node] == nil {
			ctx.cache[node] = map[int]resolution2{}
		}
		ctx.cache[node][remaining] = result
	}
	return result
}

func resolveNodeUncached2(node *pvalue, document, partials []pentry, remaining int, stack map[*pvalue]bool, ctx *resolveContext2) resolution2 {
	if node.array != nil {
		out := &pvalue{line: node.line, inserted: node.inserted,
			priorInsertions: append([]insertedAt(nil), node.priorInsertions...), array: make([]*pvalue, len(node.array))}
		complete := true
		for i, item := range node.array {
			r := resolveNode2(item, document, partials, remaining, stack, ctx)
			complete = complete && r.complete
			itemTokens := referenceTokensOf2(item)
			if len(itemTokens) > 0 && r.value.array != nil {
				addRefDiagnostic(ctx, itemTokens[0], InvalidReferenceShape, "array cannot be inserted as a sequence item")
				out.array[i] = clonePositioned2(item)
			} else {
				out.array[i] = r.value
			}
		}
		return resolution2{out, complete}
	}
	if node.mapping != nil {
		out := &pvalue{line: node.line, inserted: node.inserted,
			priorInsertions: append([]insertedAt(nil), node.priorInsertions...), mapping: make([]pentry, len(node.mapping))}
		complete := true
		for i, entry := range node.mapping {
			r := resolveNode2(entry.value, document, partials, remaining, stack, ctx)
			complete = complete && r.complete
			out.mapping[i] = pentry{entry.key, r.value}
		}
		return resolution2{out, complete}
	}
	if node.quoted || len(referenceTokensOf2(node)) == 0 {
		return resolution2{node, true}
	}
	text := string(node.value.(String))
	tokens := referenceTokensOf2(node)
	pure := len(tokens) == 1 && tokens[0].index == 0 && len(tokens[0].token) == len(text)
	if pure {
		token := tokens[0]
		if remaining == 0 {
			return resolution2{clonePositioned2(node), false}
		}
		target, tail := tokenTarget2(token, partials, ctx)
		if target == nil || stack[target] {
			return resolution2{clonePositioned2(node), false}
		}
		if token.partialPath != "" {
			return resolution2{copyWithInsertion2(target, token), true}
		}
		stack[target] = true
		r := resolveNode2(target, document, partials, remaining-1, stack, ctx)
		delete(stack, target)
		if !r.complete {
			return resolution2{clonePositioned2(node), false}
		}
		selected := lookupPath2(r.value, tail)
		if selected == nil {
			return resolution2{clonePositioned2(node), false}
		}
		return resolution2{copyWithInsertion2(selected, token), true}
	}
	var out strings.Builder
	cursor, complete := 0, true
	var unresolved []referenceToken2
	for _, token := range tokens {
		originalEnd := token.index + len(token.token)
		out.WriteString(text[cursor:token.index])
		target, tail := tokenTarget2(token, partials, ctx)
		replacement, ok := "", false
		if remaining > 0 && target != nil && !stack[target] {
			if token.partialPath != "" {
				replacement, ok = scalarText2(target, token, ctx)
			} else {
				stack[target] = true
				r := resolveNode2(target, document, partials, remaining-1, stack, ctx)
				delete(stack, target)
				if r.complete {
					if selected := lookupPath2(r.value, tail); selected != nil {
						replacement, ok = scalarText2(selected, token, ctx)
					}
				}
			}
		}
		if ok {
			out.WriteString(replacement)
		} else {
			complete = false
			token.index = out.Len()
			unresolved = append(unresolved, token)
			out.WriteString(token.token)
		}
		cursor = originalEnd
	}
	out.WriteString(text[cursor:])
	value := out.String()
	if utf8.RuneCountInString(value) > scalarLengthLimit {
		addRefDiagnostic(ctx, tokens[0], ResourceLimit, fmt.Sprintf("scalar exceeds maximum length of %d code points", scalarLengthLimit))
	}
	result := &pvalue{value: String(value), line: node.line, inserted: node.inserted,
		priorInsertions: append([]insertedAt(nil), node.priorInsertions...)}
	setReferenceTokens2(result, unresolved)
	return resolution2{result, complete}
}

func validPartialName2(name string) bool {
	if name == "" || !referenceInitial(name[0]) {
		return false
	}
	for i := 1; i < len(name); i++ {
		if !partialChar(name[i]) {
			return false
		}
	}
	return true
}

func validatePartials2(raw map[string]Value) ([]pentry, error) {
	if len(raw) > partialCountLimit {
		return nil, &LimaError{Code: InvalidPartial, Message: "Lima: too many partials (max 128)"}
	}
	names := make([]string, 0, len(raw))
	for name := range raw {
		names = append(names, name)
	}
	sort.Strings(names)
	partials, nodes := make([]pentry, 0, len(names)), 0
	for _, name := range names {
		if !validPartialName2(name) {
			return nil, &LimaError{Code: InvalidPartial, Partial: name, Message: fmt.Sprintf("Lima: invalid partial name %q", name)}
		}
		if utf8.RuneCountInString(name) > 128 {
			return nil, &LimaError{Code: InvalidPartial, Partial: name, Message: fmt.Sprintf("Lima: invalid partial name %q: exceeds maximum length of 128 code points", name)}
		}
		n, err := validatePartial(raw[name], name, name, 0)
		if err != nil {
			return nil, err
		}
		nodes += n
		partials = append(partials, pentry{name, fromValue(raw[name], 0)})
	}
	if nodes > partialNodeLimit {
		return nil, &LimaError{Code: InvalidPartial, Message: fmt.Sprintf("Lima: partials exceed the combined maximum of %d value nodes", partialNodeLimit)}
	}
	return partials, nil
}

type finalized2 struct {
	native       Value
	nodes, depth int
	participants []insertedAt
}

func finalize2(v *pvalue) finalized2 {
	participants := append([]insertedAt(nil), v.priorInsertions...)
	if v.inserted != nil {
		participants = append(participants, *v.inserted)
	}
	if v.array != nil {
		out, nodes, depth := make(Array, len(v.array)), 1, 0
		var deepest []insertedAt
		for i, item := range v.array {
			r := finalize2(item)
			out[i], nodes = r.native, nodes+r.nodes
			if r.depth > depth {
				depth, deepest = r.depth, r.participants
			} else if r.depth == depth {
				deepest = append(deepest, r.participants...)
			}
		}
		return finalized2{out, nodes, depth + 1, append(participants, deepest...)}
	}
	if v.mapping != nil {
		out, nodes, depth := make(Map, len(v.mapping)), 1, 0
		var deepest []insertedAt
		for i, entry := range v.mapping {
			r := finalize2(entry.value)
			out[i], nodes = Entry{entry.key, r.native}, nodes+r.nodes
			if r.depth > depth {
				depth, deepest = r.depth, r.participants
			} else if r.depth == depth {
				deepest = append(deepest, r.participants...)
			}
		}
		return finalized2{out, nodes, depth + 1, append(participants, deepest...)}
	}
	return finalized2{v.plain(), 1, 0, participants}
}
func earliestParticipant2(items []insertedAt) *insertedAt {
	if len(items) == 0 {
		return nil
	}
	best := items[0]
	for _, item := range items[1:] {
		if item.line < best.line || item.line == best.line && item.offset < best.offset {
			best = item
		}
	}
	return &best
}
func collectParticipants2(v *pvalue, out *[]insertedAt) {
	*out = append(*out, v.priorInsertions...)
	if v.inserted != nil {
		*out = append(*out, *v.inserted)
	}
	for _, item := range v.array {
		collectParticipants2(item, out)
	}
	for _, entry := range v.mapping {
		collectParticipants2(entry.value, out)
	}
}

// Parse parses Lima Core 1.0 with References 2.0 enabled by default.
func Parse(input string, options ParseOptions) (Value, error) {
	if options.Mode != "" && options.Mode != ModeCore && options.Mode != ModeReferences {
		return nil, &LimaError{Code: InvalidOption, Message: fmt.Sprintf("Lima: invalid parse mode %q", options.Mode)}
	}
	if options.Mode == ModeCore {
		if options.Partials != nil {
			return nil, &LimaError{Code: InvalidOption, Message: "Lima: partials cannot be supplied in core mode"}
		}
		return ParseCoreWithOptions(input, CoreOptions{Strict: options.Strict, OnWarning: options.OnWarning})
	}
	partials, err := validatePartials2(options.Partials)
	if err != nil {
		return nil, err
	}
	if !strings.Contains(input, "${") && !strings.Contains(input, "$(") {
		return ParseCoreWithOptions(input, CoreOptions{Strict: options.Strict, OnWarning: options.OnWarning})
	}
	document, err := parseCorePositioned(input, options.Strict, options.OnWarning, true)
	if err != nil {
		return nil, err
	}
	ctx := &resolveContext2{
		cache:    map[*pvalue]map[int]resolution2{},
		document: make(map[string]*pvalue, len(document)),
	}
	for _, entry := range document {
		ctx.document[entry.key] = entry.value
	}
	resolved := make([]pentry, len(document))
	for i, entry := range document {
		stack := map[*pvalue]bool{entry.value: true}
		resolved[i] = pentry{entry.key, resolveNode2(entry.value, document, partials, maxReferenceEdges, stack, ctx).value}
	}
	if options.Strict {
		var walk func(*pvalue)
		walk = func(v *pvalue) {
			for _, token := range referenceTokensOf2(v) {
				addRefDiagnostic(ctx, token, UnresolvedReference, "")
			}
			for _, item := range v.array {
				walk(item)
			}
			for _, entry := range v.mapping {
				walk(entry.value)
			}
		}
		for _, entry := range resolved {
			walk(entry.value)
		}
	}
	if len(ctx.diagnostics) > 0 {
		sort.SliceStable(ctx.diagnostics, func(i, j int) bool {
			a, b := ctx.diagnostics[i], ctx.diagnostics[j]
			return a.line < b.line || a.line == b.line && a.offset < b.offset
		})
		return nil, ctx.diagnostics[0].err
	}
	out := make(Map, len(resolved))
	total, maxDepth := 1, 0
	var deepest []insertedAt
	for i, entry := range resolved {
		r := finalize2(entry.value)
		out[i], total = Entry{entry.key, r.native}, total+r.nodes
		if r.depth > maxDepth {
			maxDepth, deepest = r.depth, r.participants
		} else if r.depth == maxDepth {
			deepest = append(deepest, r.participants...)
		}
	}
	if maxDepth > nestingDepthLimit {
		winner := earliestParticipant2(deepest)
		line, token, column := 1, "", 0
		if winner != nil {
			line, token, column = winner.line, winner.token, winner.offset+1
		}
		return nil, &LimaError{Code: ResourceLimit, Line: line, Column: column, Token: token, Message: fmt.Sprintf("Lima: nesting depth exceeds maximum of %d at line %d", nestingDepthLimit, line)}
	}
	if total > resultNodeLimit {
		var participants []insertedAt
		for _, entry := range resolved {
			collectParticipants2(entry.value, &participants)
		}
		winner := earliestParticipant2(participants)
		line, token, column := 1, "", 0
		if winner != nil {
			line, token, column = winner.line, winner.token, winner.offset+1
		}
		return nil, &LimaError{Code: ResourceLimit, Line: line, Column: column, Token: token, Message: fmt.Sprintf("Lima: result exceeds maximum size of %d total nodes at line %d", resultNodeLimit, line)}
	}
	return out, nil
}

// ParseReferences is the compatibility alias for Parse.
//
// Deprecated: use Parse.
func ParseReferences(input string, options ReferencesOptions) (Value, error) {
	return Parse(input, options)
}
