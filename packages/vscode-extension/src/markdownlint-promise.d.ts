declare module 'markdownlint/promise' {
  export interface Configuration {
    [ruleName: string]: unknown;
  }

  export interface LintError {
    lineNumber: number;
    ruleNames: string[];
    ruleDescription: string;
    ruleInformation: string;
    errorDetail: string | null;
    errorContext: string | null;
    errorRange: [number, number] | null;
    fixInfo: unknown;
    severity: string;
  }

  export type LintResults = Record<string, LintError[]>;

  export interface Options {
    config?: Configuration;
    strings?: Record<string, string>;
  }

  export function lint(options: Options | null): Promise<LintResults>;
}
