import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useApp } from '@/app/store';
import { evidenceActions } from '@/engine';
import type { EvidenceVerb, GameState, Scenario } from '@/engine/types';
import { EvidenceDetail, EvidenceList, cue, type EvidenceEntry } from '@/components/play';
import { useSimple } from '@/app/simple';
import { cueFor } from './cueFor';

export interface EvidencePanelProps {
  game: GameState;
  scenario: Scenario;
  /** Ids the player has not looked at yet (for "New" markers). */
  newIds: Set<string>;
  /** Called whenever the list is visible so the parent can mark items as seen. */
  onSeen: (ids: string[]) => void;
  /** Optional district filter applied to the list. */
  districtFilter?: string;
}

/** Store-connected evidence list/detail switch. Works inside the mobile tray and the desktop rail. */
export function EvidencePanel({ game, scenario, newIds, onSeen, districtFilter }: EvidencePanelProps) {
  const openEvidenceId = useApp((s) => s.openEvidenceId);
  const setOpenEvidence = useApp((s) => s.setOpenEvidence);
  const dispatch = useApp((s) => s.dispatch);
  const autoPaused = useApp((s) => s.autoPaused);
  const simple = useSimple();
  const simpleTitles = useMemo(() => Object.fromEntries(scenario.evidence.map((e) => [e.id, e.simple?.title ?? e.title])), [scenario.evidence]);

  const entries = useMemo<EvidenceEntry[]>(() => {
    const out: EvidenceEntry[] = [];
    for (const item of scenario.evidence) {
      const st = game.evidence[item.id];
      if (!st || !st.visible) continue;
      if (districtFilter && item.district !== districtFilter) continue;
      out.push({ item, state: st });
    }
    return out;
  }, [scenario.evidence, game.evidence, districtFilter]);

  const seenRef = useRef(onSeen);
  seenRef.current = onSeen;
  useEffect(() => {
    if (!openEvidenceId) seenRef.current(entries.map((e) => e.item.id));
  }, [entries, openEvidenceId]);

  const open = useMemo(() => {
    if (!openEvidenceId) return undefined;
    const item = scenario.evidence.find((e) => e.id === openEvidenceId);
    const state = game.evidence[openEvidenceId];
    return item && state && state.visible ? { item, state } : undefined;
  }, [openEvidenceId, scenario.evidence, game.evidence]);

  const actions = useMemo(() => (open ? evidenceActions(game, scenario, open.item.id) : []), [game, scenario, open]);

  const onAction = useCallback(
    (verb: EvidenceVerb, compareWith?: string) => {
      if (!open) return;
      const before = game.evidence[open.item.id]?.state;
      dispatch({ type: 'evidence', tick: game.tick, evidenceId: open.item.id, verb, compareWith });
      const after = useApp.getState().game?.evidence[open.item.id]?.state;
      cue(...cueFor(verb, before, after));
    },
    [dispatch, game, open],
  );

  const districtName = open?.item.district ? scenario.districts.find((d) => d.id === open.item.district)?.name : undefined;

  if (open) {
    return (
      <EvidenceDetail
        item={open.item}
        state={open.state}
        actions={actions}
        onAction={onAction}
        onBack={() => setOpenEvidence(undefined)}
        disabled={game.status !== 'running' && !(autoPaused && game.status === 'paused')}
        districtName={districtName}
        simple={simple}
        simpleTitles={simpleTitles}
      />
    );
  }
  return <EvidenceList entries={entries} newIds={newIds} onOpen={(id) => setOpenEvidence(id)} simple={simple} />;
}
