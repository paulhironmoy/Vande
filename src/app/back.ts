/**
 * Back handling — ROOT-OWNED. Android's hardware Back first closes the top-most open layer (dialog, sheet, full-screen
 * replay), then goes back in the app's history, then returns to Home, and only exits the app from Home. On the web
 * the browser's own Back drives the router through popstate.
 */
import { useEffect, useRef } from 'react';

type Handler = () => void;
const stack: Array<{ id: number; handler: { current: Handler } }> = [];
let seq = 0;

/** Closes the top-most registered layer; false when nothing is open. */
export function closeTopLayer(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.handler.current();
  return true;
}

/**
 * Registers `onBack` while `active` (for example while a dialog is open). The most recently activated layer closes
 * first.
 */
export function useBackHandler(active: boolean, onBack: Handler): void {
  const handler = useRef(onBack);
  handler.current = onBack;
  useEffect(() => {
    if (!active) return;
    const entry = { id: ++seq, handler };
    stack.push(entry);
    return () => {
      const i = stack.findIndex((e) => e.id === entry.id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
