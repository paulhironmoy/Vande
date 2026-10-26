/**
 * Registers the engine's exact input rules with the design system (aim sectors, legal zones, release meter and its
 * grader). Imported for its side effect by every screen that already depends on the engine, so the UI library and
 * the app shell stay engine-free while gameplay screens use the authoritative rules.
 */
import type { FieldZone, ShotType } from '@/contracts';
import * as Engine from '@/engine';
import { registerAimRules } from '@/ui/cricket/aim';
import { registerMeterRules, type MeterRules } from '@/ui/cricket/meter';

const E = Engine as unknown as {
  LEGAL_ZONES?: Record<ShotType, readonly FieldZone[]>;
  zoneFromSwipe?: (dx: number, dy: number) => FieldZone | null;
  EXECUTION_METER?: MeterRules;
};

registerAimRules({ legal: E.LEGAL_ZONES, fromSwipe: E.zoneFromSwipe });
registerMeterRules({ rules: E.EXECUTION_METER, grade: (trace) => Engine.engine.executionQuality(trace) });
