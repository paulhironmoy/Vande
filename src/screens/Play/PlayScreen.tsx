import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/app/store';
import { CityMap } from '@/map';
import {
  ConsequenceFeed,
  DistrictCard,
  PauseSheet,
  PlayButton,
  PlayIcon,
  PlaySheet,
  RepublicPulse,
  StatusBar,
  useIsDesktop,
} from '@/components/play';
import { DecisionArea } from './DecisionArea';
import { EvidencePanel } from './EvidencePanel';
import styles from './PlayScreen.module.css';

export function PlayScreen() {
  const game = useApp((s) => s.game);
  const scenario = useApp((s) => s.scenario);
  const pulse = useApp((s) => s.pulse);
  const map = useApp((s) => s.map);
  const settings = useApp((s) => s.settings);
  const reducedMotion = useApp((s) => s.reducedMotion);
  const trayOpen = useApp((s) => s.trayOpen);
  const openEvidenceId = useApp((s) => s.openEvidenceId);
  const focusDistrict = useApp((s) => s.focusDistrict);
  const setTrayOpen = useApp((s) => s.setTrayOpen);
  const setOpenEvidence = useApp((s) => s.setOpenEvidence);
  const setFocusDistrict = useApp((s) => s.setFocusDistrict);
  const pauseGame = useApp((s) => s.pauseGame);
  const resumeGame = useApp((s) => s.resumeGame);
  const startChapter = useApp((s) => s.startChapter);
  const endChapter = useApp((s) => s.endChapter);
  const abandonCampaign = useApp((s) => s.abandonCampaign);
  const navigate = useApp((s) => s.navigate);

  const isDesktop = useIsDesktop();
  const [pulseOpen, setPulseOpen] = useState(false);
  const [evidenceOpenDesktop, setEvidenceOpenDesktop] = useState(true);
  const [seenEvidence, setSeenEvidence] = useState<Set<string>>(() => new Set());
  const [requestedDecision, setRequestedDecision] = useState<string | undefined>(undefined);
  const clearRequestedDecision = useCallback(() => setRequestedDecision(undefined), []);
  const endTimer = useRef<number | null>(null);

  const visibleEvidenceIds = useMemo(() => (game && scenario ? scenario.evidence.filter((e) => game.evidence[e.id]?.visible).map((e) => e.id) : []), [game, scenario]);
  const newEvidenceIds = useMemo(() => new Set(visibleEvidenceIds.filter((id) => !seenEvidence.has(id))), [visibleEvidenceIds, seenEvidence]);
  const unexamined = useMemo(() => {
    if (!game) return 0;
    return visibleEvidenceIds.filter((id) => {
      const st = game.evidence[id];
      return st && !st.destroyed && !st.inspected && !st.compared && (st.state === 'unverified' || st.state === 'unknown');
    }).length;
  }, [game, visibleEvidenceIds]);

  const markSeen = useCallback((ids: string[]) => {
    setSeenEvidence((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  // Chapter end: hand over to the chapter-result screen (the store may already do this; guard against double calls).
  useEffect(() => {
    if (!game || game.status !== 'ended') return;
    const delay = reducedMotion ? 150 : 1100;
    endTimer.current = window.setTimeout(() => {
      const s = useApp.getState();
      if (s.screen.name === 'play' && s.game?.status === 'ended') s.endChapter();
    }, delay);
    return () => {
      if (endTimer.current != null) window.clearTimeout(endTimer.current);
    };
  }, [game?.status, reducedMotion]);

  // Keyboard: Escape closes the district card when no sheet is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focusDistrict && !trayOpen && !pulseOpen) setFocusDistrict(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusDistrict, trayOpen, pulseOpen, setFocusDistrict]);

  if (!game || !scenario) {
    return (
      <main className={styles.screen} data-testid="play-screen">
        <div className={styles.noGame}>
          <PlayIcon name="info" size={28} />
          <h1 className={styles.noGameTitle}>No chapter in progress</h1>
          <p className={styles.noGameText}>Start the campaign or today&apos;s challenge from the home screen.</p>
          <PlayButton variant="primary" onClick={() => navigate({ name: 'home' }, { replace: true })}>
            Go home
          </PlayButton>
        </div>
      </main>
    );
  }

  const chapter = scenario.chapter;
  const district = focusDistrict ? map?.districts.find((d) => d.id === focusDistrict) : undefined;
  const sheetOpen = trayOpen || pulseOpen || game.status === 'paused';
  const paused = game.status === 'paused';
  const pendingHere = district ? game.pendingDecisionIds.find((id) => scenario.decisions.find((d) => d.id === id)?.district === district.id) : undefined;

  const showDecisionHere = () => {
    if (!pendingHere) return;
    setRequestedDecision(pendingHere);
    setFocusDistrict(undefined);
  };
  const showEvidenceHere = () => {
    if (!district) return;
    const here = visibleEvidenceIds.filter((id) => scenario.evidence.find((e) => e.id === id)?.district === district.id);
    if (here.length === 1) setOpenEvidence(here[0]);
    else setOpenEvidence(undefined);
    if (isDesktop) setEvidenceOpenDesktop(true);
    else setTrayOpen(true);
    setFocusDistrict(undefined);
  };
  const openEvidenceUi = () => {
    if (isDesktop) {
      setEvidenceOpenDesktop(true);
      document.getElementById('rail-evidence')?.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
    } else setTrayOpen(true);
  };
  const onAbandon = () => {
    abandonCampaign();
    const s = useApp.getState();
    if (s.screen.name !== 'home') s.navigate({ name: 'home' }, { replace: true });
  };

  const mapNode = map ? (
    <CityMap
      map={map}
      reducedMotion={reducedMotion}
      highContrast={settings.highContrast}
      colourBlind={settings.colourBlindSafe}
      captions={settings.captions}
      focus={focusDistrict}
      onSelectDistrict={(id) => setFocusDistrict(id ?? undefined)}
      className={styles.map}
    />
  ) : (
    <div className={styles.mapFallback} role="img" aria-label="City map unavailable">
      <PlayIcon name="map" size={28} />
      <span>City map unavailable on this device. Decisions and evidence still work.</span>
    </div>
  );

  const statusBar = (
    <StatusBar
      chapter={chapter}
      title={scenario.title}
      tick={game.tick}
      duration={game.duration}
      status={game.status}
      onPause={() => (paused ? resumeGame() : pauseGame())}
      className={styles.statusBar}
      pulseSlot={!isDesktop && pulse ? <RepublicPulse variant="compact" pulse={pulse} scores={game.scores} reducedMotion={reducedMotion} onExpand={() => setPulseOpen(true)} /> : undefined}
    />
  );

  const endedOverlay =
    game.status === 'ended' ? (
      <div className={styles.ended} role="status">
        <div className={styles.endedCard}>
          <PlayIcon name="check" size={22} />
          <p className={styles.endedTitle}>Chapter complete</p>
          <p className={styles.endedText}>Compiling what was resolved and what remains.</p>
          <PlayButton variant="primary" onClick={() => endChapter()} data-testid="chapter-ended-continue">
            See the resolution
          </PlayButton>
        </div>
      </div>
    ) : null;

  const briefingOverlay =
    game.status === 'briefing' ? (
      <div className={styles.ended} role="status">
        <div className={styles.endedCard}>
          <PlayIcon name="play" size={22} />
          <p className={styles.endedTitle}>Ready when you are</p>
          <p className={styles.endedText}>The clock starts when you begin.</p>
          <PlayButton variant="primary" onClick={() => startChapter()} data-testid="play-start">
            Begin
          </PlayButton>
        </div>
      </div>
    ) : null;

  if (isDesktop) {
    return (
      <main className={styles.screen} data-testid="play-screen" data-layout="desktop">
        {statusBar}
        <div className={styles.body}>
          <section className={styles.mapArea} aria-label="City map">
            {mapNode}
            {district ? <DistrictCard district={district} onClose={() => setFocusDistrict(undefined)} onShowDecision={pendingHere ? showDecisionHere : undefined} onShowEvidence={district.openEvidence > 0 ? showEvidenceHere : undefined} className={styles.districtCard} /> : null}
            {endedOverlay}
            {briefingOverlay}
          </section>
          <aside className={styles.rail} aria-label="Republic status, decisions and evidence">
            <section className={styles.railSection} aria-labelledby="rail-pulse-h">
              <h2 id="rail-pulse-h" className={styles.railHeading}>
                Republic Pulse
              </h2>
              {pulse ? <RepublicPulse pulse={pulse} scores={game.scores} reducedMotion={reducedMotion} alwaysShowValues={settings.alwaysShowValues} /> : null}
            </section>
            <section className={styles.railSection} aria-labelledby="rail-decisions-h">
              <h2 id="rail-decisions-h" className={styles.railHeading}>
                Decisions
                {game.pendingDecisionIds.length > 0 ? <span className={styles.count}>{game.pendingDecisionIds.length}</span> : null}
              </h2>
              <DecisionArea game={game} scenario={scenario} layout="stack" requestedDecisionId={requestedDecision} onRequestHandled={clearRequestedDecision} unexaminedEvidence={unexamined} onOpenEvidence={openEvidenceUi} sheetOpen={sheetOpen} />
            </section>
            <section className={styles.railSection} aria-labelledby="rail-evidence-h" id="rail-evidence">
              <h2 className={styles.railHeading} id="rail-evidence-h">
                <button type="button" className={styles.disclosure} aria-expanded={evidenceOpenDesktop} aria-controls="rail-evidence-body" onClick={() => setEvidenceOpenDesktop((v) => !v)} data-testid="evidence-tray-toggle">
                  <span>Evidence</span>
                  <span className={styles.count} aria-label={`${visibleEvidenceIds.length} items`}>
                    {visibleEvidenceIds.length}
                  </span>
                  {newEvidenceIds.size > 0 ? <span className={styles.newBadge}>{newEvidenceIds.size} new</span> : null}
                  <PlayIcon name={evidenceOpenDesktop ? 'chevronUp' : 'chevronDown'} size={16} className={styles.chev} />
                </button>
              </h2>
              <div id="rail-evidence-body" hidden={!evidenceOpenDesktop} data-testid="evidence-tray">
                {evidenceOpenDesktop ? <EvidencePanel game={game} scenario={scenario} newIds={newEvidenceIds} onSeen={markSeen} /> : null}
              </div>
            </section>
            <section className={styles.railSection} aria-label="Recent events">
              <ConsequenceFeed items={game.feed} limit={6} />
            </section>
          </aside>
        </div>
        <PauseSheet open={paused} pace={settings.timerPace} chapterTitle={`Chapter ${chapter} · ${scenario.title}`} onResume={resumeGame} onAbandon={onAbandon} onOpenSettings={() => navigate({ name: 'settings' })} />
      </main>
    );
  }

  return (
    <main className={styles.screen} data-testid="play-screen" data-layout="mobile">
      {statusBar}
      <div className={styles.body}>
        <section className={styles.mapArea} aria-label="City map">
          {mapNode}
          <button
            type="button"
            className={styles.trayToggle}
            data-testid="evidence-tray-toggle"
            aria-expanded={trayOpen}
            aria-label={`Evidence, ${visibleEvidenceIds.length} items${newEvidenceIds.size > 0 ? `, ${newEvidenceIds.size} new` : ''}`}
            onClick={() => setTrayOpen(true)}
          >
            <PlayIcon name="tray" size={20} />
            <span className={styles.trayLabel}>Evidence</span>
            <span className={styles.trayCount} aria-hidden="true">
              {visibleEvidenceIds.length}
            </span>
            {newEvidenceIds.size > 0 ? (
              <span className={styles.trayNew} aria-hidden="true">
                {newEvidenceIds.size > 9 ? '9+' : newEvidenceIds.size}
              </span>
            ) : null}
          </button>
          {endedOverlay}
          {briefingOverlay}
        </section>
        <section className={styles.dock} aria-label="Decisions">
          {district ? <DistrictCard district={district} onClose={() => setFocusDistrict(undefined)} onShowDecision={pendingHere ? showDecisionHere : undefined} onShowEvidence={district.openEvidence > 0 ? showEvidenceHere : undefined} className={styles.districtDock} /> : null}
          <ConsequenceFeed items={game.feed} limit={6} collapsible />
          <DecisionArea game={game} scenario={scenario} layout="pager" requestedDecisionId={requestedDecision} onRequestHandled={clearRequestedDecision} unexaminedEvidence={unexamined} onOpenEvidence={openEvidenceUi} sheetOpen={sheetOpen} />
        </section>
      </div>

      <PlaySheet
        open={trayOpen}
        onClose={() => setTrayOpen(false)}
        title={openEvidenceId ? 'Evidence detail' : 'Evidence'}
        hideTitle={Boolean(openEvidenceId)}
        testId="evidence-tray"
        tall
      >
        <EvidencePanel game={game} scenario={scenario} newIds={newEvidenceIds} onSeen={markSeen} />
      </PlaySheet>

      <PlaySheet open={pulseOpen} onClose={() => setPulseOpen(false)} title="Republic Pulse" testId="pulse-sheet">
        {pulse ? (
          <div className={styles.pulseSheet}>
            <RepublicPulse pulse={pulse} scores={game.scores} reducedMotion={reducedMotion} alwaysShowValues testId="pulse-large" valuesTestId="pulse-values" />
          </div>
        ) : null}
      </PlaySheet>

      <PauseSheet open={paused} pace={settings.timerPace} chapterTitle={`Chapter ${chapter} · ${scenario.title}`} onResume={resumeGame} onAbandon={onAbandon} onOpenSettings={() => navigate({ name: 'settings' })} />
    </main>
  );
}

export default PlayScreen;
