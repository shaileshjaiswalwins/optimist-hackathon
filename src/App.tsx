import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { reducers, tables } from './module_bindings';
import { GameScene } from './GameScene';
import { VehicleDebugPanel } from './VehicleDebugPanel';
import { MiniMap } from './MiniMap';
import { HitToasts, type Toast } from './HitToast';
import { isMuted, setMuted } from './muteState';
import './styles.css';

const attackLabel = { auto: 'KICK', scooty: 'KICK', thar: 'RAM' } as const;
// Mirrors VEHICLE_DYNAMICS.attackCooldownTicks * the 50ms tick interval in
// spacetimedb/src/index.ts. Keep both in sync by hand: a mismatch here just
// makes the button look "ready" while the server still rejects the attack.
const attackCooldownMs = { auto: 1500, scooty: 1500, thar: 2500 } as const;

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

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [vehicle, setVehicle] = useState('auto');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [joinNextRace, setJoinNextRace] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('medium');
  const inputSeq = useRef(0);
  const driving = useRef({ steering: 0, throttle: 0, boost: false });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenCollisionKeys = useRef(new Set<string>());
  const seenAttackKeys = useRef(new Set<string>());
  const attackCooldownUntil = useRef(0);
  const [attackReady, setAttackReady] = useState(true);
  const [muted, setMutedState] = useState(isMuted());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);

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
    setMuted(!muted);
    setMutedState(!muted);
  };

  const identityProfiles = profiles
    .filter(profile => profile.identity?.toHexString() === identity?.toHexString())
    .sort((a, b) => Number(b.playerId - a.playerId));
  const currentIdentityProfile = identityProfiles.find(profile => {
    const profileMatch = matches.find(item => item.matchId === profile.matchId);
    return profileMatch?.state === 'waiting' || profileMatch?.state === 'active';
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
  }, [currentMatch?.matchId, currentMatch?.state]);

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
    if (!myProfile || currentMatch?.state !== 'active') return;
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
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') driving.current.steering = -1;
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') driving.current.steering = 1;
      if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') driving.current.throttle = 1;
      if (event.key === 'Shift') driving.current.boost = true;
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') driving.current.steering = 0;
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') driving.current.steering = 0;
      if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') driving.current.throttle = 0;
      if (event.key === 'Shift') driving.current.boost = false;
    };
    const release = () => { driving.current = { steering: 0, throttle: 0, boost: false }; };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', release);
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
  }, [currentMatch?.state, myProfile, setDrivingInput]);

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

  const collisionSub = useTable(tables.collisionEvent.where(row => row.playerId.eq(myProfile?.playerId ?? 0n)), { enabled: currentMatch?.state === 'active' && myProfile !== undefined });
  const attackTargetSub = useTable(tables.attackEvent.where(row => row.targetPlayerId.eq(myProfile?.playerId ?? 0n)), { enabled: currentMatch?.state === 'active' && myProfile !== undefined });
  const attackLandedSub = useTable(tables.attackEvent.where(row => row.attackerPlayerId.eq(myProfile?.playerId ?? 0n)), { enabled: currentMatch?.state === 'active' && myProfile !== undefined });
  const [myCollisions] = collisionSub;
  const [attacksOnMe] = attackTargetSub;
  const [attacksByMe] = attackLandedSub;
  const nameOf = (playerId: bigint) => participants.find(profile => profile.playerId === playerId)?.name ?? 'a racer';

  useEffect(() => {
    for (const row of myCollisions) {
      const key = `${row.obstacleId}-${row.createdAt.toMillis()}`;
      if (seenCollisionKeys.current.has(key)) continue;
      seenCollisionKeys.current.add(key);
      pushToast(`HIT! -1 strike`, 'damage');
    }
  }, [myCollisions]);

  useEffect(() => {
    for (const row of attacksOnMe) {
      const key = `on-${row.attackerPlayerId}-${row.createdAt.toMillis()}`;
      if (seenAttackKeys.current.has(key)) continue;
      seenAttackKeys.current.add(key);
      pushToast(`${row.attackKind === 'ram' ? 'RAMMED' : 'KICKED'} by ${nameOf(row.attackerPlayerId)}!`, 'damage');
    }
  }, [attacksOnMe, participants]);

  useEffect(() => {
    for (const row of attacksByMe) {
      const key = `by-${row.targetPlayerId}-${row.createdAt.toMillis()}`;
      if (seenAttackKeys.current.has(key)) continue;
      seenAttackKeys.current.add(key);
      pushToast(`${row.attackKind === 'ram' ? 'RAMMED' : 'KICKED'} ${nameOf(row.targetPlayerId)}!`, 'landed');
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

  async function handleAttack() {
    if (!myProfile || Date.now() < attackCooldownUntil.current) return;
    const cooldown = attackCooldownMs[myProfile.vehicleType as keyof typeof attackCooldownMs] ?? attackCooldownMs.auto;
    attackCooldownUntil.current = Date.now() + cooldown;
    setAttackReady(false);
    window.setTimeout(() => setAttackReady(true), cooldown);
    try {
      await useAttack({ playerId: myProfile.playerId });
    } catch {
      // no target in range or on cooldown server-side — silent no-op
    }
  }

  if (myProfile && currentMatch?.state === 'active') {
    const myPosition = matchPositions.find(item => item.playerId === myProfile.playerId);
    const myVitals = matchVitals.find(item => item.playerId === myProfile.playerId);
    const vitalsByPlayer = new Map(matchVitals.map(item => [item.playerId, item]));
    const sorted = [...participants].sort((a, b) => {
      const aScore = vitalsByPlayer.get(a.playerId)?.score ?? 0;
      const bScore = vitalsByPlayer.get(b.playerId)?.score ?? 0;
      return bScore - aScore;
    });
    return (
      <main className="game-page">
        <GameScene myPlayerId={myProfile.playerId} profiles={participants} positions={matchPositions} obstacles={matchObstacles} input={driving} quality={quality} onReady={() => setSceneReady(true)} />
        <MiniMap myPlayerId={myProfile.playerId} profiles={participants} positions={matchPositions} vitals={matchVitals} fieldSize={participants.length} />
        {new URLSearchParams(window.location.search).get('debugPhysics') === '1' && <VehicleDebugPanel />}
        {!sceneReady && <div className="scene-loading" role="status" aria-live="polite"><div className="scene-loading-card"><span className="road-spinner" /><p>Preparing the Bengaluru streets…</p><small>Getting your ride and traffic ready</small></div></div>}
        <header className="hud top-hud">
          <div><small>{Math.round((myPosition?.speed ?? 0) * 3.6)} km/h</small><strong>{myVitals?.score ?? 0}m</strong></div>
          <div className="hud-title">GHAR JALDI PAHUNCHO</div>
          <div className="health" aria-label={`${myVitals?.strikesRemaining ?? 3} strikes remaining`}>
            {Array.from({ length: 3 }, (_, index) => <span className={index < (myVitals?.strikesRemaining ?? 3) ? 'live' : ''} key={index}>●</span>)}
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
        <label className="quality-setting hud">Quality
          <select value={quality} onChange={event => setQuality(event.target.value as 'low' | 'medium' | 'high')} aria-label="Visual quality">
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
        </label>
        {myVitals?.eliminated && <div className="game-message"><h2>You’re out!</h2><p>Watch the race finish live.</p></div>}
        <HitToasts toasts={toasts} />
        <div className="hud-corner hud">
          <button type="button" className="corner-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? '🔇' : '🔊'}</button>
          <button type="button" className="corner-btn" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>{isFullscreen ? '⤡' : '⤢'}</button>
          <span className="ping-readout">{pingMs != null ? `${pingMs}ms` : '…'}</span>
        </div>
        <div className="controls hud">
          <div className="steering-controls">
            <button type="button" onPointerDown={event => pressControl(event, { steering: -1 })} onPointerUp={event => releaseControl(event, { steering: 0 })} onPointerCancel={event => releaseControl(event, { steering: 0 })} aria-label="Steer left">◀</button>
            <button type="button" onPointerDown={event => pressControl(event, { steering: 1 })} onPointerUp={event => releaseControl(event, { steering: 0 })} onPointerCancel={event => releaseControl(event, { steering: 0 })} aria-label="Steer right">▶</button>
          </div>
          <div className="speed-controls">
            <button type="button" className="attack" disabled={!attackReady} onPointerDown={event => { event.preventDefault(); handleAttack(); }}>{attackLabel[myProfile.vehicleType as keyof typeof attackLabel] ?? 'KICK'}</button>
            <button type="button" className="boost" onPointerDown={event => pressControl(event, { boost: true })} onPointerUp={event => releaseControl(event, { boost: false })} onPointerCancel={event => releaseControl(event, { boost: false })}>BOOST</button>
            <button type="button" className="accelerate" onPointerDown={event => pressControl(event, { throttle: 1 })} onPointerUp={event => releaseControl(event, { throttle: 0 })} onPointerCancel={event => releaseControl(event, { throttle: 0 })}>RACE</button>
          </div>
        </div>
      </main>
    );
  }

  if (myProfile && currentMatch?.state === 'finished') {
    const winner = participants.find(profile => profile.playerId === currentMatch.winnerPlayerId);
    const won = currentMatch.winnerPlayerId === myProfile.playerId;
    return <main className="result-page"><div className="panel result"><p className="eyebrow">Race over</p><h1>{won ? 'You made it!' : `${winner?.name ?? 'A racer'} wins`}</h1><p>Your score: {matchVitals.find(item => item.playerId === myProfile.playerId)?.score ?? 0}m</p><button className="start-button" onClick={() => setJoinNextRace(true)}>Race again</button></div></main>;
  }

  if (myProfile && currentMatch?.state === 'waiting') {
    return (
      <main className="page lobby-page">
        <section className="hero compact"><p className="eyebrow">You’re in, {myProfile.name}</p><h1>Waiting at the signal.</h1><p>Tap left or right to dodge traffic. Survive three hits. Last racer moving wins.</p></section>
        <section className="panel lobby" aria-live="polite">
          <div className="pulse" /><div><h2>{participants.length} / {currentMatch.maxSlots} racers ready</h2><p>Empty seats become persona bots.</p></div>
          <div className="racer-list">{participants.map(profile => { const ride = vehicles.find(item => item.id === profile.vehicleType); return <article className="racer" key={profile.playerId.toString()}><span className="vehicle-icon">{ride?.emoji ?? '🏁'}</span><span><strong>{profile.name}</strong><small>{ride?.label ?? profile.vehicleType}</small></span><span className="strikes">●●●</span></article>; })}</div>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="start-button" disabled={submitting} onClick={beginRace}>{submitting ? 'Starting…' : 'Start race'}</button>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="hero"><p className="eyebrow">Jaldi Ghar Pahuncho</p><h1>Traffic is chaos.<br />Home is waiting.</h1><p>An instant QR multiplayer race for live events—no install, no password.</p></section>
      <form className="panel join-form" onSubmit={handleJoin}>
        <div className={`connection ${connected ? 'online' : ''}`}><span />{connected ? 'Live connection ready' : 'Connecting to the race…'}</div>
        <label>Racer name<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={30} autoComplete="name" placeholder="What should we call you?" required /></label>
        <label>Email<input type="email" inputMode="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required /><small>Used only for event updates and your race recap.</small></label>
        <fieldset><legend>Choose your ride</legend><div className="vehicle-grid">{vehicles.map(option => <label className={`vehicle ${vehicle === option.id ? 'selected' : ''}`} key={option.id}><input type="radio" name="vehicle" value={option.id} checked={vehicle === option.id} onChange={() => setVehicle(option.id)} /><span>{option.emoji}</span><strong>{option.label}</strong></label>)}</div></fieldset>
        <label className="consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} required /><span>I agree to receive updates about this event. My email will be stored for this purpose.</span></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={!connected || !currentMatch || submitting} type="submit">{submitting ? 'Joining…' : currentMatch ? 'Join the race' : 'Waiting for a match'}</button>
      </form>
    </main>
  );
}

export default App;
