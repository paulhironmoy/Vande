export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Measurement {
  id: string;
  status: string;
  value: number | string | boolean | null;
  unit: string | null;
  sampleSize: number;
  uncertainty: Record<string, unknown> | null;
  timecodesMs: number[];
  sources: string[];
  limitations: string[];
}

export interface AnnotationEntry {
  absolute?: string;
  path?: string;
  sha256?: string;
  value: {
    annotator: { id: string; role: string; independentOfBuilder: boolean };
    source: { manifestSha256: string; mediaSha256: string };
    events: unknown[];
    [key: string]: unknown;
  };
}

export interface AnnotationWorkflow {
  selected: AnnotationEntry | null;
  rejections: string[];
  hashes: string[];
}

export interface MetricsRunResult {
  ok: boolean;
  output: string;
  metrics: string;
  receipt: string;
  status: string;
}

export function rectangleUnionArea(rectangles: Rectangle[]): number;
export function measurementsFromAnnotations(manifest: unknown, annotation: unknown, sourcePath?: string): Measurement[];
export function annotationWorkflow(entries: AnnotationEntry[]): AnnotationWorkflow;
export function calculateMetrics(options: Record<string, unknown>): Promise<MetricsRunResult>;

