import { isMuted, onMuteChange } from './muteState';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicStarted = false;
let musicTimer = 0;

function ensureContext() {
  if (ctx && master) return ctx;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = isMuted() ? 0 : 0.9;
  master.connect(ctx.destination);
  onMuteChange(muted => {
    if (!ctx || !master) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.04);
  });
  return ctx;
}

function beep(frequency: number, duration: number, type: OscillatorType, volume: number, when = 0) {
  if (!ctx || !master) return;
  const start = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain);
  gain.connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function thud(duration: number, volume: number) {
  if (!ctx || !master) return;
  const start = ctx.currentTime;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  noise.start(start);
  noise.stop(start + duration);
}

function startMusic() {
  if (musicStarted || !ctx || !master) return;
  musicStarted = true;
  const audio = ctx;
  const mix = master;
  const tempo = 108;
  const beat = 60 / tempo;
  const melody = [
    { t: 0, f: 196, d: 0.42 },
    { t: 1, f: 247, d: 0.32 },
    { t: 2, f: 294, d: 0.55 },
    { t: 3.5, f: 262, d: 0.32 },
    { t: 4, f: 330, d: 0.45 },
    { t: 5, f: 294, d: 0.32 },
    { t: 6, f: 247, d: 0.55 },
    { t: 7, f: 220, d: 0.4 },
  ];
  const bass = [98, 98, 110, 123, 131, 123, 110, 98];
  const loopBeats = 8;
  let next = audio.currentTime + 0.05;

  const schedule = (origin: number) => {
    for (const note of melody) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(note.f, origin + note.t * beat);
      gain.gain.setValueAtTime(0.035, origin + note.t * beat);
      gain.gain.exponentialRampToValueAtTime(0.001, origin + (note.t + note.d) * beat);
      osc.connect(gain);
      gain.connect(mix);
      osc.start(origin + note.t * beat);
      osc.stop(origin + (note.t + note.d) * beat + 0.02);
    }
    bass.forEach((frequency, index) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(frequency, origin + index * beat);
      gain.gain.setValueAtTime(0.02, origin + index * beat);
      gain.gain.exponentialRampToValueAtTime(0.001, origin + (index + 0.7) * beat);
      osc.connect(gain);
      gain.connect(mix);
      osc.start(origin + index * beat);
      osc.stop(origin + (index + 0.75) * beat);
    });
  };

  const pump = () => {
    while (next < audio.currentTime + 1.4) {
      schedule(next);
      next += loopBeats * beat;
    }
    musicTimer = window.setTimeout(pump, 380);
  };
  pump();
}

export function unlockAudio() {
  const audio = ensureContext();
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  startMusic();
}

export function playHit() {
  unlockAudio();
  thud(0.22, 0.28);
  beep(140, 0.12, 'sawtooth', 0.08);
  beep(90, 0.18, 'square', 0.05, 0.04);
}

export function playPickup() {
  unlockAudio();
  beep(523, 0.12, 'sine', 0.08);
  beep(659, 0.14, 'sine', 0.07, 0.08);
  beep(784, 0.18, 'triangle', 0.06, 0.16);
}

export function playCountdownCue(step: 3 | 2 | 1 | 'START') {
  unlockAudio();
  if (step === 'START') {
    beep(523, 0.13, 'square', 0.08);
    beep(784, 0.24, 'triangle', 0.1, 0.09);
    return;
  }
  beep(330, 0.16, 'square', 0.07);
}

export function stopMusicScheduler() {
  if (musicTimer) window.clearTimeout(musicTimer);
  musicTimer = 0;
}
