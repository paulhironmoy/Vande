import { vi } from 'vitest';

/**
 * Runs `run` and counts the JSON.stringify calls whose output is at least `minLength` long. Canonicalizing a large value is one
 * such call, so a test can tell whether a path canonicalized it without depending on how the path is written.
 */
export async function countLargeStringifies(minLength: number, run: () => unknown): Promise<number> {
  const real = JSON.stringify;
  let count = 0;
  const spy = vi.spyOn(JSON, 'stringify').mockImplementation(((...args: Parameters<typeof JSON.stringify>) => {
    const out = real(...args);
    if (typeof out === 'string' && out.length >= minLength) count += 1;
    return out;
  }) as typeof JSON.stringify);
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return count;
}
