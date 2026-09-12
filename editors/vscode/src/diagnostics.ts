/**
 * Pure diagnostic computation — no `vscode` dependency, so it can be unit
 * tested directly. `src/extension.ts` wires the results into the editor.
 *
 * The Lima parser (`@limaformat/lima`) is bundled from the monorepo source
 * so the checker and the published package never drift.
 */

import { parse } from "../../../js/src/index.js";
// The package's public `Diagnostic` type is the spec-frozen `{ message, line }`
// shape, but the objects actually delivered (to `onWarning`, and as thrown
// `LimaError`s) are the richer internal `LimaDiagnostic`. Pull that in directly.
import { LimaError, type LimaDiagnostic } from "../../../js/src/errors.js";

export type Severity = "error" | "warning";

export interface LimaFinding {
  severity: Severity;
  /** 1-based line within the parsed text. */
  line: number;
  /** 1-based column within the line. `1` when the parser gave no column. */
  column: number;
  /** Length of the offending token, when known — for a precise underline. */
  length?: number;
  code: string;
  message: string;
}

export interface CheckOptions {
  /** Default `true` — an editor wants strict feedback, not runtime coercion. */
  strict?: boolean;
  /**
   * Suppress `UNRESOLVED_REFERENCE` and partial-related findings — the
   * editor has no cross-file document or `partials` context, so these are
   * usually false positives. Default `true`.
   */
  ignoreUnresolvedReferences?: boolean;
}

const REFERENCE_CODES = new Set(["UNRESOLVED_REFERENCE", "INVALID_PARTIAL"]);

/**
 * Parse `text` as Lima and return every finding. Never throws.
 */
export function check(text: string, options: CheckOptions = {}): LimaFinding[] {
  const ignoreRefs = options.ignoreUnresolvedReferences ?? true;
  const findings: LimaFinding[] = [];

  try {
    parse(text, {
      strict: options.strict ?? true,
      onWarning: (d) => findings.push(toFinding("warning", d as LimaDiagnostic)),
    });
  } catch (e) {
    if (e instanceof LimaError) {
      findings.push(toFinding("error", e));
    } else {
      // A non-Lima error (e.g. a TypeError from a bad option) — surface it
      // rather than swallow it, but without a position.
      findings.push({
        severity: "error",
        line: 1,
        column: 1,
        code: "INTERNAL",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return findings.filter((f) => !(ignoreRefs && REFERENCE_CODES.has(f.code)));
}

function toFinding(
  severity: Severity,
  d: LimaDiagnostic | LimaError,
): LimaFinding {
  return {
    severity,
    line: typeof d.line === "number" && d.line > 0 ? d.line : 1,
    column: typeof d.column === "number" && d.column > 0 ? d.column : 1,
    length:
      typeof d.token === "string" && d.token.length > 0
        ? d.token.length
        : undefined,
    code: d.code ?? "PARSE_ERROR",
    message: stripPrefix(d.message),
  };
}

/** The parser prefixes every message with "Lima: "; the editor UI adds its own source label. */
function stripPrefix(message: string): string {
  return message.replace(/^Lima:\s*/, "");
}
