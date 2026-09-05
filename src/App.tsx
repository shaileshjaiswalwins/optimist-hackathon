import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { reducers, tables } from './module_bindings';
import { GameScene } from './GameScene';
import './styles.css';

const vehicles = [
  { id: 'auto', emoji: '🛺', label: 'Auto' },
  { id: 'scooty', emoji: '🛵', label: 'Scooty' },
  { id: 'thar', emoji: '🚙', label: 'Thar' },
] as const;

function App() {
  const { identity, isActive: connected } = useSpacetimeDB();
  const [matches] = useTable(tables.match);
  const [profiles] = useTable(tables.playerProfile);
  const [vitals] = useTable(tables.playerVitals);
  const [positions] = useTable(tables.playerPosition);
  const [obstacles] = useTable(tables.obstacle);
  const joinMatch = useReducer(reducers.joinMatch);
  const startMatch = useReducer(reducers.startMatch);
  const setDrivingInput = useReducer(reducers.setDrivingInput);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [vehicle, setVehicle] = useState('auto');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [joinNextRace, setJoinNextRace] = useState(false);
  const inputSeq = useRef(0);
  const driving = useRef({ steering: 0, throttle: 0, boost: false });

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
    const send = () => {
      inputSeq.current += 1;
      setDrivingInput({ playerId, ...driving.current, inputSeq: inputSeq.current }).catch(console.error);
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
    const timer = window.setInterval(send, 100);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', release);
      release();
    };
  }, [currentMatch?.state, myProfile, setDrivingInput]);

  function holdControl(control: Partial<typeof driving.current>) {
    driving.current = { ...driving.current, ...control };
  }

  if (myProfile && currentMatch?.state === 'active') {
    const myPosition = matchPositions.find(item => item.playerId === myProfile.playerId);
    const myVitals = matchVitals.find(item => item.playerId === myProfile.playerId);
    const sorted = [...participants].sort((a, b) => {
      const aScore = matchVitals.find(item => item.playerId === a.playerId)?.score ?? 0;
      const bScore = matchVitals.find(item => item.playerId === b.playerId)?.score ?? 0;
      return bScore - aScore;
    });
    return (
      <main className="game-page">
        <GameScene myPlayerId={myProfile.playerId} profiles={participants} positions={matchPositions} obstacles={matchObstacles} input={driving} />
        <header className="hud top-hud">
          <div><small>{Math.round(myPosition?.speed ?? 0)} km/h</small><strong>{myVitals?.score ?? 0}m</strong></div>
          <div className="hud-title">GHAR JALDI PAHUNCHO</div>
          <div className="health" aria-label={`${myVitals?.strikesRemaining ?? 3} strikes remaining`}>
            {Array.from({ length: 3 }, (_, index) => <span className={index < (myVitals?.strikesRemaining ?? 3) ? 'live' : ''} key={index}>●</span>)}
          </div>
        </header>
        <aside className="mini-board hud">
          {sorted.map((profile, index) => (
            <div key={profile.playerId.toString()}>
              <span>{index + 1}. {profile.name}{profile.isBot ? ' 🤖' : ''}</span>
              <strong>{matchVitals.find(item => item.playerId === profile.playerId)?.score ?? 0}</strong>
            </div>
          ))}
        </aside>
        {myVitals?.eliminated && <div className="game-message"><h2>You’re out!</h2><p>Watch the race finish live.</p></div>}
        <div className="controls hud">
          <div className="steering-controls">
            <button onPointerDown={() => holdControl({ steering: -1 })} onPointerUp={() => holdControl({ steering: 0 })} onPointerCancel={() => holdControl({ steering: 0 })} aria-label="Steer left">←</button>
            <button onPointerDown={() => holdControl({ steering: 1 })} onPointerUp={() => holdControl({ steering: 0 })} onPointerCancel={() => holdControl({ steering: 0 })} aria-label="Steer right">→</button>
          </div>
          <div className="speed-controls">
            <button className="boost" onPointerDown={() => holdControl({ boost: true })} onPointerUp={() => holdControl({ boost: false })} onPointerCancel={() => holdControl({ boost: false })}>BOOST</button>
            <button className="accelerate" onPointerDown={() => holdControl({ throttle: 1 })} onPointerUp={() => holdControl({ throttle: 0 })} onPointerCancel={() => holdControl({ throttle: 0 })}>RACE</button>
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
        <label>Racer name<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={30} placeholder="What should we call you?" required /></label>
        <label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required /><small>Used only for event updates and your race recap.</small></label>
        <fieldset><legend>Choose your ride</legend><div className="vehicle-grid">{vehicles.map(option => <label className={`vehicle ${vehicle === option.id ? 'selected' : ''}`} key={option.id}><input type="radio" name="vehicle" value={option.id} checked={vehicle === option.id} onChange={() => setVehicle(option.id)} /><span>{option.emoji}</span><strong>{option.label}</strong></label>)}</div></fieldset>
        <label className="consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} required /><span>I agree to receive updates about this event. My email will be stored for this purpose.</span></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={!connected || !currentMatch || submitting} type="submit">{submitting ? 'Joining…' : currentMatch ? 'Join the race' : 'Waiting for a match'}</button>
      </form>
    </main>
  );
}

export default App;
