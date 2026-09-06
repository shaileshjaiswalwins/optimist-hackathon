import { FormEvent, PointerEvent as ReactPointerEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { reducers, tables } from './module_bindings';
import { GameScene } from './GameScene';
import { VehicleDebugPanel } from './VehicleDebugPanel';
import { MiniMap } from './MiniMap';
import { HitToasts, type Toast } from './HitToast';
import { isMuted, setMuted } from './muteState';
import { playCountdownCue, playHit, playPickup, unlockAudio } from './gameAudio';
import './styles.css';

type CabinetChip = { label: string; value: string; dark?: boolean };

function Cabinet({
  label,
  chips,
  muted,
  onMute,
  children,
}: {
  label: string;
  chips: CabinetChip[];
  muted: boolean;
  onMute: () => void;
  children: ReactNode;
}) {
  return (
    <main className="landing">
      <div className="cabinet" aria-label={label}>
        <div className="cabinet-road" aria-hidden="true">
          <span /><span /><span />
        </div>
        <button type="button" className="sound-toggle" onClick={onMute} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted}>
          {muted ? '🔇' : '🔊'}
        </button>
        <header className="cabinet-hud">
          {chips.map(chip => (
            <div className={`chip${chip.dark ? ' chip-dark' : ''}`} key={chip.label}>
              <span>{chip.label}</span>
              <strong>{chip.value}</strong>
            </div>
          ))}
        </header>
        <section className="landing-overlay">{children}</section>
      </div>
    </main>
  );
}

const vehicles = [
  { id: 'auto', emoji: '🛺', label: 'Auto' },
  { id: 'scooty', emoji: '🛵', label: 'Activa 2G' },
  { id: 'thar', emoji: '🚙', label: 'Thar' },
] as const;

function App() {
  const { identity, isActive: connected } = useSpacetimeDB();
  const [matches] = useTable(tables.match);
  const [profiles] = useTable(tables.playerProfile);
  const joinMatch = useReducer(reducers.joinMatch);
  const startMatch = useReducer(reducers.startMatch);
  const setDrivingInput = useReducer(reducers.setDrivingInput);
  const ensureWaitingMatch = useReducer(reducers.ensureWaitingMatch);
  const useAttack = useReducer(reducers.useAttack);
  const markPlayerReady = useReducer(reducers.markPlayerReady);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [vehicle, setVehicle] = useState('auto');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [joinNextRace, setJoinNextRace] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const inputSeq = useRef(0);
  const readySubmitted = useRef(false);
  const readyRequestSentAt = useRef<number | null>(null);
  const countdownClockSampled = useRef(false);
  const lastCountdownCue = useRef<3 | 2 | 1 | 'START' | null>(null);
  const driving = useRef({ steering: 0, throttle: 0, boost: false });
  const keysHeld = useRef({ left: false, right: false });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenCollisionKeys = useRef(new Set<string>());
  const seenAttackKeys = useRef(new Set<string>());
  const [muted, setMutedState] = useState(isMuted());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const attackPending = useRef(false);

  const pushToast = (text: string, tone: Toast['tone']) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(current => [...current, { id, text, tone }]);
    window.setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), 1500);
  };

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(console.error);
    else document.documentElement.requestFullscreen().catch(console.error);
  };

  const toggleMute = () => {
    unlockAudio();
    setMuted(!muted);
    setMutedState(!muted);
  };

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const identityProfiles = profiles
    .filter(profile => profile.identity?.toHexString() === identity?.toHexString())
    .sort((a, b) => Number(b.playerId - a.playerId));
  const currentIdentityProfile = identityProfiles.find(profile => {
    const profileMatch = matches.find(item => item.matchId === profile.matchId);
    return profileMatch?.state === 'waiting'
      || profileMatch?.state === 'preparing'
      || profileMatch?.state === 'countdown'
      || profileMatch?.state === 'active';
  });
  const myProfile = currentIdentityProfile ?? (joinNextRace ? undefined : identityProfiles[0]);
  const currentMatch = myProfile
    ? matches.find(item => item.matchId === myProfile.matchId)
    : matches.find(item => item.state === 'waiting');
  const currentMatchId = currentMatch?.matchId ?? 0n;
  const subscriptionOptions = { enabled: currentMatch !== undefined };
  const [vitals] = useTable(tables.playerVitals.where(row => row.matchId.eq(currentMatchId)), subscriptionOptions);
  const [positions] = useTable(tables.playerPosition.where(row => row.matchId.eq(currentMatchId)), subscriptionOptions);
  const [obstacles] = useTable(tables.obstacle.where(row => row.matchId.eq(currentMatchId)), subscriptionOptions);
  const [startGates] = useTable(tables.matchStartGate.where(row => row.matchId.eq(currentMatchId)), subscriptionOptions);
  const [readiness] = useTable(tables.playerReady.where(row => row.matchId.eq(currentMatchId)), subscriptionOptions);
  const participants = useMemo(
    () => currentMatch ? profiles.filter(profile => profile.matchId === currentMatch.matchId) : [],
    [profiles, currentMatch]
  );
  const matchVitals = useMemo(
    () => currentMatch ? vitals.filter(item => item.matchId === currentMatch.matchId) : [],
    [vitals, currentMatch]
  );
  const matchPositions = useMemo(
    () => currentMatch ? positions.filter(item => item.matchId === currentMatch.matchId) : [],
    [positions, currentMatch]
  );
  const matchObstacles = useMemo(
    () => currentMatch ? obstacles.filter(item => item.matchId === currentMatch.matchId) : [],
    [obstacles, currentMatch]
  );

  useEffect(() => {
    setSceneReady(false);
    readySubmitted.current = false;
    readyRequestSentAt.current = null;
    countdownClockSampled.current = false;
    lastCountdownCue.current = null;
    setServerOffsetMs(0);
  }, [currentMatch?.matchId]);

  useEffect(() => {
    if (!myProfile || currentMatch?.state !== 'preparing' || !sceneReady || readySubmitted.current) return;
    readySubmitted.current = true;
    readyRequestSentAt.current = Date.now();
    markPlayerReady({ playerId: myProfile.playerId }).catch(error => {
      readySubmitted.current = false;
      console.error(error);
    });
  }, [currentMatch?.state, markPlayerReady, myProfile, sceneReady]);

  const myReadiness = readiness.find(row => row.playerId === myProfile?.playerId);
  const startGate = startGates[0];

  useEffect(() => {
    if (!myReadiness?.readyAt || readyRequestSentAt.current == null) return;
    const midpoint = (readyRequestSentAt.current + Date.now()) / 2;
    setServerOffsetMs(Number(myReadiness.readyAt.toMillis()) - midpoint);
    readyRequestSentAt.current = null;
    countdownClockSampled.current = true;
  }, [myReadiness?.readyAt]);

  useEffect(() => {
    if (currentMatch?.state !== 'countdown' || !startGate?.countdownStartedAt || countdownClockSampled.current) return;
    setServerOffsetMs(Number(startGate.countdownStartedAt.toMillis()) - Date.now());
    countdownClockSampled.current = true;
  }, [currentMatch?.state, startGate?.countdownStartedAt]);

  useEffect(() => {
    if (currentMatch?.state !== 'countdown') return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, [currentMatch?.state]);

  useEffect(() => {
    if (currentMatch?.state !== 'countdown' || !startGate?.raceStartsAt) return;
    const remaining = Number(startGate.raceStartsAt.toMillis()) - (clockNow + serverOffsetMs);
    const cue: 3 | 2 | 1 | 'START' = remaining > 3000 ? 3 : remaining > 2000 ? 2 : remaining > 1000 ? 1 : 'START';
    if (lastCountdownCue.current === cue) return;
    lastCountdownCue.current = cue;
    playCountdownCue(cue);
  }, [clockNow, currentMatch?.state, serverOffsetMs, startGate?.raceStartsAt]);

  useEffect(() => {
    if (currentMatch?.state !== 'preparing' && currentMatch?.state !== 'countdown') return;
    keysHeld.current.left = false;
    keysHeld.current.right = false;
    driving.current = { steering: 0, throttle: 0, boost: false };
  }, [currentMatch?.state]);

  useEffect(() => {
    if (connected) ensureWaitingMatch().catch(console.error);
  }, [connected, ensureWaitingMatch]);

  async function handleJoin(event: FormEvent) {
    event.preventDefault();
    if (!currentMatch || !connected || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await joinMatch({ matchId: currentMatch.matchId, name, email, consentGiven: consent, vehicleType: vehicle });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not join.');
    } finally {
      setSubmitting(false);
    }
  }

  async function beginRace() {
    if (!currentMatch || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await startMatch({ matchId: currentMatch.matchId });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the race.');
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!myProfile || currentMatch?.state !== 'active' || myReadiness?.eligible === false) return;
    const playerId = myProfile.playerId;
    let lastSent = { steering: NaN, throttle: NaN, boost: false };
    let lastSentAt = 0;
    const send = () => {
      const now = performance.now();
      const inputChanged = lastSent.steering !== driving.current.steering
        || lastSent.throttle !== driving.current.throttle
        || lastSent.boost !== driving.current.boost;
      if (!inputChanged && now - lastSentAt < 900) return;
      inputSeq.current += 1;
      setDrivingInput({ playerId, ...driving.current, inputSeq: inputSeq.current }).catch(console.error);
      lastSent = { ...driving.current };
      lastSentAt = now;
    };
    const applyKeyboardSteer = () => {
      driving.current.steering = (keysHeld.current.right ? 1 : 0) - (keysHeld.current.left ? 1 : 0);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
        keysHeld.current.left = true;
      }
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
        keysHeld.current.right = true;
      }
      if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') {
        driving.current.throttle = 1;
      }
      if (event.key === 'Shift') {
        driving.current.boost = true;
      }
      applyKeyboardSteer();
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') keysHeld.current.left = false;
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') keysHeld.current.right = false;
      if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') {
        driving.current.throttle = 0;
      }
      if (event.key === 'Shift') {
        driving.current.boost = false;
      }
      applyKeyboardSteer();
    };
    const release = () => {
      keysHeld.current.left = false;
      keysHeld.current.right = false;
      driving.current = { steering: 0, throttle: 0, boost: false };
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', release);
    send();
    const timer = window.setInterval(send, 50);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', release);
      release();
      inputSeq.current += 1;
      setDrivingInput({ playerId, ...driving.current, inputSeq: inputSeq.current }).catch(console.error);
    };
  }, [currentMatch?.state, myProfile, myReadiness?.eligible, setDrivingInput]);

  function holdControl(control: Partial<typeof driving.current>) {
    driving.current = { ...driving.current, ...control };
  }

  function pressControl(event: ReactPointerEvent<HTMLButtonElement>, control: Partial<typeof driving.current>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    holdControl(control);
  }

  function releaseControl(event: ReactPointerEvent<HTMLButtonElement>, control: Partial<typeof driving.current>) {
    event.preventDefault();
    holdControl(control);
  }

  function setSteeringButton(direction: 'left' | 'right', pressed: boolean) {
    keysHeld.current[direction] = pressed;
    driving.current.steering = (keysHeld.current.right ? 1 : 0) - (keysHeld.current.left ? 1 : 0);
  }

  function pressSteering(event: ReactPointerEvent<HTMLButtonElement>, direction: 'left' | 'right') {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSteeringButton(direction, true);
  }

  function releaseSteering(event: ReactPointerEvent<HTMLButtonElement>, direction: 'left' | 'right') {
    event.preventDefault();
    setSteeringButton(direction, false);
  }

  const collisionSub = useTable(tables.collisionEvent.where(row => row.playerId.eq(myProfile?.playerId ?? 0n)), { enabled: currentMatch?.state === 'active' && myProfile !== undefined });
  const attackTargetSub = useTable(tables.attackEvent.where(row => row.targetPlayerId.eq(myProfile?.playerId ?? 0n)), { enabled: currentMatch?.state === 'active' && myProfile !== undefined });
  const attackLandedSub = useTable(tables.attackEvent.where(row => row.attackerPlayerId.eq(myProfile?.playerId ?? 0n)), { enabled: currentMatch?.state === 'active' && myProfile !== undefined });
  const [myCollisions] = collisionSub;
  const [attacksOnMe] = attackTargetSub;
  const [attacksByMe] = attackLandedSub;
  const attackEvents = useMemo(() => [...attacksOnMe, ...attacksByMe], [attacksOnMe, attacksByMe]);
  const nameOf = (playerId: bigint) => participants.find(profile => profile.playerId === playerId)?.name ?? 'a racer';

  const attack = () => {
    if (!myProfile || currentMatch?.state !== 'active' || myReadiness?.eligible === false || attackPending.current) return;
    attackPending.current = true;
    unlockAudio();
    const dynamics = myProfile.vehicleType === 'thar'
      ? { kind: 'ram', range: 3.5 }
      : { kind: 'kick', range: 2.2 };
    const myPosition = matchPositions.find(position => position.playerId === myProfile.playerId);
    const visualTarget = myPosition
      ? matchPositions
          .filter(position => position.playerId !== myProfile.playerId)
          .filter(position => !matchVitals.find(vitals => vitals.playerId === position.playerId)?.eliminated)
          .filter(position => Math.abs(position.x - myPosition.x) <= 3.85)
          .filter(position => Math.abs(position.distance - myPosition.distance) <= dynamics.range)
          .sort((a, b) => {
            const aX = a.x - myPosition.x;
            const aZ = a.distance - myPosition.distance;
            const bX = b.x - myPosition.x;
            const bZ = b.distance - myPosition.distance;
            return aX * aX + aZ * aZ - (bX * bX + bZ * bZ);
          })[0]
      : undefined;
    const nearestVisibleRacer = myPosition
      ? matchPositions
          .filter(position => position.playerId !== myProfile.playerId)
          .filter(position => !matchVitals.find(vitals => vitals.playerId === position.playerId)?.eliminated)
          .sort((a, b) => {
            const aX = a.x - myPosition.x;
            const aZ = a.distance - myPosition.distance;
            const bX = b.x - myPosition.x;
            const bZ = b.distance - myPosition.distance;
            return aX * aX + aZ * aZ - (bX * bX + bZ * bZ);
          })[0]
      : undefined;
    useAttack({ playerId: myProfile.playerId })
      .then(() => {
        const animatedTarget = visualTarget ?? nearestVisibleRacer;
        playHit();
        pushToast(animatedTarget
          ? `${dynamics.kind === 'ram' ? 'RAMMED' : 'ATTACKED'} ${nameOf(animatedTarget.playerId)}!`
          : 'ATTACK LANDED!', 'landed');
        if (!animatedTarget) return;
        window.dispatchEvent(new CustomEvent('jaldi-attack-activated', {
          detail: {
            attackerPlayerId: myProfile.playerId,
            targetPlayerId: animatedTarget.playerId,
            attackKind: dynamics.kind,
          },
        }));
      })
      .catch(caught => {
        const message = caught instanceof Error ? caught.message : 'No racer in range.';
        pushToast(message.includes('cooldown') ? 'ATTACK RECHARGING' : 'NO RACER IN RANGE', 'damage');
      })
      .finally(() => {
        window.setTimeout(() => { attackPending.current = false; }, 180);
      });
  };

  useEffect(() => {
    if (currentMatch?.state !== 'active' || !myProfile || myReadiness?.eligible === false) return;
    const onAttackKey = (event: KeyboardEvent) => {
      if ((event.code === 'Space' || event.key.toLowerCase() === 'f') && !event.repeat) {
        event.preventDefault();
        attack();
      }
    };
    window.addEventListener('keydown', onAttackKey);
    return () => window.removeEventListener('keydown', onAttackKey);
  }, [currentMatch?.state, myProfile, myReadiness?.eligible, useAttack]);

  useEffect(() => {
    for (const row of myCollisions) {
      const key = `${row.obstacleId}-${row.createdAt.toMillis()}`;
      if (seenCollisionKeys.current.has(key)) continue;
      seenCollisionKeys.current.add(key);
      const kind = row.kind;
      if (kind === 'powerup') {
        playPickup();
        pushToast('LIFE UP!', 'pickup');
      } else {
        playHit();
        pushToast(kind === 'pedestrian' ? 'HIT A PERSON! -1 LIFE' : 'HIT! -1 LIFE', 'damage');
      }
    }
  }, [myCollisions]);

  useEffect(() => {
    for (const row of attacksOnMe) {
      const key = `on-${row.attackerPlayerId}-${row.createdAt.toMillis()}`;
      if (seenAttackKeys.current.has(key)) continue;
      seenAttackKeys.current.add(key);
      playHit();
      pushToast(`${row.attackKind === 'ram' ? 'RAMMED' : 'ATTACKED'} by ${nameOf(row.attackerPlayerId)}!`, 'damage');
    }
  }, [attacksOnMe, participants]);

  useEffect(() => {
    for (const row of attacksByMe) {
      const key = `by-${row.targetPlayerId}-${row.createdAt.toMillis()}`;
      if (seenAttackKeys.current.has(key)) continue;
      seenAttackKeys.current.add(key);
      playHit();
      pushToast(`${row.attackKind === 'ram' ? 'RAMMED' : 'ATTACKED'} ${nameOf(row.targetPlayerId)}!`, 'landed');
    }
  }, [attacksByMe, participants]);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const measure = () => {
      const start = performance.now();
      ensureWaitingMatch().then(() => {
        if (cancelled) return;
        setPingMs(Math.round(performance.now() - start));
      }).catch(() => {});
    };
    measure();
    const timer = window.setInterval(measure, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [connected, ensureWaitingMatch]);

  if (myProfile && currentMatch && ['preparing', 'countdown', 'active'].includes(currentMatch.state)) {
    const myPosition = matchPositions.find(item => item.playerId === myProfile.playerId);
    const myVitals = matchVitals.find(item => item.playerId === myProfile.playerId);
    const vitalsByPlayer = new Map(matchVitals.map(item => [item.playerId, item]));
    const sorted = [...participants].sort((a, b) => {
      const aScore = vitalsByPlayer.get(a.playerId)?.score ?? 0;
      const bScore = vitalsByPlayer.get(b.playerId)?.score ?? 0;
      return bScore - aScore;
    });
    const readyHumans = participants.filter(profile => !profile.isBot)
      .filter(profile => readiness.find(row => row.playerId === profile.playerId)?.ready).length;
    const humanCount = participants.filter(profile => !profile.isBot).length;
    const eligible = myReadiness?.eligible !== false;
    const raceStartsAtMs = startGate?.raceStartsAt ? Number(startGate.raceStartsAt.toMillis()) : undefined;
    const countdownRemaining = raceStartsAtMs === undefined ? undefined : raceStartsAtMs - (clockNow + serverOffsetMs);
    const countdownLabel = countdownRemaining === undefined
      ? '…'
      : countdownRemaining > 3000
        ? '3'
        : countdownRemaining > 2000
          ? '2'
          : countdownRemaining > 1000
            ? '1'
            : 'START';
    return (
      <main className="game-page">
        <GameScene myPlayerId={myProfile.playerId} profiles={participants} positions={matchPositions} obstacles={matchObstacles} attackEvents={attackEvents} input={driving} onReady={() => setSceneReady(true)} />
        {currentMatch.state === 'active' && !myVitals?.eliminated && <MiniMap myPlayerId={myProfile.playerId} profiles={participants} positions={matchPositions} vitals={matchVitals} fieldSize={participants.length} />}
        {new URLSearchParams(window.location.search).get('debugPhysics') === '1' && <VehicleDebugPanel />}
        {currentMatch.state === 'preparing' && <div className="scene-loading" role="status" aria-live="polite"><div className="scene-loading-card"><span className="road-spinner" /><p>{sceneReady ? 'Waiting for racers…' : 'Preparing the Bengaluru streets…'}</p><small>{readyHumans} / {humanCount} racers ready</small></div></div>}
        {currentMatch.state === 'countdown' && <div className="countdown-overlay" role="status" aria-live="assertive"><strong>{eligible ? countdownLabel : 'SPECTATING'}</strong><small>{eligible ? 'Get ready!' : 'Your scene did not finish loading in time.'}</small></div>}
        <header className="hud top-hud">
          <div className="chip">
            <span>Speed</span>
            <strong>{Math.round((myPosition?.speed ?? 0) * 3.6)}</strong>
          </div>
          <div className="hud-title">JALDI GHAR PAHUNCHO</div>
          <div className="chip">
            <span>Score</span>
            <strong>{myVitals?.score ?? 0}m</strong>
          </div>
          <div className="chip chip-dark lives-hud" aria-label={`${myVitals?.strikesRemaining ?? 3} lives remaining. Zero lives and you are out.`}>
            <span>Lives</span>
            <strong>
              {Array.from({ length: 3 }, (_, index) => (
                <span className={index < (myVitals?.strikesRemaining ?? 3) ? 'heart-full' : 'heart-empty'} key={index} aria-hidden="true">♥</span>
              ))}
            </strong>
          </div>
          <div className="hud-actions">
            <button type="button" className="corner-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? '🔇' : '🔊'}</button>
            <button type="button" className="corner-btn" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>{isFullscreen ? '⤡' : '⤢'}</button>
            <span className="ping-readout">{pingMs != null ? `${pingMs}ms` : '…'}</span>
          </div>
        </header>
        <aside className="mini-board hud">
          {sorted.map((profile, index) => (
            <div key={profile.playerId.toString()}>
              <span>{index + 1}. {profile.name}{profile.isBot ? ' 🤖' : ''}</span>
              <strong>{vitalsByPlayer.get(profile.playerId)?.score ?? 0}</strong>
            </div>
          ))}
        </aside>
        {currentMatch.state === 'active' && myVitals?.eliminated && <div className="game-message"><h2>You couldn't reach home!</h2><p>Watch the race finish live.</p></div>}
        <HitToasts toasts={toasts} />
        {currentMatch.state === 'active' && eligible && !myVitals?.eliminated && <div className="controls hud">
          <div className="steering-controls" aria-label="Steering controls">
            <button type="button" className="direction control-left" aria-label="Steer left" onPointerDown={event => pressSteering(event, 'left')} onPointerUp={event => releaseSteering(event, 'left')} onPointerCancel={event => releaseSteering(event, 'left')} onLostPointerCapture={event => releaseSteering(event, 'left')}>←</button>
            <button type="button" className="direction control-right" aria-label="Steer right" onPointerDown={event => pressSteering(event, 'right')} onPointerUp={event => releaseSteering(event, 'right')} onPointerCancel={event => releaseSteering(event, 'right')} onLostPointerCapture={event => releaseSteering(event, 'right')}>→</button>
          </div>
          <div className="action-controls" aria-label="Action controls">
            <button type="button" className="attack control-attack" aria-label="Attack nearby racer" onClick={attack}>ATTACK</button>
            <button type="button" className="accelerate control-accelerate" aria-label="Accelerate" onPointerDown={event => pressControl(event, { throttle: 1 })} onPointerUp={event => releaseControl(event, { throttle: 0 })} onPointerCancel={event => releaseControl(event, { throttle: 0 })} onLostPointerCapture={event => releaseControl(event, { throttle: 0 })}><span aria-hidden="true">↑</span><small>GO</small></button>
          </div>
        </div>}
      </main>
    );
  }

  if (myProfile && currentMatch?.state === 'finished') {
    const winner = participants.find(profile => profile.playerId === currentMatch.winnerPlayerId);
    const won = currentMatch.winnerPlayerId === myProfile.playerId;
    const myScore = matchVitals.find(item => item.playerId === myProfile.playerId)?.score ?? 0;
    const ride = vehicles.find(item => item.id === myProfile.vehicleType);
    return (
      <Cabinet
        label="Jaldi Ghar Pahuncho results"
        muted={muted}
        onMute={toggleMute}
        chips={[
          { label: 'Result', value: won ? 'WIN' : 'OUT' },
          { label: 'Score', value: `${myScore}m` },
          { label: 'City', value: 'BLR' },
          { label: 'Ride', value: ride?.label ?? 'Auto' },
          { label: 'Next', value: 'OPEN', dark: true },
        ]}
      >
        <div className="panel ticket">
          <div className="version-badge">Race over</div>
          <h1>{won ? 'YOU MADE IT!' : "You couldn't reach home!"}</h1>
          <p className="subtitle">{won ? 'Home before the chaos.' : `${winner?.name ?? 'A racer'} wins`}</p>
          <p className="tagline">Bengaluru traffic does not wait. Queue up for the next dash home.</p>
          <div className="screen-stats">
            <div className="screen-stat"><span>Your score</span><strong>{myScore}m</strong></div>
            <div className="screen-stat"><span>Your ride</span><strong>{ride?.emoji} {ride?.label ?? myProfile.vehicleType}</strong></div>
          </div>
          <button className="start-button" type="button" onClick={() => setJoinNextRace(true)}>Race again</button>
          <p className="small">Same name, next signal.</p>
        </div>
      </Cabinet>
    );
  }

  if (myProfile && currentMatch?.state === 'waiting') {
    const ride = vehicles.find(item => item.id === myProfile.vehicleType);
    return (
      <Cabinet
        label="Jaldi Ghar Pahuncho lobby"
        muted={muted}
        onMute={toggleMute}
        chips={[
          { label: 'Signal', value: connected ? 'LIVE' : '…' },
          { label: 'Ready', value: `${participants.length}/${currentMatch.maxSlots}` },
          { label: 'City', value: 'BLR' },
          { label: 'Ride', value: ride?.label ?? 'Auto' },
          { label: 'Hits', value: '3', dark: true },
        ]}
      >
        <section className="panel ticket lobby" aria-live="polite">
          <div className="version-badge">Waiting at the signal</div>
          <h1>YOU’RE IN</h1>
          <p className="subtitle">{myProfile.name}</p>
          <p className="tagline">Dodge traffic. Survive three hits. Last racer still moving gets home.</p>
          <div className="screen-stats">
            <div className="screen-stat"><span>Racers ready</span><strong>{participants.length} / {currentMatch.maxSlots}</strong></div>
            <div className="screen-stat"><span>Your ride</span><strong>{ride?.emoji} {ride?.label ?? myProfile.vehicleType}</strong></div>
          </div>
          <div className="racer-list">
            {participants.map(profile => {
              const racerRide = vehicles.find(item => item.id === profile.vehicleType);
              return (
                <article className="racer" key={profile.playerId.toString()}>
                  <span className="vehicle-icon">{racerRide?.emoji ?? '🏁'}</span>
                  <span>
                    <strong>{profile.name}{profile.playerId === myProfile.playerId ? ' · YOU' : ''}</strong>
                    <small>{racerRide?.label ?? profile.vehicleType}{profile.isBot ? ' · bot' : ''}</small>
                  </span>
                  <span className="strikes">♥♥♥</span>
                </article>
              );
            })}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="start-button" type="button" disabled={submitting} onClick={beginRace}>{submitting ? 'Starting…' : 'Start race'}</button>
          <p className="small">Empty seats become persona bots.</p>
        </section>
      </Cabinet>
    );
  }

  const selectedRide = vehicles.find(item => item.id === vehicle);
  return (
    <Cabinet
      label="Jaldi Ghar Pahuncho join"
      muted={muted}
      onMute={toggleMute}
      chips={[
        { label: 'City', value: 'BLR' },
        { label: 'Signal', value: connected ? 'LIVE' : '…' },
        { label: 'Slots', value: currentMatch ? `${participants.length}/${currentMatch.maxSlots}` : '—' },
        { label: 'Ride', value: selectedRide?.label ?? 'Auto' },
        { label: 'Mode', value: 'QR', dark: true },
      ]}
    >
      <form className="panel ticket join-form" onSubmit={handleJoin}>
        <div className="version-badge">Bengaluru race</div>
        <h1>JALDI GHAR PAHUNCHO</h1>
        <p className="subtitle">Silk Board to home.</p>
        <p className="tagline">Survive Indian traffic. Pick a ride. Don’t trust the bus in the next lane.</p>
        <div className={`connection ${connected ? 'online' : ''}`}><span />{connected ? 'Live connection ready' : 'Connecting to the race…'}</div>
        <label>Racer name<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={30} autoComplete="name" placeholder="What should we call you?" required /></label>
        <label>Email<input type="email" inputMode="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required /><small>Used only for event updates and your race recap.</small></label>
        <fieldset>
          <legend>Choose your ride</legend>
          <div className="vehicle-grid">
            {vehicles.map(option => (
              <label className={`vehicle ${vehicle === option.id ? 'selected' : ''}`} key={option.id}>
                <input type="radio" name="vehicle" value={option.id} checked={vehicle === option.id} onChange={() => setVehicle(option.id)} />
                <span>{option.emoji}</span>
                <strong>{option.label}</strong>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="keys">
          <div className="key">← → / A D Steer</div>
          <div className="key">W / ↑ Accelerate</div>
          <div className="key">Shift Boost</div>
          <div className="key">F / Space Attack</div>
        </div>
        <label className="consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} required /><span>I agree to receive updates about this event. My email will be stored for this purpose.</span></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={!connected || !currentMatch || submitting} type="submit">{submitting ? 'Joining…' : currentMatch ? 'Join the race' : 'Waiting for a match'}</button>
        <p className="small">Instant QR multiplayer — no install, no password.</p>
      </form>
    </Cabinet>
  );
}

export default App;
