import type { Measurement } from './metrics.mjs';

export interface MetricComparison {
  status: string;
  delta: number | null;
  direction: string | null;
  reason: string | null;
}

export interface ComparisonRow {
  id: string;
  lowerIsBetter: boolean | null;
  raw: Array<Measurement | null>;
  comparisons: MetricComparison[];
}

export interface ComparisonFinding {
  severity: string;
  package: string;
  finding: string;
}

export interface ComparisonReport extends Record<string, unknown> {
  status: string;
  metrics: ComparisonRow[];
  findings: ComparisonFinding[];
  integrity: {
    sourceFilesVerified: boolean;
    missingValuesImputed: boolean;
    competitorMediaRedistributed: boolean;
    qualityScoreProduced: boolean;
  };
}

export interface CompareRunResult {
  ok: boolean;
  status: string;
  output: string;
  json: string;
  markdown: string;
  evidenceIndex: string;
}

export function assertApprovedRegistration<T>(registration: T, registrationFile?: string | null): T;
export function comparePackages(packages: unknown[], registration: unknown): ComparisonRow[];
export function buildComparison(packages: unknown[], registration: unknown, evaluator: { id: string; independent: boolean }): ComparisonReport;
export function renderMarkdown(report: ComparisonReport): string;
export function verifyMetricsReceipt(options: Record<string, unknown>): {
  verified: true;
  receipt: unknown;
  receiptSha256: string;
  annotationCount: number;
};
export function compare(options: Record<string, unknown>): Promise<CompareRunResult>;

