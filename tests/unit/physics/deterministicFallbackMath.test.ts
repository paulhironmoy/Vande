// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { fly, play } from './physics-helpers';

const DETERMINISTIC_PATH_SOURCES = [
  'src/physics/bat.ts',
  'src/physics/admissibility.ts',
  'src/physics/batGeometry.ts',
] as const;

const FORBIDDEN_MATH_CALLS = new Set(['acos', 'atan2', 'cos', 'hypot', 'pow', 'sin']);

function deterministicMathViolations(relativePath: string): string[] {
  const absolutePath = resolve(process.cwd(), relativePath);
  const source = ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations: string[] = [];
  const record = (node: ts.Node, operator: string) => {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push(`${relativePath}:${position.line + 1}:${position.character + 1}:${operator}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken) {
      record(node.operatorToken, '**');
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const owner = node.expression.expression;
      const method = node.expression.name.text;
      if (ts.isIdentifier(owner) && owner.text === 'Math' && FORBIDDEN_MATH_CALLS.has(method)) {
        record(node.expression, `Math.${method}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

const FLOAT_BYTES = new Uint8Array(8);
const FLOAT_VIEW = new DataView(FLOAT_BYTES.buffer);

function float64Bits(value: number): string {
  FLOAT_VIEW.setFloat64(0, value, false);
  return [...FLOAT_BYTES].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Stable text that preserves every IEEE-754 bit, including -0 and non-finite values. */
function bitEncoding(value: unknown): string {
  if (typeof value === 'number') return `n:${float64Bits(value)}`;
  if (typeof value === 'string') return `s:${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return value ? 'b:1' : 'b:0';
  if (typeof value === 'undefined') return 'u';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(bitEncoding).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${bitEncoding(entry)}`).join(',')}}`;
  }
  throw new Error(`Unsupported deterministic value: ${typeof value}`);
}

describe('fallback-path deterministic arithmetic', () => {
  it('uses only the approved deterministic primitives in the live fallback call graph', () => {
    const violations = DETERMINISTIC_PATH_SOURCES.flatMap(deterministicMathViolations);
    expect(violations).toEqual([]);
  });

  it.each([
    {
      name: 'hook face-hit',
      delivery: { variation: 'bouncer', lengthM: 10.5, lineM: -0.2, speedKph: 136 } as const,
      swing: { directionDeg: -140, power: 0.65, elevation: 0.25 } as const,
      footwork: 'back' as const,
    },
    {
      name: 'hook fail-closed',
      delivery: { variation: 'bouncer', lengthM: 10.5, lineM: -0.2, speedKph: 136 } as const,
      swing: { directionDeg: -130, power: 0.65, elevation: 0.25 } as const,
      footwork: 'back' as const,
    },
    {
      name: 'flick face-hit',
      delivery: { variation: 'stock', lengthM: 3.5, lineM: -0.12, speedKph: 136 } as const,
      swing: { directionDeg: -70, power: 0.5, elevation: 0.05 } as const,
      footwork: 'auto' as const,
    },
    {
      name: 'flick fail-closed',
      delivery: { variation: 'stock', lengthM: 3.5, lineM: -0.12, speedKph: 136 } as const,
      swing: { directionDeg: -65, power: 0.5, elevation: 0.05 } as const,
      footwork: 'auto' as const,
    },
  ])('replays $name with bit-identical authoritative output', ({ delivery, swing, footwork }) => {
    const first = play(fly(delivery), 0, swing, 'real', footwork);
    const second = play(fly(delivery), 0, swing, 'real', footwork);
    expect(bitEncoding(second)).toBe(bitEncoding(first));
  });
});
