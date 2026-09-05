import { roadHalfWidthFor } from './roadLayout';

type Racer = {
  playerId: bigint;
  name: string;
  isBot: boolean;
};

type Position = { playerId: bigint; x: number; distance: number };

type Vitals = { playerId: bigint; eliminated: boolean };

type MiniMapProps = {
  myPlayerId: bigint;
  profiles: Racer[];
  positions: Position[];
  vitals: Vitals[];
  fieldSize: number;
};

const WINDOW = 60;
const HEIGHT = 150;
const WIDTH = 130;

export const MiniMap = ({ myPlayerId, profiles, positions, vitals, fieldSize }: MiniMapProps) => {
  const halfWidth = roadHalfWidthFor(fieldSize);
  const myPos = positions.find(p => p.playerId === myPlayerId);
  const myDistance = myPos?.distance ?? 0;
  const eliminatedByPlayer = new Map(vitals.map(v => [v.playerId, v.eliminated]));
  const profileByPlayer = new Map(profiles.map(p => [p.playerId, p]));

  const dots = positions
    .filter(p => !eliminatedByPlayer.get(p.playerId))
    .map(p => {
      const profile = profileByPlayer.get(p.playerId);
      if (!profile) return null;
      const relDistance = Math.max(-WINDOW, Math.min(WINDOW, p.distance - myDistance));
      const top = HEIGHT / 2 - (relDistance / WINDOW) * (HEIGHT / 2 - 8);
      const left = WIDTH / 2 + (p.x / halfWidth) * (WIDTH / 2 - 8);
      const isMe = p.playerId === myPlayerId;
      const color = isMe ? '#ffd85e' : profile.isBot ? '#ff7a4d' : '#5eb5ff';
      const size = isMe ? 10 : 7;
      return (
        <div
          key={p.playerId.toString()}
          className="jaldi-minimap-dot"
          style={{ top, left, width: size, height: size, background: color, boxShadow: isMe ? '0 0 6px #ffd85e' : 'none' }}
        />
      );
    });

  return (
    <div className="jaldi-minimap">
      <style>{`
        .jaldi-minimap { position:fixed; z-index:15; top:max(84px, calc(env(safe-area-inset-top) + 68px)); left:max(12px, env(safe-area-inset-left)); width:${WIDTH}px; height:${HEIGHT}px; background:rgba(8,15,10,.62); backdrop-filter:blur(10px); border-radius:10px; border:1px solid rgba(255,255,255,.12); overflow:hidden; }
        .jaldi-minimap-road { position:absolute; left:8px; right:8px; top:0; bottom:0; background:rgba(255,255,255,.06); border-left:1px dashed rgba(255,255,255,.18); border-right:1px dashed rgba(255,255,255,.18); }
        .jaldi-minimap-dot { position:absolute; border-radius:50%; transform:translate(-50%,-50%); }
        @media (max-width:640px) { .jaldi-minimap { width:${WIDTH * 0.78}px; height:${HEIGHT * 0.7}px; top:max(64px, calc(env(safe-area-inset-top) + 50px)); } }
      `}</style>
      <div className="jaldi-minimap-road" />
      {dots}
    </div>
  );
};
