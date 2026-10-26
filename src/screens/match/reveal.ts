/** The revealed log of a match, verified on this device with the engine version recorded in it. */
import { useEffect, useState } from 'react';
import type { MatchEventLog } from '@/contracts';
import type { Net } from '@/net';
import { engine } from '@/engine';
import { useLoad } from '../app/hooks';

export function useRevealLog(net: Net | null, matchId: string) {
  const load = useLoad<MatchEventLog>(net ? () => net.api.call('GET /v1/matches/:id/reveal', { params: { id: matchId } }) : null, [net, matchId]);
  const [verified, setVerified] = useState<boolean | null>(null);
  useEffect(() => {
    const log = load.data;
    if (!log) return;
    let alive = true;
    setVerified(null);
    engine
      .verifyMatchLog(log)
      .then((r) => alive && setVerified(r.ok))
      .catch(() => alive && setVerified(false));
    return () => {
      alive = false;
    };
  }, [load.data]);
  return { ...load, verified };
}
