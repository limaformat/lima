// Lima Core 1.0 — implementation in progress
export declare function parse(input: string, options?: ParseOptions): Record<string, unknown>;
export declare type ParseOptions = {
  strict?: boolean;
  onWarning?: (diagnostic: Diagnostic) => void;
};
export declare type Diagnostic = {
  message: string;
  line: number;
};
