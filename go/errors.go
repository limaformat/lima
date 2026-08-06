package lima

// LimaDiagnosticCode is a stable, machine-readable parser diagnostic code.
type LimaDiagnosticCode string

const (
	// InvalidEscape reports an unsupported or malformed escape sequence.
	InvalidEscape LimaDiagnosticCode = "INVALID_ESCAPE"
	// InvalidQuote reports malformed quoted syntax.
	InvalidQuote LimaDiagnosticCode = "INVALID_QUOTE"
	// InvalidDate reports a date-shaped value with invalid components.
	InvalidDate LimaDiagnosticCode = "INVALID_DATE"
	// InvalidNumber reports numeric overflow or underflow in strict mode.
	InvalidNumber LimaDiagnosticCode = "INVALID_NUMBER"
	// InvalidReferenceShape reports a resolved value forbidden at its insertion site.
	InvalidReferenceShape LimaDiagnosticCode = "INVALID_REFERENCE_SHAPE"
	// InvalidIndentation reports invalid block indentation or collection mixing.
	InvalidIndentation LimaDiagnosticCode = "INVALID_INDENTATION"
	// InvalidFlowSyntax reports malformed or forbidden flow syntax.
	InvalidFlowSyntax LimaDiagnosticCode = "INVALID_FLOW_SYNTAX"
	// DuplicateKey reports a repeated mapping key in strict mode.
	DuplicateKey LimaDiagnosticCode = "DUPLICATE_KEY"
	// ResourceLimit reports a normative size, depth, or count limit violation.
	ResourceLimit LimaDiagnosticCode = "RESOURCE_LIMIT"
	// UnresolvedReference reports a reference unresolved after both phases.
	UnresolvedReference LimaDiagnosticCode = "UNRESOLVED_REFERENCE"
	// InvalidInterpolation reports a value that cannot be rendered into text.
	InvalidInterpolation LimaDiagnosticCode = "INVALID_INTERPOLATION"
	// InvalidPartial reports an invalid external partial name or value.
	InvalidPartial LimaDiagnosticCode = "INVALID_PARTIAL"
)

// LimaError is the structured error returned by ParseCore and ParseReferences.
// Optional source fields are zero-valued when they do not apply. It is usable
// with errors.As as either *LimaError or error.
type LimaError struct {
	// Code is the stable machine-readable diagnostic code.
	Code LimaDiagnosticCode
	// Message is the human-readable diagnostic text returned by Error.
	Message string
	// Line is the one-based source line, or zero when no document location applies.
	Line int
	// Column is the one-based source column, or zero when unavailable.
	Column int
	// Token is the source token associated with the diagnostic, when applicable.
	Token string
	// Key is the mapping key associated with the diagnostic, when applicable.
	Key string
	// Partial is the external partial name associated with the diagnostic.
	Partial string
	// Path is the value path within an invalid partial.
	Path string
}

func (e *LimaError) Error() string { return e.Message }

func limaError(code LimaDiagnosticCode, line int, message string) *LimaError {
	return &LimaError{Code: code, Line: line, Message: message}
}
