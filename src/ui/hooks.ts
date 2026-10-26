import { useState } from 'react';

/** Returns a stable, unique id with a prefix (SSR-safe enough for this client-only app). */
let idCounter = 0;
export function useStableId(prefix: string): string {
  const [id] = useState(() => `${prefix}-${++idCounter}`);
  return id;
}
